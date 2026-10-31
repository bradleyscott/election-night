// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateStats } from './ElectorateStats.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type { ElectorateResult } from '@election-night/core/types';
import { pollsCountdown } from '@election-night/core/polls-close';
import type { PollsCloseState } from '../hooks/usePollsClose.js';

function result(overrides: Partial<ElectorateResult> = {}): ElectorateResult {
  return {
    electorateName: 'Banks Peninsula',
    votesCounted: 31590,
    percentVotesCast: 0.3,
    candidateVotes: [
      { candidate: 'WEENINK, Vanessa', party: 'National', votes: 11860 },
      { candidate: 'McLELLAN, Tracey', party: 'Labour', votes: 11520 },
      { candidate: 'PHAM, Lan', party: 'Green', votes: 5470 },
    ],
    partyVotes: [],
    leaders: [],
    ...overrides,
  } as ElectorateResult;
}

const counting: SeatChance = {
  state: 'counting',
  leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 11860 },
  runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 11520 },
  othersProbability: 0.01,
  probability: 0.54,
  countProbability: 0.54,
  margin: 340,
  remainingVotes: 15300,
  remainingLow: 12000,
  remainingHigh: 18000,
  progress: 0.68,
  enrolment: 45407,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 5000,
  specialsRequiredSwing: 0.068,
  specialsProbability: 0.75,
  insideSpecials: true,
  provisionalPrior: false,
};

const renderStats = (chance: SeatChance | null, extra = {}) =>
  render(
    <ElectorateStats
      result={result()}
      showPartyVote={false}
      chance={chance}
      updatedAt={new Date()}
      {...extra}
    />
  );

const closesAt = new Date('2026-11-07T06:00:00.000Z');

/** A close instant `ms` in the future, as `usePollsClose` would report it. */
function beforeClose(ms: number): PollsCloseState {
  return {
    phase: 'upcoming',
    countdown: pollsCountdown(new Date(closesAt.getTime() - ms), closesAt),
    closesAt,
  };
}

describe('ElectorateStats', () => {
  it('counts down to the close before the first votes, and says what follows', () => {
    renderStats(
      { state: 'waiting' },
      { pollsClose: beforeClose(4 * 3_600_000) }
    );
    expect(screen.getByText('No votes counted yet')).toBeInTheDocument();
    // A live countdown, not a fixed "7pm": before the close the reader needs to
    // know how long, not what o'clock.
    expect(screen.getByText('Polls close in 4h 00m')).toBeInTheDocument();
    // The note is anchored to the close, and says nothing about how much of
    // the count to expect by when: those are the Commission's targets, not a
    // promise this page can make.
    expect(
      screen.getByText(/Counting starts when voting closes/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/50% of voting places/)).not.toBeInTheDocument();
    // No win percentage: the card has nothing to say about the seat yet.
    expect(screen.queryByText('54')).not.toBeInTheDocument();
  });

  it('says the count is under way once the polls have closed', () => {
    renderStats(
      { state: 'waiting' },
      { pollsClose: { phase: 'counting', countdown: null, closesAt } }
    );
    expect(screen.getByText('Polls closed · counting')).toBeInTheDocument();
    expect(
      screen.getByText(/published progressively from 7pm/)
    ).toBeInTheDocument();
  });

  it('shows no countdown for a cycle with no known close instant', () => {
    const { container } = renderStats(
      { state: 'waiting' },
      { pollsClose: { phase: 'stale', countdown: null, closesAt } }
    );
    expect(container.querySelector('.chip-print')).toBeNull();
    expect(screen.getByText(/counting gets underway/)).toBeInTheDocument();
  });

  it('shows a chance of winning and the count state', () => {
    renderStats(counting);
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('46')).toBeInTheDocument();
    // The count and the votes still out share one strip: the same fact told
    // from both ends, rather than a chip in the header and a footnote below.
    expect(screen.getByText('68%')).toBeInTheDocument();
    expect(screen.getByText(/31,590 votes/)).toBeInTheDocument();
    expect(screen.getByText(/about 15,300 votes/)).toBeInTheDocument();
  });

  it('keeps the header quiet — nothing framed competes with the number', () => {
    const { container } = renderStats(counting);
    expect(container.querySelector('.chip-print')).toBeNull();
    expect(screen.getByText(/updated just now/i)).toBeInTheDocument();
  });

  it('puts the margin and its share under the leading candidate only', () => {
    renderStats(counting);
    // 340 ahead of 31,590 counted = 1.1%.
    expect(screen.getByText('Ahead by 340 (1.1%)')).toBeInTheDocument();
    expect(screen.getByText('11,520 votes')).toBeInTheDocument();
  });

  it('carries no commentary about what the outstanding votes could do', () => {
    renderStats({ ...counting, probability: 0.95, margin: 4200 });
    expect(
      screen.queryByText(/still to count|can still change|cannot change hands/i)
    ).not.toBeInTheDocument();
    renderStats({
      ...counting,
      probability: 0.99,
      countProbability: 0.99,
      margin: 21000,
      remainingHigh: 18000,
    });
    expect(
      screen.queryByText(/still to count|can still change|cannot change hands/i)
    ).not.toBeInTheDocument();
  });

  it('replaces the probability with a margin once the count is complete', () => {
    renderStats(
      {
        state: 'complete',
        leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 17860 },
        runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 17464 },
        margin: 396,
        specialsOutstanding: 9700,
        specialsRequiredSwing: 0.0408,
        probability: 0.66,
        specialsProbability: 0.66,
        insideSpecials: true,
      },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText('Count complete')).toBeInTheDocument();
    // The 4xl slot holds a share of the votes counted, not a probability that
    // could only read 100%.
    expect(screen.getByText('50.6')).toBeInTheDocument();
    expect(screen.getByText('49.4')).toBeInTheDocument();
    expect(
      screen.getByText('Ahead by 396 (1.1% of votes)')
    ).toBeInTheDocument();
    expect(screen.queryByText(/chance of winning/i)).not.toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('says the count is complete, not the result', () => {
    // The specials are the one thing that can still move the seat, so the card
    // owes the reader the slot the outstanding votes just left.
    renderStats(
      {
        state: 'complete',
        leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 17860 },
        runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 17464 },
        margin: 396,
        specialsOutstanding: 9700,
        specialsRequiredSwing: 0.0408,
        probability: 0.66,
        specialsProbability: 0.66,
        insideSpecials: true,
      },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText('Specials to come')).toBeInTheDocument();
    expect(screen.getByText(/about 9,700 votes/)).toBeInTheDocument();
    expect(
      screen.getByText('78% of the expected final vote')
    ).toBeInTheDocument();
    // The reader should not have to compare a 396-vote margin to 9,700 votes
    // themselves. The model has already done it, and the sentence claims no
    // direction — the one thing the specials cannot tell us.
    expect(
      screen.getByText('The margin is inside the special vote.')
    ).toBeInTheDocument();
    // The probability the panel spends the night building: 396 votes of margin
    // over 9,700 specials is a 4.1-point required swing against a 10-point
    // spread. On a finished count the specials are all that is left, so this is
    // the chance of winning the seat — and it is the only number here that comes
    // from a distribution rather than a count.
    expect(
      screen.getByText(/Chance of holding the seat:/)
    ).toBeInTheDocument();
    expect(screen.getByText('66%')).toBeInTheDocument();
    expect(screen.queryByText(/could change the result/i)).toBeNull();
  });

  it('rounds the estimates it prints instead of showing their decimals', () => {
    // Enrolment × turnout × share lands on a fraction of a vote, and the card
    // used to print it: "about 6,307.826 votes".
    renderStats(
      {
        state: 'complete',
        leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 17860 },
        runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 17464 },
        margin: 396.4,
        specialsOutstanding: 6307.826,
        specialsRequiredSwing: 0.0628,
        probability: 0.74,
        specialsProbability: 0.74,
        insideSpecials: false,
      },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText(/about 6,308 votes/)).toBeInTheDocument();
    expect(
      screen.getByText('Ahead by 396 (1.1% of votes)')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+\.\d+ votes/)).not.toBeInTheDocument();
    // 396 votes against 6,308 specials is inside them, but this fixture says
    // not: the line is the model's call, not the card's own arithmetic.
    expect(
      screen.queryByText('The margin is inside the special vote.')
    ).toBeNull();
    // The probability is not conditional on the flag any more: a safe seat still
    // gets its number, it just is not told the margin is inside the specials.
    expect(screen.getByText(/Chance of holding the seat:/)).toBeInTheDocument();
    expect(
      screen.queryByText('The margin is inside the special vote.')
    ).toBeNull();
  });

  it('renders no card at all in party mode', () => {
    const { container } = render(
      <ElectorateStats
        result={result()}
        showPartyVote
        chance={counting}
        updatedAt={new Date()}
      />
    );
    // A seat's chance of winning is a candidate-vote fact; the party vote
    // decides a different contest, so there is nothing honest to print here.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/chance of winning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/leading party/i)).not.toBeInTheDocument();
  });

  it('puts the favourite first even when it trails in the count', () => {
    // 44/56 with the count leader on the wrong side of the coin: ordering by
    // votes would put a 44% row above a 56% one and read as a bug.
    renderStats({ ...counting, probability: 0.44 });

    const names = screen
      .getAllByText(/^(WEENINK|McLELLAN),/)
      .map((node) => node.textContent);
    expect(names[0]).toContain('McLELLAN');

    // The count's own state stays with the candidate who leads it.
    const leaderRow = screen.getByText(/^WEENINK,/).closest('div.py-3');
    expect(leaderRow?.textContent).toContain('Ahead by 340');
    const favouriteRow = screen.getByText(/^McLELLAN,/).closest('div.py-3');
    expect(favouriteRow?.textContent).not.toContain('Ahead by');
  });
});

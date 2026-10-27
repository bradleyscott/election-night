// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateStats } from './ElectorateStats.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type { ElectorateResult } from '@election-night/core/types';

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
  margin: 340,
  remainingVotes: 15300,
  remainingLow: 12000,
  remainingHigh: 18000,
  progress: 0.68,
  enrolment: 45407,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 5000,
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

describe('ElectorateStats', () => {
  it('shows no number before the first votes arrive', () => {
    renderStats({ state: 'waiting' }, { pollsCloseLabel: '7pm' });
    expect(screen.getByText('No votes counted yet')).toBeInTheDocument();
    expect(screen.getByText('Polls close 7pm')).toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
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
      },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText('Specials to come')).toBeInTheDocument();
    expect(screen.getByText(/about 9,700 votes/)).toBeInTheDocument();
    expect(
      screen.getByText('78% of the expected final vote')
    ).toBeInTheDocument();
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
      },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText(/about 6,308 votes/)).toBeInTheDocument();
    expect(
      screen.getByText('Ahead by 396 (1.1% of votes)')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+\.\d+ votes/)).not.toBeInTheDocument();
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

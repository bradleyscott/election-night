// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateCountBand } from './ElectorateCountBand.js';
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

const complete: SeatChance = {
  state: 'complete',
  leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 17860 },
  runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 17464 },
  margin: 396,
  specialsOutstanding: 9700,
  specialsRequiredSwing: 0.0408,
  probability: 0.66,
  specialsProbability: 0.66,
  insideSpecials: true,
};

const renderBand = (chance: SeatChance | null, extra = {}) =>
  render(<ElectorateCountBand result={result()} chance={chance} {...extra} />);

const closesAt = new Date('2026-11-07T06:00:00.000Z');

/** A close instant `ms` in the future, as `usePollsClose` would report it. */
function beforeClose(ms: number): PollsCloseState {
  return {
    phase: 'upcoming',
    countdown: pollsCountdown(new Date(closesAt.getTime() - ms), closesAt),
    closesAt,
  };
}

describe('ElectorateCountBand', () => {
  it('counts down to the close before the first votes, and says what follows', () => {
    renderBand(
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
    // Nothing has counted, so there is no refresh time to report.
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it('says the count is under way once the polls have closed', () => {
    renderBand(
      { state: 'waiting' },
      { pollsClose: { phase: 'counting', countdown: null, closesAt } }
    );
    expect(screen.getByText('Polls closed · counting')).toBeInTheDocument();
    expect(
      screen.getByText(/published progressively from 7pm/)
    ).toBeInTheDocument();
  });

  it('shows no countdown for a cycle with no known close instant', () => {
    const { container } = renderBand(
      { state: 'waiting' },
      { pollsClose: { phase: 'stale', countdown: null, closesAt } }
    );
    expect(container.querySelector('.chip-print')).toBeNull();
    expect(screen.getByText(/counting gets underway/)).toBeInTheDocument();
  });

  it('states the count: votes in, the gap, and votes out', () => {
    renderBand(counting);
    expect(screen.getByText(/68%/)).toBeInTheDocument();
    expect(screen.getByText(/31,590 votes/)).toBeInTheDocument();
    // 340 ahead of 31,590 counted = 1.1%.
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText(/about 15,300 votes/)).toBeInTheDocument();
  });

  it('says when the count last moved, at the foot of the figures', () => {
    // The count is the thing being refreshed, so the time it last moved sits
    // under the bar and above the table — not in a caption underneath the last
    // row of the table, which is where it lived while a caption sat there too.
    const { container } = renderBand(counting, { updatedAt: new Date() });
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
    const band = container.firstElementChild as HTMLElement;
    const row = screen.getByText(/Updated just now/)
      .parentElement as HTMLElement;
    // In the band, and after the cells: the bar's wrapper is the last block of
    // the band, and the timestamp is inside it.
    expect(band.contains(row)).toBe(true);
    expect(
      band.querySelector('.grid')?.compareDocumentPosition(row) ??
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('prints no probability at all — the chance lives in the table', () => {
    // The whole point of the move: one number means one thing on one surface.
    // A card at the top of the page and a column underneath could disagree, and
    // that disagreement is what the reader had to resolve.
    const { container } = renderBand(counting);
    expect(screen.queryByText(/54/)).not.toBeInTheDocument();
    expect(screen.queryByText(/46/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chance of winning/i)).not.toBeInTheDocument();
    // Nor is there a framed chip competing with the figures.
    expect(container.querySelector('.chip-print')).toBeNull();
  });

  it('hands the outstanding-votes slot to the specials once the count stops', () => {
    // A finished count is not a result: the specials are counted over the
    // fortnight after the night, so the slot is reused rather than closed.
    renderBand(complete, { result: result({ votesCounted: 35324 }) });
    expect(screen.getByText('Specials to come')).toBeInTheDocument();
    expect(screen.queryByText('Still out')).not.toBeInTheDocument();
    expect(screen.getByText(/about 9,700 votes/)).toBeInTheDocument();
    expect(
      screen.getByText('Count complete · 78% of the expected final vote')
    ).toBeInTheDocument();
    // The reader should not have to compare a 396-vote margin to 9,700 votes
    // themselves. No direction is claimed — the one thing the specials cannot
    // tell us.
    expect(
      screen.getByText('The margin is inside the special vote.')
    ).toBeInTheDocument();
  });

  it('leaves the chance of holding the seat to the Win % column', () => {
    renderBand(complete, { result: result({ votesCounted: 35324 }) });
    expect(
      screen.queryByText(/chance of holding the seat/i)
    ).not.toBeInTheDocument();
  });

  it('rounds the estimates it prints instead of showing their decimals', () => {
    // Enrolment × turnout × share lands on a fraction of a vote, and the card
    // this replaces used to print it: "about 6,307.826 votes".
    renderBand(
      { ...complete, specialsOutstanding: 6307.826, insideSpecials: false },
      { result: result({ votesCounted: 35324 }) }
    );
    expect(screen.getByText(/about 6,308 votes/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+\.\d+ votes/)).not.toBeInTheDocument();
    // 396 votes against 6,308 specials is inside them by arithmetic, but this
    // fixture says not: the line is the model's call, not the band's.
    expect(
      screen.queryByText('The margin is inside the special vote.')
    ).toBeNull();
  });

  it('renders nothing about a seat that has not counted when no model is available', () => {
    // No baseline means no probability and no estimate of the votes still out;
    // the band falls back to the ballot's own header rather than printing a
    // strip of zeros and a bar with nothing behind it.
    renderBand(null);
    expect(screen.getByText('No votes counted yet')).toBeInTheDocument();
    expect(screen.queryByText(/Still out/)).not.toBeInTheDocument();
  });
});

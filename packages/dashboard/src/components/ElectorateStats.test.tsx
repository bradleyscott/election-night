// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateStats } from './ElectorateStats.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

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
    marginOfError: 0.031,
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
      leadingPartyVote={null}
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
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows a chance of winning, the count state and the votes out', () => {
    renderStats(counting);
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('46')).toBeInTheDocument();
    expect(screen.getByText(/68% counted/i)).toBeInTheDocument();
    // The bound agrees with the number: 340 ahead is not a settled seat.
    expect(
      screen.getByText(/this seat can still change tonight/i)
    ).toBeInTheDocument();
  });

  it('makes no claim about changing when the number is merely confident', () => {
    renderStats({ ...counting, probability: 0.95, margin: 4200 });
    expect(
      screen.queryByText(/this seat can still change tonight/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot change hands/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/About 15,300 votes are still to count/)
    ).toBeInTheDocument();
  });

  it('says a seat cannot change once the lead exceeds the votes out', () => {
    renderStats({
      ...counting,
      probability: 0.99,
      margin: 21000,
      remainingHigh: 18000,
    });
    expect(
      screen.getByText(/cannot change hands on tonight's count/i)
    ).toBeInTheDocument();
  });

  it('replaces the probability with a margin once the count is complete', () => {
    renderStats({
      state: 'complete',
      leader: { name: 'WEENINK, Vanessa', party: 'National', votes: 17860 },
      runnerUp: { name: 'McLELLAN, Tracey', party: 'Labour', votes: 17464 },
      margin: 396,
    });
    expect(screen.getByText(/ahead by 396/i)).toBeInTheDocument();
    expect(screen.queryByText(/chance of winning/i)).not.toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('removes the verdict in party mode rather than relabelling it', () => {
    render(
      <ElectorateStats
        result={result()}
        showPartyVote
        leadingPartyVote={{ candidate: 'National Party', votes: 12780 }}
        chance={counting}
        updatedAt={new Date()}
      />
    );
    expect(screen.getByText('Leading party')).toBeInTheDocument();
    expect(screen.getByText('National Party')).toBeInTheDocument();
    expect(screen.queryByText(/chance of winning/i)).not.toBeInTheDocument();
    expect(screen.queryByText('54')).not.toBeInTheDocument();
  });
});

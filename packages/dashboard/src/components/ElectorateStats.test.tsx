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

  it('shows a chance of winning and the count state', () => {
    renderStats(counting);
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('46')).toBeInTheDocument();
    expect(screen.getByText(/68% counted/i)).toBeInTheDocument();
  });

  it('puts the margin and its share under the leading candidate only', () => {
    renderStats(counting);
    // 340 ahead of 31,590 counted = 1.1%.
    expect(
      screen.getByText('11,860 votes · ahead by 340 (1.1%)')
    ).toBeInTheDocument();
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
});

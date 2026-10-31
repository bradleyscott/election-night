// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  ElectorateResults,
  WithLeaders,
} from '@election-night/core/types';

const baseResult = {
  electorateName: 'Auckland Central',
  candidateVotes: [
    { candidate: 'SMITH, John', party: 'National Party', votes: 0 },
    { candidate: 'JONES, Mary', party: 'Labour Party', votes: 0 },
  ],
  partyVotes: [
    { candidate: 'National Party', votes: 0 },
    { candidate: 'Labour Party', votes: 0 },
  ],
  votesCounted: 0,
  votePercentageCounted: 0,
  leaders: {
    leadingCandidate: 'SMITH, John',
    leadingCandidateParty: 'National Party',
    secondCandidate: 'JONES, Mary',
    secondCandidateParty: 'Labour Party',
    margin: 0,
    marginPercent: 0,
  },
} as ElectorateResults & WithLeaders;

/** Two candidates, 1,000 votes between them, National ahead by 500. */
const counted = {
  ...baseResult,
  votesCounted: 1000,
  candidateVotes: [
    { candidate: 'SMITH, John', party: 'National Party', votes: 750 },
    { candidate: 'JONES, Mary', party: 'Labour Party', votes: 250 },
  ],
} as ElectorateResults & WithLeaders;

const counting: SeatChance = {
  state: 'counting',
  leader: { name: 'SMITH, John', party: 'National Party', votes: 750 },
  runnerUp: { name: 'JONES, Mary', party: 'Labour Party', votes: 250 },
  othersProbability: 0.02,
  probability: 0.54,
  countProbability: 0.52,
  margin: 500,
  remainingVotes: 4000,
  remainingLow: 3000,
  remainingHigh: 5000,
  progress: 0.2,
  enrolment: 40000,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 5000,
  specialsRequiredSwing: 0.1,
  specialsProbability: 0.84,
  insideSpecials: false,
  provisionalPrior: false,
};

describe('ElectorateResultsTable', () => {
  test('shows an em-dash instead of NaN when no votes are counted', () => {
    render(
      <ElectorateResultsTable result={baseResult} showPartyVote={false} />
    );

    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(
      baseResult.candidateVotes.length
    );
  });

  test('shows an em-dash for party votes when no votes are counted', () => {
    render(<ElectorateResultsTable result={baseResult} showPartyVote={true} />);

    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(baseResult.partyVotes.length);
  });

  test('shows vote percentages once votes are counted', () => {
    render(<ElectorateResultsTable result={counted} showPartyVote={false} />);

    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  test('carries the chance as a column, ordered by votes', () => {
    render(
      <ElectorateResultsTable
        result={counted}
        showPartyVote={false}
        chance={counting}
      />
    );

    expect(screen.getByText('Win %')).toBeInTheDocument();
    expect(
      screen.getByTitle('54% chance of winning the seat')
    ).toBeInTheDocument();
    // 1 − 0.54 − 0.02: the field's 2% is not handed to the runner-up, so the
    // two numbers need not add to 100 and the caption says why.
    expect(
      screen.getByTitle('44% chance of winning the seat')
    ).toBeInTheDocument();
  });

  test('keeps the count leader first when the projection favours the other', () => {
    // The case the page exists for. The table is the count's, so the trailing
    // candidate stays below — and the 54% beside them, on the same line, is the
    // explanation rather than a contradiction in a separate panel.
    const trailingIsFavoured: SeatChance = {
      ...counting,
      leader: { name: 'SMITH, John', party: 'National Party', votes: 750 },
      runnerUp: { name: 'JONES, Mary', party: 'Labour Party', votes: 250 },
      probability: 0.31,
    };
    render(
      <ElectorateResultsTable
        result={counted}
        showPartyVote={false}
        chance={trailingIsFavoured}
      />
    );

    const names = screen
      .getAllByText(/^(SMITH|JONES),/)
      .map((node) => node.textContent);
    expect(names[0]).toContain('SMITH');
    // Smith trails on the projection and leads the count; the table says both
    // without reordering itself.
    expect(
      screen.getByTitle('31% chance of winning the seat')
    ).toBeInTheDocument();
    expect(
      screen.getByTitle('67% chance of winning the seat')
    ).toBeInTheDocument();
  });

  test('gives no number to a candidate outside the top two', () => {
    const threeWay = {
      ...counted,
      votesCounted: 1000,
      candidateVotes: [
        { candidate: 'SMITH, John', party: 'National Party', votes: 500 },
        { candidate: 'JONES, Mary', party: 'Labour Party', votes: 300 },
        { candidate: 'GREEN, Ada', party: 'Green Party', votes: 200 },
      ],
    } as ElectorateResults & WithLeaders;

    render(
      <ElectorateResultsTable
        result={threeWay}
        showPartyVote={false}
        chance={counting}
      />
    );

    // Two numbers and one dash: the model prices a race, not a field.
    expect(
      screen.getByTitle('54% chance of winning the seat')
    ).toBeInTheDocument();
    expect(
      screen.getByTitle('44% chance of winning the seat')
    ).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  test('shows no Win % column before a vote is counted', () => {
    // A column of dashes before the first result is noise: there is no count
    // for a projection to be about.
    render(
      <ElectorateResultsTable
        result={baseResult}
        showPartyVote={false}
        chance={{ state: 'waiting' } as SeatChance}
      />
    );

    expect(screen.queryByText('Win %')).not.toBeInTheDocument();
  });

  test('shows no Win % column in party view', () => {
    // A party can contest the party vote in a seat it nominates no candidate
    // for, so a seat's chance of changing hands is undefined here.
    render(
      <ElectorateResultsTable
        result={counted}
        showPartyVote={true}
        chance={counting}
      />
    );

    expect(screen.queryByText('Win %')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle(/chance of winning the seat/)
    ).not.toBeInTheDocument();
  });
});

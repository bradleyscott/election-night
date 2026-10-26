// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
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
    const counted = {
      ...baseResult,
      votesCounted: 1000,
      candidateVotes: [
        { candidate: 'SMITH, John', party: 'National Party', votes: 750 },
        { candidate: 'JONES, Mary', party: 'Labour Party', votes: 250 },
      ],
    } as ElectorateResults & WithLeaders;

    render(<ElectorateResultsTable result={counted} showPartyVote={false} />);

    expect(screen.getByText('75.0')).toBeInTheDocument();
    expect(screen.getByText('25.0')).toBeInTheDocument();
  });
});

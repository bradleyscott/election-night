// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateDetail } from './ElectorateDetail.js';
import { mockElectorateResult } from '../test/fixtures.js';
import type { PriorWinner } from '../lib/history-types.js';

const winners: PriorWinner[] = [
  {
    electorateName: 'Auckland Central',
    priorElectorateName: null,
    year: '2023',
    candidate: 'SWARBRICK, Chlöe',
    party: 'Green Party',
    votes: 16_624,
    majority: 3_896,
    majorityPercent: 0.11,
  },
];

function renderDetail(showPartyVote: boolean) {
  return render(
    <ElectorateDetail
      result={mockElectorateResult}
      showPartyVote={showPartyVote}
      onTogglePartyVote={() => {}}
      historyData={null}
      priorWinners={winners}
      priorUnavailable={false}
    />
  );
}

describe('ElectorateDetail', () => {
  test('shows past winners in candidate view', () => {
    renderDetail(false);

    expect(screen.getByText('Past winners')).toBeInTheDocument();
    expect(screen.getByText('SWARBRICK, Chlöe')).toBeInTheDocument();
  });

  test('hides past winners in party view', () => {
    // A seat is won on the candidate vote; the party view is the party vote.
    // Leaving the table there reads as a claim that the party must repeat what
    // its candidate did.
    renderDetail(true);

    expect(screen.queryByText('Past winners')).not.toBeInTheDocument();
    expect(screen.queryByText('SWARBRICK, Chlöe')).not.toBeInTheDocument();
  });
});

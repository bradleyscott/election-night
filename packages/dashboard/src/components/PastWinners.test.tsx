// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PastWinners } from './PastWinners.js';
import type { PriorWinner } from '../lib/history-types.js';

const winners: PriorWinner[] = [
  {
    electorateName: 'Remutaka',
    priorElectorateName: null,
    year: '2023',
    candidate: 'HIPKINS, Chris',
    party: 'Labour Party',
    votes: 20_000,
    majority: 8_000,
    majorityPercent: 0.3,
  },
  {
    electorateName: 'Remutaka',
    priorElectorateName: 'Rimutaka',
    year: '2017',
    candidate: 'HIPKINS, Chris',
    party: 'National Party',
    votes: 18_000,
    majority: 2_000,
    majorityPercent: 0.06,
  },
];

describe('PastWinners', () => {
  test('lists each prior cycle with winner, party and majority', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2017')).toBeInTheDocument();
    expect(screen.getAllByText('HIPKINS, Chris')).toHaveLength(2);
    // The value is labelled with what it is — a margin in votes — and the
    // percentage says what it is a share of, rather than leaving both to be
    // inferred.
    expect(screen.getAllByText('vote margin')).toHaveLength(2);
    expect(screen.getByText('8,000')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();
    expect(screen.getAllByText('of votes cast')).toHaveLength(2);
  });

  test('sets both margin labels in the label font at one size', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    // The labels used to disagree — "vote margin" inherited the body serif
    // while the share was mono — which read as two sizes beside each other on
    // a phone. Both words now take the same label class.
    for (const label of [
      ...screen.getAllByText('vote margin'),
      ...screen.getAllByText('of votes cast'),
    ]) {
      expect(label).toHaveClass('font-label', 'text-xs', 'sm:text-sm');
      // The figure and its label are separated by the row's gap, not by a
      // whitespace text node: that space was 8px while the line was all mono
      // and 4px once the label changed face, which read as the words being
      // crushed after the number.
      expect(label.parentElement).toHaveClass('gap-x-1.5');
    }
  });

  test('names run a point above the compact scale', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    // The rows take the count table's compact step (13px on a phone), because
    // this panel sits directly under that table. The candidate and party are
    // the panel's content, so they go one point above it rather than shrinking
    // with the numbers; at `sm` and up they meet the 16px row.
    expect(screen.getByRole('table')).toHaveClass('text-[0.8125rem]');
    expect(screen.getByText('2023')).toHaveClass('text-xs', 'sm:text-sm');
    expect(screen.getAllByText('HIPKINS, Chris')[0]).toHaveClass(
      'text-sm',
      'sm:text-base'
    );
    expect(screen.getAllByText('Labour Party')[0]).toHaveClass(
      'text-[0.8125rem]',
      'sm:text-sm'
    );
  });

  test('gives the added width to the candidate column, not the figures', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    // A wide viewport used to widen the year and margin columns in proportion,
    // leaving the names in a narrow column and the four-digit year in a wide
    // one. `w-px` pins both outer columns to their content, so the remainder
    // is the candidate and party column's.
    expect(screen.getByText('2023').closest('td')).toHaveClass('w-px');
    expect(screen.getAllByText('vote margin')[0]!.closest('td')).toHaveClass(
      'w-px'
    );
    for (const line of screen
      .getAllByText('vote margin')
      .map((label) => label.parentElement)) {
      expect(line).toHaveClass('whitespace-nowrap');
    }
  });

  test('names the seat as it was called in that cycle', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    expect(
      screen.getByText('National Party · as Rimutaka')
    ).toBeInTheDocument();
  });

  test('makes no claim about tonight', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    // Past results stand on their own: the panel does not know (and must not
    // assert) which party is leading the current, partial count.
    expect(screen.queryByText(/Flipped/i)).not.toBeInTheDocument();
  });

  test('labels an independent winner as Independent, not Unknown', () => {
    // A candidate elected with no party affiliation has a null party; the
    // panel must say what they were, not that their party is unknown.
    render(
      <PastWinners
        winners={[{ ...winners[0]!, party: null }]}
        unavailable={false}
      />
    );

    expect(screen.getByText('Independent')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  test('says when no prior cycle could be fetched', () => {
    render(<PastWinners winners={[]} unavailable />);

    expect(
      screen.getByText(/Previous elections could not be fetched/)
    ).toBeInTheDocument();
  });

  test('explains a seat with no comparable prior holder', () => {
    render(<PastWinners winners={[]} unavailable={false} />);

    expect(screen.getByText(/No comparable past winner/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Candidates from './Candidates.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { WinPercentProvider } from '../components/WinPercentDrawer.js';
import { mockElectorateResult, mockResults } from '../test/fixtures.js';
import type { ResultsPayload } from '@election-night/core/types';

/**
 * A payload covering both routes in and more than one electorate: every seat's
 * whole field, a list candidate above their party's cut, a list candidate below
 * it, and one person who is both a seat candidate and on a list.
 */
const fullBallot: ResultsPayload = {
  ...mockResults,
  electorateResults: [
    {
      ...mockElectorateResult,
      candidateVotes: [
        { candidate: 'SMITH, John', party: 'National Party', votes: 12000 },
        { candidate: 'JONES, Mary', party: 'Labour Party', votes: 11000 },
        { candidate: 'GREEN, Alice', party: 'Green Party', votes: 800 },
      ],
    },
    {
      ...mockElectorateResult,
      electorateName: 'Wellington Central',
      candidateVotes: [
        { candidate: 'WHITE, Sue', party: 'Labour Party', votes: 9000 },
        { candidate: 'BLACK, Bob', party: 'National Party', votes: 8500 },
      ],
      leaders: {
        leadingCandidate: 'WHITE, Sue',
        leadingCandidateParty: 'Labour Party',
        secondCandidate: 'BLACK, Bob',
        secondCandidateParty: 'National Party',
        margin: 500,
        marginPercent: 0.02,
      },
    },
  ],
  partyLists: [
    {
      party: 'National Party',
      candidate: 'BROWN, Sam',
      listRank: 1,
      adjustedRank: 1,
      distanceFromCut: 5,
    },
    {
      party: 'National Party',
      candidate: 'SMITH, John',
      listRank: 40,
      adjustedRank: 40,
      distanceFromCut: -35,
    },
    {
      party: 'Labour Party',
      candidate: 'JONES, Mary',
      listRank: 15,
      adjustedRank: 15,
      distanceFromCut: -2,
    },
    {
      party: 'Green Party',
      candidate: 'GREY, Tom',
      listRank: 12,
      adjustedRank: 12,
      distanceFromCut: -3,
    },
  ],
};

function renderCandidates(results: ResultsPayload | null = fullBallot) {
  return render(
    <BrowserRouter>
      <MockSocketProvider results={results} connected={!!results}>
        <WinPercentProvider>
          <Candidates />
        </WinPercentProvider>
      </MockSocketProvider>
    </BrowserRouter>
  );
}

/**
 * The Win chance line that reads e.g. "-35 from cut". The signed number and the
 * words are separate nodes so only the number can be coloured, which is why a
 * plain `getByText` cannot match the whole line.
 */
function fromCutLine(text: string): HTMLElement {
  const line = screen
    .getAllByText(/from cut/)
    .find((element) => element.textContent === text);
  if (!line) throw new Error(`No from-cut line reading "${text}"`);
  return line;
}

describe('Candidates page', () => {
  test('lists every candidate in every electorate, not just the leaders', () => {
    renderCandidates();

    expect(
      screen.getByRole('heading', { name: 'Candidates' })
    ).toBeInTheDocument();

    // Both seats' fields, including the candidates who are not leading: a seat
    // leader, a runner-up, and the rest of the field.
    expect(screen.getByText('SMITH, John')).toBeInTheDocument();
    expect(screen.getByText('JONES, Mary')).toBeInTheDocument();
    expect(screen.getByText('GREEN, Alice')).toBeInTheDocument();
    expect(screen.getByText('WHITE, Sue')).toBeInTheDocument();
    expect(screen.getByText('BLACK, Bob')).toBeInTheDocument();
    // Every row links to the seat it is standing in, so each seat name repeats.
    expect(screen.getAllByText('Auckland Central').length).toBe(3);
    expect(screen.getAllByText('Wellington Central').length).toBe(2);
  });

  test('lists the whole party list, including candidates below the cut', () => {
    renderCandidates();

    expect(screen.getByText('BROWN, Sam')).toBeInTheDocument();
    expect(fromCutLine('+5 from cut')).toBeInTheDocument();

    // Below the cut, printed as a negative distance rather than left out.
    expect(screen.getByText('GREY, Tom')).toBeInTheDocument();
    expect(fromCutLine('-3 from cut')).toBeInTheDocument();
  });

  test('gives a person who stands in a seat and on a list one row, with both', () => {
    renderCandidates();

    // SMITH, John is in Auckland Central and on National's list at 40: one row
    // carries the seat and the list place, because the live feed puts every
    // candidate on a list as well as in a seat.
    expect(screen.getAllByText('SMITH, John')).toHaveLength(1);
    expect(screen.getAllByText('List').length).toBeGreaterThan(0);
    // The list place is a distance from the cut, in the Win chance column, not
    // a free-floating number in the Seat column, and the rank says which list
    // place it is. The signed number is coloured; the words are not.
    const belowCut = fromCutLine('-35 from cut');
    expect(within(belowCut).getByText('-35')).toHaveClass('text-destructive');
    expect(belowCut).toHaveClass('text-foreground');
    const aboveCut = fromCutLine('+5 from cut');
    expect(within(aboveCut).getByText('+5')).toHaveClass('text-green-700');
    expect(aboveCut).toHaveClass('text-foreground');
    expect(screen.getByText('#40')).toBeInTheDocument();

    // A candidate the model does not price still gets their list line: the
    // chance line above it reads 0%, so the two columns stay in step.
    expect(fromCutLine('-2 from cut')).toBeInTheDocument();
  });

  test('leaves out the route a candidate does not have rather than dashing it', () => {
    renderCandidates();

    // BROWN, Sam is on National's list and contests no seat: there is no seat
    // line to dash, and no chance beside it either. The row is the list alone.
    const listOnly = screen.getByText('BROWN, Sam').closest('tr');
    expect(listOnly).not.toBeNull();
    expect(listOnly?.textContent).not.toContain('—');
    expect(within(listOnly as HTMLElement).queryByText(/^\d+%$/)).toBeNull();
    expect(
      within(listOnly as HTMLElement).getByText('List')
    ).toBeInTheDocument();

    // WHITE, Sue stands in Wellington Central and is on no list: no List chip
    // and no cut line to go with it.
    const seatOnly = screen.getByText('WHITE, Sue').closest('tr');
    expect(seatOnly).not.toBeNull();
    expect(within(seatOnly as HTMLElement).queryByText('List')).toBeNull();
    expect(seatOnly?.textContent).not.toContain('from cut');
  });

  test('prints 0% rather than a dash where there is no chance to print', () => {
    renderCandidates();

    // GREEN, Alice is the third candidate in Auckland Central, so the model
    // prices neither her nor anyone below the top two: the cell reads 0% in
    // red, so a zero is visibly different from a number.
    const row = screen.getByText('GREEN, Alice').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('0%')).toHaveClass(
      'text-destructive'
    );
    expect(row?.textContent).not.toContain('—');
  });

  test('defaults to candidate name ascending', () => {
    renderCandidates();

    const names = screen
      .getAllByRole('row')
      .slice(1) // the header row
      .map((row) => row.querySelector('td')?.textContent?.trim() ?? '');

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toBe('BLACK, Bob');
  });

  test('keeps the Likely Parliamentarians columns, with the whole ballot', () => {
    renderCandidates();

    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.replace(/[↑↓]\s*$/, ''));

    // The old section's four columns, unchanged but for the rename.
    expect(headers).toEqual(['Candidate', 'Party', 'Seat', 'Win chance']);

    // Only the two name-ish columns sort. Seat and Win chance are read-only:
    // a chance sorted as a column would rank the ballot by a projection that
    // leaves most rows at zero.
    expect(screen.getByText('Candidate').closest('th')).toHaveClass(
      'cursor-pointer'
    );
    expect(screen.getByText('Seat').closest('th')).not.toHaveClass(
      'cursor-pointer'
    );
    expect(screen.getByText('Win chance').closest('th')).not.toHaveClass(
      'cursor-pointer'
    );
  });

  test('keeps Win chance on a phone and pins the name beside it', () => {
    renderCandidates();

    // The column used to be `hidden sm:table-cell`, so a phone showed a name
    // and a route and no number at all. It is the page's subject: below `sm`
    // the table scrolls sideways to it instead.
    expect(screen.getByText('Win chance').closest('th')).not.toHaveClass(
      'hidden'
    );

    // The candidate column is the one thing that must not slide away, so it is
    // pinned — and only below `sm`: the hairline that keeps the Seat column
    // from showing through as it passes underneath is reset where nothing
    // scrolls, or it would draw a line through the wide table for no reason.
    const nameHeader = screen
      .getByText('Candidate')
      .closest('th') as HTMLElement;
    expect(nameHeader).toHaveClass('sticky', 'left-0', 'bg-background');
    expect(nameHeader).toHaveClass('border-r', 'sm:border-r-0');

    const firstCell = screen
      .getByText('BLACK, Bob')
      .closest('tr')
      ?.querySelector('td');
    expect(firstCell).toHaveClass('sticky', 'left-0', 'sm:border-r-0');
  });

  test('keeps the Electorate chip off the phone, where the name needs the room', () => {
    renderCandidates();

    // `.chip-print` sets its own display and is emitted after the generated
    // utilities, so a `hidden sm:inline` on the chip itself lost and the chip
    // stayed on a phone. It cost the candidate column 69px — enough that every
    // name wrapped onto two lines — so the breakpoint lives on a wrapper.
    const chip = screen.getAllByText('Electorate')[0];
    expect(chip).toHaveClass('chip-print');
    expect(chip.parentElement).toHaveClass('hidden', 'sm:inline');
  });

  test('cues the swipe and fades the edge only while there is more to reach', () => {
    renderCandidates();

    const cue = screen.getByText(/Swipe for Win chance/);
    expect(cue).toHaveClass('sm:hidden');

    const scroller = screen.getByRole('table').closest('div') as HTMLElement;
    const fade = () =>
      scroller.parentElement?.querySelector('.bg-gradient-to-l');

    // jsdom has no layout: give the frame a width and the table a longer one,
    // which is the phone's situation, then scroll to the end of it.
    Object.defineProperty(scroller, 'clientWidth', {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scroller, 'scrollWidth', {
      configurable: true,
      value: 500,
    });

    const pinned = () =>
      screen.getByText('BLACK, Bob').closest('tr')?.querySelector('td');

    fireEvent.scroll(scroller);
    expect(fade()).not.toBeNull();
    expect(pinned()).not.toHaveClass(
      'shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35)]'
    );

    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    expect(fade()).toBeNull();
    // The pinned column is raised once it has something to be raised over, so
    // the Seat cell passing under it reads as depth and not as clipped text.
    expect(pinned()?.className).toContain(
      'shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35)]'
    );
  });

  test('drops the votes column', () => {
    renderCandidates();

    expect(screen.queryByText('Votes')).toBeNull();
    expect(screen.queryByText('12,000')).toBeNull();
  });

  test('calls the column Win chance, not Certainty', () => {
    renderCandidates();

    expect(screen.getByText('Win chance')).toBeInTheDocument();
    expect(screen.queryByText('Certainty')).toBeNull();
  });

  test('can be searched by candidate, party or electorate', () => {
    renderCandidates();

    const search = screen.getByPlaceholderText(
      /search candidate, party or electorate/i
    );

    fireEvent.change(search, { target: { value: 'green' } });
    expect(screen.getByText('GREEN, Alice')).toBeInTheDocument();
    expect(screen.getByText('GREY, Tom')).toBeInTheDocument();
    expect(screen.queryByText('SMITH, John')).toBeNull();

    fireEvent.change(search, { target: { value: 'wellington' } });
    expect(screen.getByText('WHITE, Sue')).toBeInTheDocument();
    expect(screen.queryByText('GREEN, Alice')).toBeNull();
  });

  test('keeps the chance for a finished count, because the specials are still out', () => {
    // A seat finishes when every one of its places has reported, which is the
    // fact the model completes on — not when the turnout estimate runs out.
    const complete = {
      ...fullBallot,
      electorateResults: fullBallot.electorateResults.map((er) => ({
        ...er,
        votesCounted: 30_000,
        percentVotesCast: 0.7,
        votePercentageCounted: 1,
      })),
    };

    const { container } = renderCandidates(complete);

    // The column sorts on a chance, so it prints one: a finished count keeps the
    // number and never claims 100%, because the special vote is still to come.
    expect(screen.getByText('Win chance')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%\s*margin/);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);
  });

  test('waits rather than showing an empty ballot', () => {
    renderCandidates(null);

    expect(screen.getByText('Candidates')).toBeInTheDocument();
    expect(
      screen.getByText(/every candidate will be listed here/i)
    ).toBeInTheDocument();
  });
});

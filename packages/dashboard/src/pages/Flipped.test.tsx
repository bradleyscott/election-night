// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Flipped from './Flipped.js';
import { WinPercentProvider } from '../components/WinPercentDrawer.js';
import { MockSocketProvider } from '../test/test-utils.js';
import type {
  ResultsPayload,
  ElectorateResult,
} from '@election-night/core/types';
import type { PriorWinnersResponse } from '../lib/history-types.js';

function electorate(
  name: string,
  party: string,
  candidate: string,
  margin: number,
  votesCounted = 25_000
): ElectorateResult {
  const leading = Math.round(votesCounted * 0.6);
  return {
    electorateName: name,
    candidateVotes: [
      { candidate, party, votes: leading },
      {
        candidate: 'Someone Else',
        party: 'Green Party',
        votes: leading - margin,
      },
    ],
    partyVotes: [{ candidate: party, votes: leading }],
    votesCounted,
    votePercentageCounted: 0.8,
    // Turnout, which is what makes a chance of winning computable at all: the
    // model recovers enrolment from these two rather than from the baseline.
    percentVotesCast: 0.55,
    leaders: {
      leadingCandidate: candidate,
      leadingCandidateParty: party,
      secondCandidate: 'Someone Else',
      secondCandidateParty: 'Green Party',
      margin,
      marginPercent: margin / votesCounted,
    },
  };
}

const liveResults: ResultsPayload = {
  electorateResults: [
    // 5,000 in a big seat is only 10.0% — the raw-vote leader, but not the
    // biggest share, which is what the list sorts on.
    electorate('Ōtāhuhu', 'ACT New Zealand', 'TURAI, Hana', 5_000, 50_000),
    // Smaller raw lead (4,000) but the bigger share (16.0%).
    electorate('Kapiti', 'Labour Party', 'NGATA, Ana', 4_000),
    electorate('Remutaka', 'Labour Party', 'HIPKINS, Chris', 6_000),
    electorate('Kelston', 'National Party', 'SMITH, John', 900),
    electorate('Tāmaki Makaurau', 'Te Pāti Māori', 'KEMP, Rawiri', 2_000),
    // Waiariki was held by Rawiri Waititi for the Māori Party, which is the
    // party the feed now calls Te Pāti Māori. Same party, same holder, so it
    // has not changed hands — only its name has.
    electorate('Waiariki', 'Te Pāti Māori', 'WAITITI, Rawiri', 12_000),
  ],
  partyVote: [],
  partyLists: [],
};

const priorWinners: PriorWinnersResponse = {
  currentYear: '2026',
  primaryYear: '2023',
  years: [
    {
      year: '2023',
      winners: [
        {
          electorateName: 'Ōtāhuhu',
          priorElectorateName: 'Panmure-Ōtāhuhu',
          year: '2023',
          candidate: 'SALESI, Jenny',
          party: 'Labour Party',
          votes: 18_000,
          majority: 2_311,
          majorityPercent: 0.092,
        },
        {
          electorateName: 'Kapiti',
          priorElectorateName: null,
          year: '2023',
          candidate: 'BISHOP, Chris',
          party: 'National Party',
          votes: 19_000,
          majority: 5_100,
          majorityPercent: 0.2,
        },
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
          electorateName: 'Tāmaki Makaurau',
          priorElectorateName: null,
          year: '2023',
          candidate: 'HENARE, Peeni',
          party: 'Labour Party',
          votes: 11_000,
          majority: 1_000,
          majorityPercent: 0.05,
        },
        // Kelston is absent: merged into Glendene/Henderson/Waitākere, so it
        // has no comparable prior holder.
        {
          electorateName: 'Waiariki',
          priorElectorateName: null,
          year: '2023',
          candidate: 'WAITITI, Rawiri',
          party: 'Māori Party',
          votes: 12_389,
          majority: 836,
          majorityPercent: 0.03,
        },
      ],
    },
  ],
};

function renderFlipped() {
  return render(
    <BrowserRouter>
      <WinPercentProvider>
        <MockSocketProvider results={liveResults} connected>
          <Flipped />
        </MockSocketProvider>
      </WinPercentProvider>
    </BrowserRouter>
  );
}

describe('Flipped page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(priorWinners), { status: 200 })
        )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('lists only seats whose prior winner is no longer leading', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    expect(screen.getByText('Kapiti')).toBeInTheDocument();

    // Held by the same party in 2023 as tonight — not a flip.
    expect(screen.queryByText('Remutaka')).not.toBeInTheDocument();
    // No comparable prior holder — excluded, not shown as "unknown".
    expect(screen.queryByText('Kelston')).not.toBeInTheDocument();
  });

  test('lists general and Māori electorates together, with no switch', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // One list: a general seat and a Māori seat sit in the same table.
    expect(screen.getByText('Tāmaki Makaurau')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Māori' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull();
  });

  test('shows the historical margin of victory beside today’s lead', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The prior cycle's majority, and tonight's lead in the same units. Each
    // figure appears twice: in the numeric column above `sm`, and in the fold
    // inside the comparison cell below it.
    expect(screen.getAllByText('2,311')).toHaveLength(2);
    expect(screen.getAllByText('9.2%')).toHaveLength(2);
    expect(screen.getAllByText('5,000')).toHaveLength(2);
    // The lead is a share of the votes counted — not the count progress (the
    // fixture counts 80%) — and it is left bare: a margin of error describes a
    // sample, and this is a count part-way through.
    expect(screen.getAllByText('10.0%')).toHaveLength(2);
    expect(screen.queryByText(/±/)).not.toBeInTheDocument();
    // …with the percentage left bare. "10.0% of votes counted" reads as count
    // progress, not as a lead.
    expect(screen.queryByText(/of votes|of counted/)).not.toBeInTheDocument();
    // Nothing explains the column underneath: the footnote that used to sit at
    // the bottom of the table is gone.
    expect(
      screen.queryByText(/Percentages are each margin/)
    ).not.toBeInTheDocument();
  });

  test('folds the figures into their own column, with the words that name them', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // Below `sm` the margin and the lead columns are gone, so each comparison
    // cell carries its own figure and share under the words that say which side
    // it belongs to: two bare numbers side by side read as one quantity, and the
    // header above cannot tell the reader which is which while they are on the
    // second line. The words are dropped above `sm`, where the columns are
    // labelled.
    const row = screen.getByRole('button', {
      name: 'View details for Ōtāhuhu',
    });
    const folds = [...row.querySelectorAll('td > div.mt-1')];
    // One for the prior holder, one for tonight's leader.
    expect(folds).toHaveLength(2);
    expect(
      folds.map((fold) => [...fold.children].map((line) => line.textContent))
    ).toEqual([
      ['won by 2,311', '9.2%'],
      ['leads by 5,000', '10.0%'],
    ]);
    // Mono and tabular on both lines: the figures are data, and the words that
    // name them are in the label face, a step down.
    expect(folds[0]).toHaveClass('font-mono');
    expect(folds[0]).toHaveClass('tabular-nums');
    expect(folds[0]?.querySelector('.font-label')).toHaveTextContent('won by');
    expect(folds[1]?.querySelector('.font-label')).toHaveTextContent(
      'leads by'
    );
  });

  test('a party renamed between cycles is not a seat changing hands', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The Commission renames parties: 2020's "Māori Party" is tonight's "Te
    // Pāti Māori". Comparing the raw strings listed Waiariki as a flip while
    // Rawiri Waititi still held it, and it sorted to the top of the page on a
    // 52.9% "lead".
    expect(screen.queryByText('Waiariki')).not.toBeInTheDocument();
  });

  test('does not list a seat before its first vote', async () => {
    // Before the count, the feed's candidate order is alphabetical, so the
    // "leader" would be whichever surname sorts first. That is not a hand
    // change and must not appear on the page.
    const noVotes: ElectorateResult = {
      ...electorate('Ōtāhuhu', 'ACT New Zealand', 'AARDVARK, Ann', 0, 0),
      leaders: {
        leadingCandidate: null,
        leadingCandidateParty: null,
        secondCandidate: null,
        secondCandidateParty: null,
        margin: 0,
        marginPercent: 0,
      },
    };

    render(
      <BrowserRouter>
        <WinPercentProvider>
          <MockSocketProvider
            results={{
              electorateResults: [noVotes],
              partyVote: [],
              partyLists: [],
            }}
            connected
          >
            <Flipped />
          </MockSocketProvider>
        </WinPercentProvider>
      </BrowserRouter>
    );

    expect(
      await screen.findByText('No seats have changed hands since 2023')
    ).toBeInTheDocument();
    expect(screen.queryByText('Ōtāhuhu')).not.toBeInTheDocument();
  });

  test('sorts by share of the vote, not raw votes', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // Kapiti's 4,000 is a bigger share (16.0%) than Ōtāhuhu's 5,000 (10.0%),
    // which in turn beats Tāmaki Makaurau's 2,000 (8.0%) — one list, whatever
    // roll the seat sits on.
    const rows = screen.getAllByRole('button', { name: /^View details for/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Kapiti'),
      expect.stringContaining('Ōtāhuhu'),
      expect.stringContaining('Tāmaki Makaurau'),
    ]);
  });

  test('states the comparison year from the data, not a fixed year', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          currentYear: '2026',
          primaryYear: '2017',
          years: priorWinners.years.map((year) => ({
            ...year,
            year: '2017',
            winners: year.winners.map((w) => ({ ...w, year: '2017' })),
          })),
        }),
        { status: 200 }
      )
    );

    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The kicker is gone; the year still comes from the response, in the
    // column heads.
    expect(screen.queryByText(/Seats changing hands/)).toBeNull();
    expect(screen.getByText('Held 2017')).toBeInTheDocument();
    expect(screen.getByText('2017 margin')).toBeInTheDocument();
    // Nothing may hardcode the cycle the dev feed happens to use.
    expect(screen.queryByText(/2020/)).not.toBeInTheDocument();
  });

  test('names the prior electorate when the seat has been renamed', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    expect(
      screen.getByText('Labour Party · as Panmure-Ōtāhuhu')
    ).toBeInTheDocument();
  });

  test('a finished count keeps its chance, because the specials are still out', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          currentYear: '2026',
          primaryYear: '2023',
          years: [
            {
              year: '2023',
              winners: [
                {
                  electorateName: 'Testville',
                  year: '2023',
                  candidate: 'BROWN, Ana',
                  party: 'Labour Party',
                  votes: 18_000,
                  majority: 900,
                  majorityPercent: 0.04,
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    render(
      <BrowserRouter>
        <WinPercentProvider>
          <MockSocketProvider
            results={{
              electorateResults: [
                {
                  // A name no baseline knows, so enrolment is back-solved from
                  // the turnout below rather than read from the roll: turnout
                  // past the night total (77.7% × 78.3%) leaves the model
                  // nothing outstanding, which is the complete state.
                  ...electorate(
                    'Testville',
                    'National Party',
                    'SMITH, John',
                    4_000
                  ),
                  percentVotesCast: 0.7,
                },
              ],
              partyVote: [],
              partyLists: [],
            }}
            connected
          >
            <Flipped />
          </MockSocketProvider>
        </WinPercentProvider>
      </BrowserRouter>
    );

    await screen.findByText('Testville');
    // The ordinary count is done, but the seat is not: the special vote is still
    // to come, so the column keeps the number the rest of the app quotes.
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  test('shows a chance of winning instead of a status chip', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The qualitative label is gone; the column carries the number the rest of
    // the app quotes for this seat.
    expect(screen.queryByText('Too close to call')).not.toBeInTheDocument();
    expect(screen.queryByText('Likely winner')).not.toBeInTheDocument();
    // A whole-number percentage, unlike the lead's one decimal place.
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);

    // The qualifier columns drop out on narrow screens so the four columns
    // that make the comparison stay readable. The chance is the exception: it
    // stays, at the far end of a sideways scroll.
    const winHeader = screen
      .getByRole('button', { name: /how we work out win %/i })
      .closest('th');
    expect(winHeader).not.toHaveClass('hidden');
    // There is no MoE column left to qualify.
    expect(screen.queryByText('MoE')).toBeNull();
    expect(screen.getByText('Lead')).toHaveClass('hidden', 'sm:table-cell');
    expect(screen.getByText('Held 2023')).not.toHaveClass('hidden');
  });

  test('pins the electorate while the table scrolls to the chance', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The table is wider than the phone below `sm`, so the reader swipes to the
    // chance. The electorate is the one thing that must not slide away; the
    // paper ground and hairline stop the Held cell showing through underneath.
    const seatHeader = screen.getByText('Electorate').closest('th');
    expect(seatHeader).toHaveClass('sticky', 'left-0', 'bg-background');
    expect(seatHeader).toHaveClass('border-r', 'sm:border-r-0');

    const firstCell = screen
      .getByText('Ōtāhuhu')
      .closest('tr')
      ?.querySelector('td');
    expect(firstCell).toHaveClass('sticky', 'left-0', 'sm:border-r-0');
  });

  test('fades the edge only while there is more to reach', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // No caption above the table telling the reader to swipe: the fade over the
    // cut column is the cue.
    expect(screen.queryByText(/Swipe/)).toBeNull();

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
      screen.getByText('Ōtāhuhu').closest('tr')?.querySelector('td');

    fireEvent.scroll(scroller);
    expect(fade()).not.toBeNull();
    expect(pinned()).not.toHaveClass(
      'shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35)]'
    );

    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    expect(fade()).toBeNull();
    // The pinned column is raised once it has something to be raised over, so
    // the Held cell passing under it reads as depth and not as clipped text.
    expect(pinned()?.className).toContain(
      'shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35)]'
    );
  });

  test('counts flips against the seats that are comparable', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // 3 flips of 5 comparable seats (Ōtāhuhu, Kapiti, Remutaka, Tāmaki
    // Makaurau, Waiariki) — general and Māori counted the same way, and
    // Waiariki not counted as a flip for its party's rename.
    expect(screen.getByText('3 of 5 seats')).toBeInTheDocument();
  });

  test('filters the list, macron-insensitively', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    fireEvent.change(screen.getByLabelText('Search flipped seats'), {
      target: { value: 'otah' },
    });

    expect(screen.getByText('Ōtāhuhu')).toBeInTheDocument();
    expect(screen.queryByText('Kapiti')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 5 seats matching')).toBeInTheDocument();
  });

  test('paginates long lists ten rows at a time', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `Seat ${String(i + 1).padStart(2, '0')}`
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          currentYear: '2026',
          primaryYear: '2023',
          years: [
            {
              year: '2023',
              winners: names.map((name) => ({
                electorateName: name,
                priorElectorateName: null,
                year: '2023',
                candidate: 'INCUMBENT, Ana',
                party: 'Labour Party',
                votes: 15_000,
                majority: 1_234,
                majorityPercent: 0.1,
              })),
            },
          ],
        }),
        { status: 200 }
      )
    );

    render(
      <BrowserRouter>
        <WinPercentProvider>
          <MockSocketProvider
            results={{
              electorateResults: names.map((name, i) =>
                electorate(name, 'National Party', `CANDIDATE ${i}`, 1_000 + i)
              ),
              partyVote: [],
              partyLists: [],
            }}
            connected
          >
            <Flipped />
          </MockSocketProvider>
        </WinPercentProvider>
      </BrowserRouter>
    );

    await screen.findByText('Seat 12');
    // The count describes the whole list, not the page on screen.
    expect(screen.getByText('12 of 12 seats')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /^View details for/ })
    ).toHaveLength(10);
    // Sorted by share of the vote, so the smallest lead is on page two.
    expect(screen.queryByText('Seat 01')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getAllByRole('button', { name: /^View details for/ })
    ).toHaveLength(2);
    expect(screen.getByText('Seat 01')).toBeInTheDocument();

    // Narrowing the list starts over at the first page.
    fireEvent.change(screen.getByLabelText('Search flipped seats'), {
      target: { value: 'seat 12' },
    });
    expect(screen.getByText('Seat 12')).toBeInTheDocument();
    expect(screen.queryByText('Seat 02')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  test('explains itself when no prior cycle could be fetched', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'prior results unavailable' }), {
        status: 503,
      })
    );

    renderFlipped();

    expect(
      await screen.findByText('Prior results unavailable')
    ).toBeInTheDocument();
  });

  test('does not claim the live cycle when the service returns no prior year', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ currentYear: '2026', primaryYear: null, years: [] }),
        { status: 200 }
      )
    );

    renderFlipped();

    expect(
      await screen.findByText('Prior results unavailable')
    ).toBeInTheDocument();
  });

  test('labels an independent candidate as Independent, not Unknown', async () => {
    // A candidate with no party affiliation has a null party; the table must
    // say what they are, matching every other surface that shows a candidate.
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...priorWinners,
          years: [
            {
              year: '2023',
              winners: [
                {
                  electorateName: 'Remutaka',
                  priorElectorateName: null,
                  year: '2023',
                  candidate: 'PRYCE, Mathew',
                  party: null,
                  votes: 18_000,
                  majority: 800,
                  majorityPercent: 0.03,
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    render(
      <BrowserRouter>
        <WinPercentProvider>
          <MockSocketProvider
            results={{
              electorateResults: [
                electorate('Remutaka', 'National Party', 'SMITH, John', 1_500),
              ],
              partyVote: [],
              partyLists: [],
            }}
            connected
          >
            <Flipped />
          </MockSocketProvider>
        </WinPercentProvider>
      </BrowserRouter>
    );

    await screen.findByText('Remutaka');
    expect(screen.getByText('Independent')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  test('says so when every comparable seat is holding', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...priorWinners,
          years: [
            {
              year: '2023',
              winners: priorWinners.years[0]!.winners.filter(
                (w) => w.electorateName === 'Remutaka'
              ),
            },
          ],
        }),
        { status: 200 }
      )
    );

    renderFlipped();

    expect(
      await screen.findByText('No seats have changed hands since 2023')
    ).toBeInTheDocument();
  });
});

describe('Flipped page without live results', () => {
  beforeEach(() => {
    // The prior-winners request never settles; the page should still show the
    // waiting state rather than a half-built table.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('waits for the first results', async () => {
    render(
      <BrowserRouter>
        <WinPercentProvider>
          <MockSocketProvider results={null} connected={false}>
            <Flipped />
          </MockSocketProvider>
        </WinPercentProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});

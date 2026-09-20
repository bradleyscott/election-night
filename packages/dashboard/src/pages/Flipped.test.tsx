// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Flipped from './Flipped.js';
import { MockSocketProvider } from '../test/test-utils.js';
import type {
  ResultsPayload,
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import type { PriorWinnersResponse } from '../lib/history-types.js';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

function electorate(
  name: string,
  party: string,
  candidate: string,
  margin: number,
  status: 'projected' | 'leaning' | 'too-close',
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
    leaders: {
      leadingCandidate: candidate,
      leadingCandidateParty: party,
      secondCandidate: 'Someone Else',
      secondCandidateParty: 'Green Party',
      margin,
      marginPercent: margin / votesCounted,
      predictionStatus: status,
    },
    marginOfError: 0.02,
  };
}

const liveResults: ResultsPayload = {
  electorateResults: [
    // 5,000 in a big seat is only 10.0% — the raw-vote leader, but not the
    // biggest share, which is what the list sorts on.
    electorate(
      'Ōtāhuhu',
      'ACT New Zealand',
      'TURAI, Hana',
      5_000,
      'too-close',
      50_000
    ),
    // Smaller raw lead (4,000) but the bigger share (16.0%).
    electorate('Kapiti', 'Labour Party', 'NGATA, Ana', 4_000, 'projected'),
    electorate(
      'Remutaka',
      'Labour Party',
      'HIPKINS, Chris',
      6_000,
      'projected'
    ),
    electorate('Kelston', 'National Party', 'SMITH, John', 900, 'leaning'),
    electorate(
      'Tāmaki Makaurau',
      'Te Pāti Māori',
      'KEMP, Rawiri',
      2_000,
      'leaning'
    ),
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
      ],
    },
  ],
};

function renderFlipped() {
  return render(
    <BrowserRouter>
      <MockSocketProvider results={liveResults} connected>
        <Flipped />
      </MockSocketProvider>
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

  test('shows the historical margin of victory beside today’s lead', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // The prior cycle's majority, and tonight's lead in the same units…
    expect(screen.getByText('2,311')).toBeInTheDocument();
    expect(screen.getByText('9.2%')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    // …with the percentage left bare. "10.0% of votes counted" reads as count
    // progress, not as a lead, so the denominator is explained once in the
    // footnote instead.
    expect(screen.queryByText(/of votes|of counted/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Percentages are each margin as a share of the vote/)
    ).toBeInTheDocument();
  });

  test('sorts by share of the vote, not raw votes', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // Kapiti's 4,000 is a bigger share (16.0%) than Ōtāhuhu's 5,000 (10.0%).
    const rows = screen.getAllByRole('button', { name: /^View details for/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Kapiti'),
      expect.stringContaining('Ōtāhuhu'),
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
    expect(
      screen.getByText('Seats changing hands since 2017')
    ).toBeInTheDocument();
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

  test('uses the same status vocabulary as the electorate page', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    expect(screen.getByText('Too close to call')).toBeInTheDocument();
    expect(screen.getByText('Likely winner')).toBeInTheDocument();
  });

  test('counts flips against the seats that are comparable', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    // 2 flips of 3 comparable general seats (Ōtāhuhu, Kapiti, Remutaka).
    expect(screen.getByText('2 of 3 seats')).toBeInTheDocument();
  });

  test('filters the list, macron-insensitively', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    fireEvent.change(screen.getByLabelText('Search flipped seats'), {
      target: { value: 'otah' },
    });

    expect(screen.getByText('Ōtāhuhu')).toBeInTheDocument();
    expect(screen.queryByText('Kapiti')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 seats matching')).toBeInTheDocument();
  });

  test('splits general and Māori seats', async () => {
    renderFlipped();

    await screen.findByText('Ōtāhuhu');
    expect(screen.queryByText('Tāmaki Makaurau')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Māori' }));

    expect(screen.getByText('Tāmaki Makaurau')).toBeInTheDocument();
    expect(screen.queryByText('Ōtāhuhu')).not.toBeInTheDocument();
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
        <MockSocketProvider results={null} connected={false}>
          <Flipped />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});

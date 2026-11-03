import { useMemo, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { partyColor } from '../lib/constants.js';
import { normalizeElectorateName } from '../lib/electorates.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { cn } from '../lib/utils.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';
import { PartyDot } from '../components/PartyDot.js';
import { chanceByCandidate } from '../components/ElectorateResultsTable.js';
import { PageHead, PageWaiting } from '../components/Page.js';
import {
  Th,
  TH_CLASS,
  TR_ROW,
  TR_ROW_HOVER,
  NUMERIC,
  NUMERIC_CELL,
  TABLE_FRAME,
  TABLE_TEXT,
} from '../components/Table.js';
import { WinPercentValue } from '../components/WinPercentValue.js';

/**
 * What the Win chance column means for a seat: the chance this candidate holds
 * it, not how far the lead is from a sampling error.
 *
 * A finished count keeps the same number, because the ordinary count finishing
 * is not the seat being decided — the special vote is still to come. It used to
 * switch to the margin as a percentage, which gave one column two units: a seat
 * sorted on its chance and printed its margin, so a 55% seat could read
 * "1.1% margin" beside a live seat reading "90%".
 */
function ElectorateWinChance({ chance }: { chance: number | null }) {
  // A candidate the model does not price reads 0%, not a dash: the column is a
  // percentage, and a row with nothing to print should not look like a missing
  // value beside rows that have one. Zero is called out in red, whether it is
  // absent from the model or rounds to nothing.
  const percent = chance === null ? 0 : Math.round(chance * 100);

  if (percent === 0) {
    return <span className="text-destructive">0%</span>;
  }

  return <WinPercentValue percent={chance} />;
}

/**
 * Every candidate, in the Likely Parliamentarians table's own clothes: the same
 * four columns and the same route chips, with the filters removed.
 *
 * The table used to whittle the ballot down to the people who would be in the
 * chamber tonight — each seat's leader plus the list candidates above their
 * party's cut. The columns are unchanged; what changed is that every seat's
 * whole field is here and so is every name on every list.
 *
 * A candidate gets one row. Because the live feed puts every candidate on a
 * list as well as in a seat, the Seat column carries both routes where both
 * exist: the `Electorate` chip with the seat, and the `List` chip with the
 * candidate's rank and their distance from the party's cut (`+5` green above it,
 * `-9` muted below). Showing only the seat would leave the page looking as
 * though nobody were on a list at all; showing two rows would count one person
 * twice. Someone who is only on a list gets the List chip alone, with no seat
 * line and no chance beside it; someone who stands only in a seat gets the
 * Electorate chip alone. A route the candidate does not have is left out rather
 * than dashed, so a row shows only the routes that exist.
 *
 * Win chance stays the seat's chance and nothing else: the same two candidates
 * the seat panel prices, from the same function, so the page cannot quote a
 * number the seat does not. A list place is not a probability and is not
 * printed as one.
 */
function AllCandidates({
  electorateResults,
  partyLists,
  chances,
}: {
  electorateResults: {
    electorateName: string;
    candidateVotes: {
      candidate: string;
      votes: number;
      party: string | undefined;
    }[];
  }[];
  partyLists: (PartyList & WithAdjustedRank)[];
  chances?: Map<string, SeatChance>;
}) {
  type SortKey = 'name' | 'party';
  // Default: candidate name, ascending. Seat and Win chance are not sortable,
  // so these are the only two orderings the table offers.
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  type CandidateRow = {
    name: string;
    party: string;
    electorateName: string | null;
    winChance: number | null;
    listRank: number | null;
    distanceFromCut: number | null;
  };

  const candidates = useMemo(() => {
    const rows: CandidateRow[] = [];
    // Name *and* party: the feed names candidates "SURNAME, First", and two
    // parties can in principle stand someone with the same name.
    const keyOf = (name: string, party: string) =>
      `${party}|${name}`.toLowerCase();
    const seen = new Set<string>();

    // Keyed first, because a seat row has to be able to carry the list too.
    const listByCandidate = new Map(
      partyLists.map((member) => [
        keyOf(member.candidate, member.party),
        member,
      ])
    );

    for (const er of electorateResults) {
      const chance =
        chances?.get(normalizeElectorateName(er.electorateName)) ?? null;
      // The same two candidates the seat panel prices, from the same function:
      // a page cannot quote a chance the seat beside it does not.
      const shares = chanceByCandidate(chance);
      for (const candidate of er.candidateVotes) {
        const party = candidate.party ?? '';
        const key = keyOf(candidate.candidate, party);
        const listed = listByCandidate.get(key);
        rows.push({
          name: candidate.candidate,
          party,
          electorateName: er.electorateName,
          winChance: shares?.[candidate.candidate] ?? null,
          listRank: listed?.listRank ?? null,
          distanceFromCut: listed?.distanceFromCut ?? null,
        });
        seen.add(key);
      }
    }

    // Someone who is on a list but contests no seat: no seat to name, but they
    // are still standing, so they get a row of their own.
    for (const member of partyLists) {
      if (seen.has(keyOf(member.candidate, member.party))) continue;
      rows.push({
        name: member.candidate,
        party: member.party,
        electorateName: null,
        winChance: null,
        listRank: member.listRank,
        distanceFromCut: member.distanceFromCut,
      });
    }

    const q = search.toLowerCase().trim();
    const filtered = q
      ? rows.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.party.toLowerCase().includes(q) ||
            c.electorateName?.toLowerCase().includes(q)
        )
      : rows;

    filtered.sort((a, b) => {
      const cmp =
        sortKey === 'name'
          ? a.name.localeCompare(b.name)
          : a.party.localeCompare(b.party);
      return cmp !== 0 ? (sortDesc ? -cmp : cmp) : a.name.localeCompare(b.name);
    });

    return filtered;
  }, [electorateResults, partyLists, sortKey, sortDesc, search, chances]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  }

  function SortIndicator({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return <span className="ml-1 text-sm">{sortDesc ? '↓' : '↑'}</span>;
  }

  function Header({
    column,
    className,
    children,
  }: {
    column: SortKey;
    className?: string;
    children: ReactNode;
  }) {
    return (
      <th
        className={cn(
          TH_CLASS,
          'cursor-pointer select-none py-2 transition-colors hover:text-foreground sm:py-3 px-3',
          className
        )}
        onClick={() => toggleSort(column)}
      >
        {children}
        <SortIndicator column={column} />
      </th>
    );
  }

  return (
    <div>
      <div className="relative mb-3 sm:mb-4">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search candidate, party or electorate…"
          aria-label="Search candidates"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 sm:py-1.5 border bg-background text-sm font-label outline-none focus:ring-2 focus:ring-ring/25 transition-shadow"
        />
      </div>
      <div className={cn('overflow-x-auto', TABLE_FRAME)}>
        <table className={cn('w-full', TABLE_TEXT)}>
          <thead>
            <tr className="border-b border-border">
              <Header column="name" className="text-left">
                Candidate
              </Header>
              <Header column="party" className="hidden sm:table-cell text-left">
                Party
              </Header>
              <Th>Seat</Th>
              <Th
                align="right"
                className="hidden sm:table-cell whitespace-nowrap"
              >
                Win chance
              </Th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => {
              const fromCut = c.distanceFromCut ?? 0;
              return (
                <tr
                  key={`${c.party}|${c.name}`}
                  className={cn(
                    TR_ROW,
                    TR_ROW_HOVER,
                    'opacity-0 animate-fade-in-up'
                  )}
                  // Capped: this is every candidate in the country, and an
                  // uncapped stagger would still be revealing rows a reader has
                  // scrolled past a minute later.
                  style={{ animationDelay: `${Math.min(i, 24) * 0.015}s` }}
                >
                  <td className="py-2 sm:py-3 px-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      <PartyDot
                        color={partyColor(c.party)}
                        className="sm:hidden"
                      />
                      {c.name}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <PartyDot color={partyColor(c.party)} />
                      <span>{c.party || 'Independent'}</span>
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-3">
                    {/* Two lines, in step with the Win chance column: the seat
                        on the first and the list on the second, so a seat name
                        lines up with the chance and a List chip with the
                        distance from the cut. A route the candidate does not
                        have is absent rather than dashed: a list-only row has no
                        seat line and no chance beside it, and a seat-only row
                        has no list line. */}
                    <div className="flex flex-col gap-y-1">
                      {c.electorateName && (
                        <span className="flex items-center gap-1.5">
                          <span className="hidden sm:inline chip-print chip-print--ink chip-print--table">
                            Electorate
                          </span>
                          <Link
                            to={`/electorates/${encodeURIComponent(c.electorateName)}`}
                            className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
                          >
                            {c.electorateName}
                          </Link>
                        </span>
                      )}
                      {c.listRank !== null && (
                        <span className="flex items-center gap-1.5">
                          <Link
                            to={`/parties?party=${encodeURIComponent(c.party)}`}
                            className="chip-print chip-print--red chip-print--table hover:bg-muted/40 transition-colors"
                          >
                            List
                          </Link>
                          <span className="font-mono text-sm text-foreground tabular-nums">
                            #{c.listRank}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className={cn(
                      'hidden sm:table-cell py-2 sm:py-3 px-3',
                      NUMERIC,
                      NUMERIC_CELL
                    )}
                  >
                    <div className="flex flex-col gap-y-1">
                      {c.electorateName && (
                        <ElectorateWinChance chance={c.winChance} />
                      )}
                      {c.listRank !== null && (
                        <span
                          className="text-sm text-foreground"
                          title={
                            fromCut === 0
                              ? 'On their party’s cut'
                              : `${Math.abs(fromCut)} ${Math.abs(fromCut) === 1 ? 'place' : 'places'} ${fromCut > 0 ? 'above' : 'below'} their party’s cut`
                          }
                        >
                          <span
                            className={cn(
                              fromCut > 0
                                ? 'text-green-700 dark:text-green-400'
                                : fromCut < 0
                                  ? 'text-destructive'
                                  : undefined
                            )}
                          >
                            {fromCut > 0 ? `+${fromCut}` : fromCut}
                          </span>{' '}
                          from cut
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Every candidate in the election, in the Likely Parliamentarians table's own
 * columns — searchable by name, party or electorate.
 *
 * It used to be that table on the Seats page: a seat's leader plus every list
 * candidate above their party's cut, answering "who is in the chamber tonight".
 * The question readers arrive with is often just "who is standing here", so the
 * same columns now carry the whole ballot.
 */
export default function Candidates() {
  const { results } = useResults();

  const electorateResults = results?.electorateResults ?? [];
  const partyLists = (results?.partyLists ?? []) as (PartyList &
    WithAdjustedRank)[];

  // The same chance the seat page, the map, Seats and Close Calls quote.
  const { chances } = useSeatChances(electorateResults);

  if (!electorateResults.length && !partyLists.length) {
    return <PageWaiting title="Candidates" context="candidates" />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHead title="Candidates" />

      <AllCandidates
        chances={chances}
        electorateResults={electorateResults}
        partyLists={partyLists}
      />
    </div>
  );
}

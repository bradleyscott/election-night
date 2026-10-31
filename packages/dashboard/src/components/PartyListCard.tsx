import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { partyColor } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { PartyDot } from './PartyDot.js';
import { Th } from './Table.js';
import type { PartyListResult } from '@election-night/core/types';

/**
 * The party filter row: the parties worth a chip, and everything else behind
 * "More…".
 *
 * Two pages rendered this by hand — the Close Calls list view and the Party
 * List Rankings page — including the print chips, the teal dot and the
 * "More…" select, with the same classes and the same conditional highlight.
 * `selected` is the party the caller is actually showing, so a page that
 * defaults to the first major party highlights it without repeating the rule.
 */
export function PartyFilterChips({
  majorParties,
  otherParties,
  selected,
  onSelect,
}: {
  /** Parties shown as chips, in editorial order. */
  majorParties: string[];
  /** Everything else, offered through the select. */
  otherParties: string[];
  /** The party currently shown, or '' when none is. */
  selected: string;
  /** Called with the party whose chip or option was chosen. */
  onSelect: (party: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {majorParties.map((party) => (
        <button
          key={party}
          onClick={() => onSelect(party)}
          className={cn(
            'chip-print transition-colors',
            party === selected
              ? 'bg-foreground text-background border-foreground'
              : 'hover:bg-muted/40'
          )}
        >
          <PartyDot color={partyColor(party)} />
          {party}
        </button>
      ))}

      {otherParties.length > 0 && (
        <select
          value={majorParties.includes(selected) ? '' : selected}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          className="chip-print bg-background hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <option value="">More…</option>
          {otherParties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * One party's candidate list, with the cut drawn where the seats run out.
 *
 * `members` arrives already filtered and sorted by adjusted rank; the card
 * does not decide who is in the list, only how a list reads. A candidate who
 * won an electorate is marked and reads no rank or cut distance (they are in
 * Parliament either way), which is why `electorateForCandidate` is optional:
 * the Close Calls view has already removed those candidates, so it passes
 * nothing and every row shows its rank.
 *
 * The cut is drawn where the "From cut" column crosses zero: after the last
 * row printing a non-negative distance. An electorate winner prints no
 * distance at all — they take a seat whether or not they sat above the list
 * cut — so they count as above it too. Counting on `distanceFromCut` alone
 * would drop the line into the middle of the winners the page sorts to the
 * top when "Show electorate leaders" is on.
 */
export function PartyListCard({
  party,
  members,
  electorateForCandidate,
  revealDelay,
  rowDelayBase = 0,
  rowDelayStep = 0.04,
}: {
  party: string;
  members: PartyListResult[];
  /** Candidate → electorate name, for the link and the electorate-seat rule. */
  electorateForCandidate?: Map<string, string>;
  /** Seconds before the card reveals; omit for a card that is not revealed. */
  revealDelay?: number;
  /** Seconds before the first row reveals, on top of `revealDelay`. */
  rowDelayBase?: number;
  rowDelayStep?: number;
}) {
  const electorateOf = electorateForCandidate ?? new Map<string, string>();
  const lastAboveCut = members.reduce(
    (last, member, index) =>
      member.distanceFromCut >= 0 || electorateOf.has(member.candidate)
        ? index
        : last,
    -1
  );
  const cutIndex = lastAboveCut + 1;
  const wrapperStyle: CSSProperties | undefined =
    revealDelay === undefined
      ? undefined
      : { animationDelay: `${revealDelay}s` };

  return (
    <div
      className={cn(
        'border overflow-hidden',
        revealDelay !== undefined && 'opacity-0 animate-fade-in-up'
      )}
      style={wrapperStyle}
    >
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border font-display font-bold text-sm sm:text-base tracking-tight flex items-center gap-2">
        <PartyDot color={partyColor(party)} size="md" />
        {party}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b">
              <Th className="w-14">List</Th>
              <Th className="w-14">Rank</Th>
              <Th>Candidate</Th>
              <Th align="right" className="w-24">
                From Cut
              </Th>
            </tr>
          </thead>
          <tbody>
            {members.flatMap((member, index) => {
              const electorate = electorateOf.get(member.candidate);
              const isElected = member.distanceFromCut >= 0 || !!electorate;
              const rows = [];

              if (index === cutIndex && cutIndex < members.length) {
                rows.push(
                  <tr key="cut-line">
                    <td colSpan={4} className="px-0 py-0">
                      <div className="relative flex items-center py-1">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t-2 border-brand" />
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-background px-3 font-label text-xs font-bold tracking-widest uppercase text-brand">
                            Cut
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }

              rows.push(
                <tr
                  key={member.candidate}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/20',
                    isElected ? 'bg-green-700/5 dark:bg-green-950/20' : '',
                    'opacity-0 animate-fade-in-up'
                  )}
                  style={{
                    animationDelay: `${rowDelayBase + index * rowDelayStep}s`,
                  }}
                >
                  <td className="py-2 sm:py-3 px-3 text-muted-foreground tabular-nums font-semibold">
                    {member.listRank}
                  </td>
                  <td className="py-2 sm:py-3 px-3 tabular-nums font-bold">
                    {electorate ? null : member.adjustedRank}
                  </td>
                  <td className="py-2 sm:py-3 px-3 font-semibold">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {member.candidate}
                      {electorate && (
                        <Link
                          to={`/electorates/${encodeURIComponent(electorate)}`}
                          className="chip-print chip-print--table hover:bg-muted/40 transition-colors"
                        >
                          {electorate}
                        </Link>
                      )}
                    </span>
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    {electorate ? null : isElected ? (
                      <span className="text-green-700 dark:text-green-400">
                        +{Math.round(member.distanceFromCut)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {Math.round(member.distanceFromCut)}
                      </span>
                    )}
                  </td>
                </tr>
              );

              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const partyColors: Record<string, string> = {
  'National Party': '#00529F',
  'Labour Party': '#D82A20',
  'Green Party': '#098137',
  'ACT New Zealand': '#FFD700',
  'New Zealand First Party': '#333333',
  'Te Pāti Māori': '#000000',
  // TOP's own brand teal, taken from its registered logo artwork
  // (opportunity-logo-teal.svg, "Opportunity Logo (RGB teal)") rather than
  // eyeballed: the party describes itself as blue-green and keeps the teal
  // through the 2026 rename to Opportunity Party.
  'Opportunity Party': '#00B9BC',
  // The same party's name before it was registered as "Opportunity Party" on
  // 28 January 2026; the 2023 archive and the mock feed still say this.
  'The Opportunities Party (TOP)': '#00B9BC',
};

/**
 * Party names from an earlier cycle that now belong to a registered party,
 * keyed by the earlier name and valued with the current registered name. The
 * Electoral Commission renames parties without changing their `p_no`: party 24
 * is "The Opportunities Party (TOP)" (abbrev TOP) in the 2023 archive and
 * "Opportunity Party" (abbrev OPP) in the live 2026 feed. Chips, colours and
 * ordering all resolve through `canonicalPartyName`, because a hardcoded 2023
 * name would drop the party from every pick list and paint it grey while the
 * feed's own label still rendered.
 *
 * Only a rename belongs here: a party that merged or split is a different
 * party and must not inherit another's colour or its place in the filter row.
 * Both spellings stay in `partyColors` so a 2023 archive still draws its lines
 * in TOP's teal; this table is what collapses them into one entry on screen.
 */
export const PARTY_RENAMES: Record<string, string> = {
  'The Opportunities Party (TOP)': 'Opportunity Party',
};

/** The current name for a party that has been renamed since an earlier cycle. */
export function canonicalPartyName(party: string): string {
  return PARTY_RENAMES[party] ?? party;
}

/**
 * A party's brand colour for the name the feed publishes, with a neutral
 * fallback. Both spellings carry the colour, but the double lookup costs
 * nothing and protects a third spelling.
 */
export function partyColor(
  party: string | null | undefined,
  fallback = '#666'
): string {
  if (!party) return fallback;
  return (
    partyColors[party] ?? partyColors[canonicalPartyName(party)] ?? fallback
  );
}

/**
 * Every party that has a colour, under its current name, in palette order.
 * One per party: the filter row on the Trends page is built from this, so a
 * renamed party cannot appear twice.
 */
export const PARTY_FILTER_NAMES: string[] = [
  ...new Set(Object.keys(partyColors).map(canonicalPartyName)),
];

/**
 * Fixed editorial order for the parties shown as chips. Deliberately static:
 * a list that reordered as results arrived would move a button out from under
 * a finger mid-tap. Any party registered for the cycle that is not listed here
 * still appears, behind "More…".
 *
 * Opportunity is here because its list sits close enough to the cut to be worth
 * watching, not because the app considers it one of the five major parties.
 */
export const MAJOR_PARTY_ORDER: readonly string[] = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
  'Opportunity Party',
];

export const MAJOR_PARTIES = new Set<string>(MAJOR_PARTY_ORDER);

export function isMajorParty(party: string): boolean {
  return MAJOR_PARTIES.has(canonicalPartyName(party));
}

/** Sort parties into the editorial order; unlisted parties keep arrival order after. */
export function orderParties(parties: string[]): string[] {
  const rank = (party: string) => {
    const idx = MAJOR_PARTY_ORDER.indexOf(canonicalPartyName(party));
    return idx === -1 ? MAJOR_PARTY_ORDER.length : idx;
  };
  return [...parties]
    .map((party, i) => ({ party, i, rank: rank(party) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ party }) => party);
}

/**
 * Split the parties present in the payload into the chipped majors and the
 * rest behind "More…". Labels stay exactly as the feed writes them, so a
 * renamed party shows this cycle's name rather than a stale one.
 */
export function splitParties(parties: string[]): {
  major: string[];
  other: string[];
} {
  const major: string[] = [];
  const other: string[] = [];
  for (const party of parties) {
    (isMajorParty(party) ? major : other).push(party);
  }
  return { major: orderParties(major), other };
}

export function buildElectorateLookup(
  electorateResults: {
    electorateName: string;
    leaders: { leadingCandidate: string };
  }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of electorateResults) {
    map.set(r.leaders.leadingCandidate, r.electorateName);
  }
  return map;
}

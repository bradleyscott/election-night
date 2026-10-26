export const partyColors: Record<string, string> = {
  'National Party': '#00529F',
  'Labour Party': '#D82A20',
  'Green Party': '#098137',
  'ACT New Zealand': '#FFD700',
  'New Zealand First Party': '#333333',
  'Te Pāti Māori': '#000000',
  // TOP's own brand teal (`--brand-teal` on opportunity.org.nz, and the fill in
  // their logo), not the greener teal some indexes list.
  'Opportunity Party': '#00B9BC',
  // The same party's name before it was registered as "Opportunity Party" on
  // 28 January 2026; the 2023 archive and the mock feed still say this.
  'The Opportunities Party (TOP)': '#00B9BC',
};

/**
 * Parties that get their own button, in this order, on the Close Calls
 * list-cut rotation and the party list rankings page. Everything outside this
 * list is reachable from the "More…" menu instead.
 *
 * Opportunity is here because its list sits close enough to the cut to be worth
 * watching, not because the app considers it one of the five major parties.
 */
export const MAJOR_PARTY_ORDER = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
  'Opportunity Party',
] as const;

export const MAJOR_PARTIES = new Set<string>(MAJOR_PARTY_ORDER);

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

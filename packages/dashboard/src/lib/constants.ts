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

export const MAJOR_PARTY_ORDER = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
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

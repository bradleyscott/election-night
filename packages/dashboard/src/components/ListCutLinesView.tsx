import { useMemo } from 'react';
import { buildElectorateLookup } from '../lib/constants.js';
import { WaitingState } from './WaitingState.js';
import { PartyFilterChips, PartyListCard } from './PartyListCard.js';
import type {
  ElectorateResult,
  PartyListResult,
} from '@election-night/core/types';

export function ListCutLinesView({
  partyLists,
  electorateResults,
  selectedParty,
  majorParties,
  otherParties,
  onPartyClick,
}: {
  partyLists: PartyListResult[];
  electorateResults: ElectorateResult[];
  selectedParty: string;
  majorParties: string[];
  otherParties: string[];
  onPartyClick: (party: string) => void;
}) {
  const electorateForCandidate = useMemo(
    () => buildElectorateLookup(electorateResults),
    [electorateResults]
  );

  const activeParty = selectedParty;

  const members = useMemo(() => {
    if (!activeParty) return { above: [], below: [] };
    const party = partyLists.filter(
      (l) => l.party === activeParty && !electorateForCandidate.has(l.candidate)
    );
    const sorted = [...party].sort((a, b) => a.adjustedRank - b.adjustedRank);

    const aboveCut = sorted.filter((m) => m.distanceFromCut >= 0);
    const belowCut = sorted.filter((m) => m.distanceFromCut < 0);

    const above = aboveCut.slice(-3);
    const below = belowCut.slice(0, 3);

    return { above, below };
  }, [partyLists, activeParty, electorateForCandidate]);

  const allMembers = useMemo(
    () => [...members.above, ...members.below],
    [members]
  );

  if (!partyLists.length) {
    return <WaitingState variant="compact" context="parties" />;
  }

  return (
    <div className="space-y-3">
      <PartyFilterChips
        majorParties={majorParties}
        otherParties={otherParties}
        selected={activeParty}
        onSelect={onPartyClick}
      />

      {activeParty && (
        <PartyListCard
          party={activeParty}
          members={allMembers}
          electorateForCandidate={electorateForCandidate}
        />
      )}
    </div>
  );
}

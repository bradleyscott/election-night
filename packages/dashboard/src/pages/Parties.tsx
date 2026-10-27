import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { splitParties, buildElectorateLookup } from '../lib/constants.js';
import {
  PartyFilterChips,
  PartyListCard,
} from '../components/PartyListCard.js';
import type { PartyListResult } from '@election-night/core/types';
import { PageHead, PageWaiting } from '../components/Page.js';

export default function Parties() {
  const { results } = useResults();
  const [searchParams] = useSearchParams();
  const [selectedParty, setSelectedParty] = useState<string>(
    searchParams.get('party') ?? ''
  );
  const [showElectorateLeaders, setShowElectorateLeaders] = useState(false);

  useEffect(() => {
    setSelectedParty(searchParams.get('party') ?? '');
  }, [searchParams]);

  const partyLists = (results?.partyLists ?? []) as PartyListResult[];

  const electorateForCandidate = useMemo(
    () =>
      results?.electorateResults
        ? buildElectorateLookup(results.electorateResults)
        : new Map<string, string>(),
    [results?.electorateResults]
  );

  const allParties = useMemo(
    () => [...new Set(partyLists.map((l) => l.party))],
    [partyLists]
  );
  const { major: majorParties, other: otherParties } = useMemo(
    () => splitParties(allParties),
    [allParties]
  );
  const parties = selectedParty
    ? [selectedParty]
    : majorParties.length
      ? [majorParties[0]]
      : allParties;

  if (!partyLists.length) {
    return <PageWaiting title="Party List Rankings" context="parties" />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHead title="Party List Rankings" />

      <PartyFilterChips
        majorParties={majorParties}
        otherParties={otherParties}
        selected={selectedParty || majorParties[0] || ''}
        onSelect={(party) =>
          setSelectedParty(selectedParty === party ? '' : party)
        }
      />

      <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-muted-foreground">
        <input
          type="checkbox"
          checked={showElectorateLeaders}
          onChange={(e) => setShowElectorateLeaders(e.target.checked)}
          className="accent-brand size-4"
        />
        Show electorate leaders
      </label>

      {parties.map((party, pIdx) => {
        const members = partyLists
          .filter(
            (l) =>
              l.party === party &&
              (showElectorateLeaders ||
                !electorateForCandidate.has(l.candidate))
          )
          .sort((a, b) => {
            const aIsLeader = electorateForCandidate.has(a.candidate);
            const bIsLeader = electorateForCandidate.has(b.candidate);
            if (aIsLeader !== bIsLeader) return aIsLeader ? -1 : 1;
            return a.adjustedRank - b.adjustedRank;
          });

        return (
          <PartyListCard
            key={party}
            party={party}
            members={members}
            electorateForCandidate={electorateForCandidate}
            revealDelay={pIdx * 0.1}
            rowDelayBase={pIdx * 0.1 + 0.1}
            rowDelayStep={0.03}
          />
        );
      })}
    </div>
  );
}

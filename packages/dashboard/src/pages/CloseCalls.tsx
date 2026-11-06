import { useState, useEffect, useMemo } from 'react';
import { useResults } from '../hooks/useResults.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { Toggle } from '../components/Toggle.js';
import { ElectorateRacesView } from '../components/ElectorateRacesView.js';
import { ListCutLinesView } from '../components/ListCutLinesView.js';
import { splitParties } from '../lib/constants.js';
import { hasCounted } from '../lib/results.js';
import { PageHead, PageWaiting } from '../components/Page.js';
import type {
  ElectorateResult,
  PartyListResult,
} from '@election-night/core/types';

/**
 * Close Calls: the close races and the party list cut lines, on a page of their
 * own. The chance of winning each seat is computed here, from the same
 * `useSeatChances` the Seats page and the map call, so no two surfaces can
 * quote different numbers for one seat.
 */
export default function CloseCalls() {
  const { results } = useResults();
  const [view, setView] = useState('list');

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];
  const partyLists = (results?.partyLists ?? []) as PartyListResult[];

  const { chances } = useSeatChances(electorates);

  const allParties = useMemo(
    () => [...new Set(partyLists.map((l) => l.party))],
    [partyLists]
  );
  const { major: majorParties, other: otherParties } = useMemo(
    () => splitParties(allParties),
    [allParties]
  );

  // Which party's cut line is open. The chips are the only thing that moves it:
  // it used to cycle on a timer, which changed the table under a reader who was
  // in the middle of reading it.
  const [selectedParty, setSelectedParty] = useState<string>('');

  useEffect(() => {
    if (!!selectedParty || !majorParties.length) return;
    setSelectedParty(majorParties[0]);
  }, [majorParties, selectedParty]);

  // Both views are derived from the count: before a vote is counted every
  // candidate is "1 to 72 places below their party's cut" (no party has won a
  // seat yet), which reads as a result rather than as an absence of one. The
  // zeroed ballot still carries the party lists, so the length test alone let
  // that through. Await the count, as the Seats and Feed pages do.
  if (!hasCounted(results)) {
    return <PageWaiting title="Close Calls" context="closecalls" />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <PageHead title="Close Calls" className="mb-0" />
        <Toggle
          options={[
            { value: 'list', label: 'List Cut Lines' },
            { value: 'electorates', label: 'Electorate Races' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === 'electorates' ? (
        <ElectorateRacesView electorates={electorates} chances={chances} />
      ) : (
        <ListCutLinesView
          partyLists={partyLists}
          electorateResults={electorates}
          selectedParty={selectedParty}
          majorParties={majorParties}
          otherParties={otherParties}
          onPartyClick={setSelectedParty}
        />
      )}
    </div>
  );
}

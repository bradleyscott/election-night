import { useState, useEffect, useMemo, useCallback } from 'react';
import { useResults } from '../hooks/useResults.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from '../components/WaitingState.js';
import { Toggle } from '../components/Toggle.js';
import { ElectorateRacesView } from '../components/ElectorateRacesView.js';
import { ListCutLinesView } from '../components/ListCutLinesView.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyListEntry = PartyList & WithAdjustedRank;

const MAJOR_PARTY_ORDER = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
] as const;

const MAJOR_PARTIES = new Set<string>(MAJOR_PARTY_ORDER);

export default function CloseCalls() {
  const { results } = useResults();
  const [view, setView] = useState('electorates');

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];
  const partyLists = (results?.partyLists ?? []) as PartyListEntry[];

  const allParties = useMemo(
    () => [...new Set(partyLists.map((l) => l.party))],
    [partyLists]
  );
  const allPartiesSet = useMemo(() => new Set(allParties), [allParties]);
  const majorParties: string[] = useMemo(
    () => MAJOR_PARTY_ORDER.filter((p) => allPartiesSet.has(p)),
    [allPartiesSet]
  );
  const otherParties = useMemo(
    () => allParties.filter((p) => !MAJOR_PARTIES.has(p)),
    [allParties]
  );

  const [selectedParty, setSelectedParty] = useState<string>('');
  const [autoRotate, setAutoRotate] = useState(true);
  const [countdown, setCountdown] = useState(5);

  const rotate = useCallback(() => {
    if (!majorParties.length) return;
    setSelectedParty((prev) => {
      const idx = prev ? majorParties.indexOf(prev) : -1;
      return majorParties[(idx + 1) % majorParties.length];
    });
    setCountdown(5);
  }, [majorParties]);

  useEffect(() => {
    if (!!selectedParty || !majorParties.length) return;
    setSelectedParty(majorParties[0]);
  }, [majorParties, selectedParty]);

  useEffect(() => {
    if (view !== 'list' || !autoRotate || !majorParties.length) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          rotate();
          return 5;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [view, autoRotate, majorParties, rotate]);

  const handlePartyClick = (party: string) => {
    if (selectedParty === party) {
      setAutoRotate(true);
    } else {
      setSelectedParty(party);
      setAutoRotate(false);
    }
    setCountdown(5);
  };

  const isEmpty = !electorates.length && !partyLists.length;

  if (isEmpty) {
    return (
      <div className="animate-fade-in">
        <div className="pagehead">
          <h1>Close Calls</h1>
        </div>
        <WaitingState context="closecalls" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="pagehead mb-0">
          <h1>Close Calls</h1>
        </div>
        <div className="flex items-center gap-3">
          {view === 'list' && majorParties.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-bold tabular-nums">
              <span className="text-muted-foreground">Next in</span>
              <span
                className={cn(
                  'w-7 h-7 flex items-center justify-center border font-mono',
                  autoRotate
                    ? 'bg-muted text-foreground border-border'
                    : 'bg-muted text-muted-foreground/50 border-muted/60'
                )}
              >
                {autoRotate ? countdown : '—'}
              </span>
            </div>
          )}
          <Toggle
            options={[
              { value: 'electorates', label: 'Electorate Races' },
              { value: 'list', label: 'List Cut Lines' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {view === 'electorates' ? (
        <div
          className={cn(
            'border opacity-0 animate-fade-in-up'
          )}
        >
          <ElectorateRacesView electorates={electorates} />
        </div>
      ) : (
        <ListCutLinesView
          partyLists={partyLists}
          electorateResults={electorates}
          selectedParty={selectedParty}
          majorParties={majorParties}
          otherParties={otherParties}
          onPartyClick={handlePartyClick}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import {
  useElectorateHistory,
  usePriorWinners,
} from '../hooks/useVoteHistory.js';
import { MapControls } from '../components/MapControls.js';
import { ElectorateDetail } from '../components/ElectorateDetail.js';
import ElectorateMap from '../components/ElectorateMap.js';
import {
  isMaoriElectorate,
  normalizeElectorateName,
} from '../lib/electorates.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { usePollsClose } from '../hooks/usePollsClose.js';
import { useVotingPlaces } from '../hooks/useVotingPlaces.js';
import { cn } from '../lib/utils.js';
import type {
  ElectorateResults,
  WithLeaders,
} from '@election-night/core/types';
import { PageHead, PageWaiting } from '../components/Page.js';

type ElectorateResult = ElectorateResults & WithLeaders;

export default function Electorates() {
  const { name } = useParams();
  const { results, updatedAt } = useResults();
  const { closesAt } = usePollsClose();

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];

  const [showMaori, setShowMaori] = useState(false);
  const [showPartyVote, setShowPartyVote] = useState(false);

  const selectedName = name ? decodeURIComponent(name) : null;

  useEffect(() => {
    if (selectedName && isMaoriElectorate(selectedName)) {
      setShowMaori(true);
    }
  }, [selectedName]);

  const electorateNames = electorates
    .filter((e) => showMaori === isMaoriElectorate(e.electorateName))
    .map((e) => e.electorateName);

  const selectedElectorate = selectedName
    ? electorates.find((e) => e.electorateName === selectedName)
    : null;

  // Every seat's chance, not just the open one: the map's shading is this
  // number, so a seat at even odds is painted pale and one that is gone is
  // solid. The swing behind it is measured across every seat at once.
  const { chances } = useSeatChances(electorates);

  const chance = selectedElectorate
    ? (chances.get(
        normalizeElectorateName(selectedElectorate.electorateName)
      ) ?? null)
    : null;

  const pollsCloseLabel = useMemo(() => {
    if (!closesAt || closesAt.getTime() <= Date.now()) return null;
    return new Intl.DateTimeFormat('en-NZ', {
      hour: 'numeric',
      hour12: true,
      timeZone: 'Pacific/Auckland',
    })
      .format(closesAt)
      .replace('\u00a0', '')
      .replace(' ', '')
      .toLowerCase();
  }, [closesAt]);

  const { data: historyData } = useElectorateHistory(selectedName);
  // Which places count towards the seat and which have reported: the map draws
  // them, and the count chart draws their receipt times as a rug, so the page
  // owns the request rather than each of them asking separately.
  const { summary: places, loading: placesLoading } =
    useVotingPlaces(selectedName);
  const votingPlaces = useMemo(() => {
    if (!places) return undefined;
    return {
      counted: places.counted,
      total: places.total,
      receipts: places.places
        .map((p) => p.countedAt)
        .filter((t): t is string => t !== null)
        .map((t) => new Date(t).getTime())
        .filter((t) => Number.isFinite(t)),
    };
  }, [places]);
  // Prior winners are only worth fetching once a seat is open: the collector
  // derives them lazily from the archive on first request.
  const {
    data: prior,
    unavailable: priorUnavailable,
    loading: priorLoading,
  } = usePriorWinners(!!selectedName);

  const priorWinners = useMemo(() => {
    if (!selectedName || !prior) return [];
    return prior.years.flatMap((year) =>
      year.winners.filter((w) => w.electorateName === selectedName)
    );
  }, [prior, selectedName]);

  if (!electorates.length) {
    return <PageWaiting title="Electorates" context="electorates" />;
  }

  return (
    <div className="space-y-4">
      <PageHead title="Electorates" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div
          className={cn(
            selectedElectorate ? '' : 'lg:col-span-2',
            'border overflow-hidden opacity-0 animate-fade-in-up'
          )}
          style={{ animationDelay: '0.1s' }}
        >
          <MapControls
            names={electorateNames}
            showMaori={showMaori}
            onShowMaoriChange={setShowMaori}
            showClear={!!selectedElectorate}
          />
          <ElectorateMap
            electorates={electorates}
            selectedName={selectedName ?? undefined}
            showMaori={showMaori}
            showPartyVote={showPartyVote}
            chances={chances}
            places={places}
            placesLoading={placesLoading}
          />
        </div>

        {selectedElectorate && (
          <ElectorateDetail
            result={selectedElectorate}
            showPartyVote={showPartyVote}
            onTogglePartyVote={setShowPartyVote}
            historyData={historyData}
            votingPlaces={votingPlaces}
            priorWinners={priorLoading ? undefined : priorWinners}
            priorUnavailable={priorUnavailable}
            chance={chance}
            updatedAt={updatedAt}
            pollsCloseLabel={pollsCloseLabel}
          />
        )}
      </div>
    </div>
  );
}

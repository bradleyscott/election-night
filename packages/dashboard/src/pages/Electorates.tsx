import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { useElectorateHistory } from '../hooks/useVoteHistory.js';
import { ElectorateSearch } from '../components/ElectorateSearch.js';
import { Toggle } from '../components/Toggle.js';
import { ElectorateDetail } from '../components/ElectorateDetail.js';
import ElectorateMap, {
  MAORI_ELECTORATES,
} from '../components/ElectorateMap.js';
import { WaitingState } from '../components/WaitingState.js';
import { cn } from '../lib/utils.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

export default function Electorates() {
  const { name } = useParams();
  const { results } = useResults();

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];

  const [showMaori, setShowMaori] = useState(false);
  const [showPartyVote, setShowPartyVote] = useState(false);

  const selectedName = name ? decodeURIComponent(name) : null;

  useEffect(() => {
    if (selectedName && MAORI_ELECTORATES.has(selectedName)) {
      setShowMaori(true);
    }
  }, [selectedName]);

  const electorateNames = electorates
    .filter((e) => showMaori === MAORI_ELECTORATES.has(e.electorateName))
    .map((e) => e.electorateName);

  const selectedElectorate = selectedName
    ? electorates.find((e) => e.electorateName === selectedName)
    : null;

  const { data: historyData } = useElectorateHistory(selectedName);

  if (!electorates.length) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-1">
          Electorates
        </h1>
        <div className="h-1 w-16 bg-gradient-brand rounded-full mb-2" />
        <WaitingState context="electorates" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Electorates
          </h1>
          <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ElectorateSearch names={electorateNames} />
          <Toggle
            options={[
              { value: 'general', label: 'General' },
              { value: 'maori', label: 'Māori' },
            ]}
            value={showMaori ? 'maori' : 'general'}
            onChange={(v) => setShowMaori(v === 'maori')}
          />
          {selectedElectorate && (
            <Link
              to="/electorates"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-2 min-h-[44px] flex items-center font-bold"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
              <span className="hidden sm:inline">Clear</span>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div
          className={cn(
            selectedElectorate ? '' : 'lg:col-span-2',
            'rounded-xl overflow-hidden border shadow-sm opacity-0 animate-fade-in-up'
          )}
          style={{ animationDelay: '0.1s' }}
        >
          <ElectorateMap
            electorates={electorates}
            selectedName={selectedName ?? undefined}
            showMaori={showMaori}
            showPartyVote={showPartyVote}
          />
        </div>

        {selectedElectorate && (
          <ElectorateDetail
            result={selectedElectorate}
            showPartyVote={showPartyVote}
            onTogglePartyVote={setShowPartyVote}
            historyData={historyData}
          />
        )}
      </div>
    </div>
  );
}

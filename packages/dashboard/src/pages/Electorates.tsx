import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { useElectorateHistory } from '../hooks/useVoteHistory.js';
import VoteHistoryChart from '../components/VoteHistoryChart.js';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import ElectorateMap, {
  MAORI_ELECTORATES,
} from '../components/ElectorateMap.js';
import { WaitingState } from '../components/WaitingState.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  WithParty,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

function ElectorateSearch({ names }: { names: string[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = query
    ? names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : names;

  return (
    <div className="relative w-full sm:w-auto text-sm">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search electorate…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="w-full sm:w-56 px-3 py-2 sm:py-1.5 border rounded-lg bg-background text-sm font-semibold outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 transition-shadow"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg max-h-64 overflow-y-auto z-50 animate-fade-in">
          {filtered.map((name) => (
            <li
              key={name}
              onMouseDown={() => {
                navigate(`/electorates/${encodeURIComponent(name)}`);
                setOpen(false);
                setQuery('');
              }}
              className="px-3 py-2 sm:py-1.5 cursor-pointer hover:bg-accent border-b last:border-0 transition-colors font-semibold"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {open && query && filtered.length === 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-50 animate-fade-in">
          <li className="px-3 py-2 sm:py-1.5 text-muted-foreground font-semibold">No matches</li>
        </ul>
      )}
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex rounded-lg border overflow-hidden text-sm font-bold flex-shrink-0">
      <button
        className={cn(
          'px-3 py-2 sm:py-1.5 transition-colors min-h-[44px] font-bold',
          !value ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:text-foreground'
        )}
        onClick={() => onChange(false)}
      >
        General
      </button>
      <button
        className={cn(
          'px-3 py-2 sm:py-1.5 transition-colors min-h-[44px] font-bold',
          value ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:text-foreground'
        )}
        onClick={() => onChange(true)}
      >
        Māori
      </button>
    </div>
  );
}

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

  const leadingPartyVote = selectedElectorate
    ? [...selectedElectorate.partyVotes].sort((a, b) => b.votes - a.votes)[0]
    : null;

  const { data: historyData } = useElectorateHistory(selectedName);

  if (!electorates.length) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-1">Electorates</h1>
        <div className="h-1 w-16 bg-gradient-brand rounded-full mb-2" />
        <WaitingState context="electorates" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Electorates</h1>
          <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ElectorateSearch names={electorateNames} />
          <Toggle value={showMaori} onChange={setShowMaori} />
          {selectedElectorate && (
            <Link
              to="/electorates"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-2 min-h-[44px] flex items-center font-bold"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
          <div className="space-y-3 sm:space-y-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {selectedElectorate.electorateName}
              </h2>
              <div className="flex rounded-lg border overflow-hidden text-sm font-bold flex-shrink-0">
                <button
                  className={cn(
                    'px-3 py-1.5 transition-colors',
                    !showPartyVote ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setShowPartyVote(false)}
                >
                  Candidate
                </button>
                <button
                  className={cn(
                    'px-3 py-1.5 transition-colors',
                    showPartyVote ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-background text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setShowPartyVote(true)}
                >
                  Party
                </button>
              </div>
            </div>
            {showPartyVote ? (
              <>
                <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                  <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                    Leading party
                  </div>
                  <div className="mt-0.5">
                    <div className="text-xl sm:text-2xl font-extrabold tracking-tight">
                      {leadingPartyVote?.candidate ?? 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/20"
                        style={{
                          backgroundColor: partyColors[leadingPartyVote?.candidate ?? ''] || '#666',
                        }}
                      />
                      <span className="text-xs sm:text-sm text-muted-foreground">
                        {leadingPartyVote ? `${leadingPartyVote.votes.toLocaleString()} votes` : ''}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Votes Counted
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {selectedElectorate.votesCounted.toLocaleString()}
                      </span>
                      <span className="ml-1 text-xs sm:text-sm text-muted-foreground/60 font-medium">
                        of {Math.round(selectedElectorate.votesCounted / selectedElectorate.votePercentageCounted).toLocaleString()} total
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      % Counted
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {(selectedElectorate.votePercentageCounted * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Leading candidate
                    </div>
                    <div className="mt-0.5">
                      <div className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {selectedElectorate.leaders.leadingCandidate}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/20"
                          style={{ backgroundColor: partyColors[selectedElectorate.leaders.leadingCandidateParty ?? ''] || '#666' }}
                        />
                        <span className="text-xs sm:text-sm text-muted-foreground">
                          {selectedElectorate.leaders.leadingCandidateParty ?? 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Status
                    </div>
                    <div className="mt-0.5">
                      <span
                        className={cn(
                          'text-xl sm:text-2xl font-extrabold tracking-tight',
                          selectedElectorate.leaders.predictionStatus === 'projected' && 'text-green-500',
                          selectedElectorate.leaders.predictionStatus === 'likely' && 'text-lime-500',
                          selectedElectorate.leaders.predictionStatus === 'leaning' && 'text-orange-500',
                          selectedElectorate.leaders.predictionStatus === 'too-close' && 'text-amber-500',
                          !selectedElectorate.leaders.predictionStatus && 'text-amber-500'
                        )}
                      >
                        {(selectedElectorate.leaders.predictionStatus === 'projected' || selectedElectorate.leaders.predictionStatus === 'likely') && 'Likely winner'}
                        {selectedElectorate.leaders.predictionStatus === 'leaning' && 'Leaning'}
                        {selectedElectorate.leaders.predictionStatus === 'too-close' && 'Too close to call'}
                        {!selectedElectorate.leaders.predictionStatus && 'Too close to call'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Margin
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {selectedElectorate.leaders.margin.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Lead
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {(selectedElectorate.leaders.marginPercent * 100).toFixed(1)}%
                        <span className="text-base sm:text-lg font-bold text-muted-foreground ml-1">
                          ± {(selectedElectorate.marginOfError * 100).toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      Votes Counted
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {selectedElectorate.votesCounted.toLocaleString()}
                      </span>
                      <span className="ml-1 text-xs sm:text-sm text-muted-foreground/60 font-medium">
                        of {Math.round(selectedElectorate.votesCounted / selectedElectorate.votePercentageCounted).toLocaleString()} total
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
                    <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
                      % Counted
                    </div>
                    <div className="mt-0.5">
                      <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                        {(selectedElectorate.votePercentageCounted * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {showPartyVote ? (
                        <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Party</th>
                      ) : (
                        <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Candidate</th>
                      )}
                      {!showPartyVote && (
                        <th className="text-left px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Party</th>
                      )}
                      <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Votes</th>
                      <th className="text-right px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showPartyVote
                      ? [...selectedElectorate.partyVotes]
                      : [...selectedElectorate.candidateVotes]
                    )
                      .sort((a, b) => b.votes - a.votes)
                      .map((c, i) => (
                        <tr
                          key={c.candidate}
                          className={cn(
                            'border-b last:border-0 transition-colors hover:bg-muted/30',
                            i === 0 ? 'font-bold' : 'font-semibold',
                            'opacity-0 animate-fade-in-up'
                          )}
                          style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                        >
                          {showPartyVote ? (
                            <td className="py-2 sm:py-3 px-3">
                              <div className="flex items-center gap-1.5">
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                                  style={{
                                    backgroundColor: partyColors[c.candidate] || '#666',
                                  }}
                                />
                                {c.candidate}
                              </div>
                            </td>
                          ) : (
                            <>
                              <td className="py-2 sm:py-3 px-3">{c.candidate}</td>
                              <td className="px-2">
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                                    style={{
                                      backgroundColor: partyColors[(c as typeof c & WithParty).party ?? ''] || '#666',
                                    }}
                                  />
                                  {(c as typeof c & WithParty).party ?? 'Independent'}
                                </div>
                              </td>
                            </>
                          )}
                          <td className="text-right px-2 tabular-nums">
                            {c.votes.toLocaleString()}
                          </td>
                          <td className="text-right px-3 tabular-nums">
                            {((c.votes / selectedElectorate.votesCounted) * 100).toFixed(1)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {historyData && historyData.length > 1 && (
              <VoteHistoryChart
                history={historyData}
                mode="votes"
                showParty={showPartyVote}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

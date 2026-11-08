# Election-night operational review: 7–8 November 2026

> **Status (2026-11-08): incident findings addressed.** This review records the
> election-night evidence as observed. The decisions that came out of it are in
> `docs/reliability-decisions-2026-11-08.md`; read the current architecture
> from `AGENTS.md`/`README.md`. The timeline below is historical and is not
> rewritten.

**Prepared:** 8 November 2026. All narrative times below are **NZDT (UTC+13)**.
7pm on 7 November is **06:00 UTC on 7 November**, not 07:00 UTC.

This supplements the [reliability decisions](reliability-decisions-2026-11-08.md)
with production observations recovered from prior OpenCode sessions, preserved
tool output, current retained history and Fly release records. No production
configuration, processes or data were changed during this investigation.

**Implementing agent:** read the
[reliability decisions](reliability-decisions-2026-11-08.md), which record what
now binds the code. This document is the incident/evidence record; its R1–R9
references identify findings, not a separate backlog.

## Executive summary

**Collection and persistence largely continued; serving history did not.** The
night had at least two substantial periods in which the collector's HTTP surface
was unreachable or unresponsive while the scrape loop, SQLite writes and live
Socket.IO publication continued. The dashboard concealed this difference by
serving cached history as ordinary successful responses. Consequently, a live
table could name a different leader from the chart beside it.

There were also independent problems:

- History hooks originally fetched once. They needed refresh even when the
  collector HTTP service was healthy. PR #132 added socket-triggered refresh.
- Generic “Waiting for more results” copy was used while already-collected data
  was merely loading. A local fix exists, but its session is not evidence it was
  deployed on the night.
- Different definitions of a “place”, turnout forecasts and changing progress
  denominators made count completion hard to interpret.
- Some investigations mixed a healthy **local mock** with failing **production**,
  and some assistant explanations contradicted their own tool output. Prior
  conclusions must therefore be checked against raw observations, not repeated
  as established root causes.

**The exact mechanism of the HTTP stall is not established.** CPU/event-loop
pressure is plausible, and restart/resize restored service, but both actions
happened together. A listening port and 30-second HTTP timeouts are confirmed;
“a dead listener”, `EMFILE`, “SQLite stopped writing” and “more CPU solved the root
cause” are not established explanations of the second incident.

## Evidence and limitations

Sources are indexed at the end as S1–S8. Their tool outputs are stronger evidence
than their assistant summaries.

- Queried OpenCode's read-only session/message API for project sessions, including
  the full Mt Roskill, telemetry, Nelson, Trends, Mt Albert and next-day count
  investigations. Read selected messages from the specials/briefing session; an
  oversized tool-containing message prevented a complete paginated export of that
  session through the CLI. No unrelated project history was examined.
- Queried `fly releases --app election-night --json` and the current Fly log buffer.
  The buffer contained **100 recent records**, approximately 13:59–14:01 on
  8 November, not the full previous night. It cannot establish the 19:00 startup.
  Historical production log excerpts below were preserved in the overnight
  OpenCode tool outputs. A full historical Grafana/Loki log export was not obtained.
- Re-read `/api/history/party-votes` on 8 November: **357 snapshots**, beginning
  at 19:06:19 on 7 November and ending at 14:02:19 on 8 November. The first
  354 cover the active night through 02:24:43. Subsequent duplicate end-state
  snapshots coincide approximately with later releases/restarts.
- Did not retrieve historical CPU scheduling, disk, heap, event-loop or per-route
  traces. We have point-in-time metrics preserved in sessions, not a complete
  overnight metrics export. Request counts are process-local counters and must
  not be compared across restarts as if they were one monotonic series.

## Timeline

| NZDT              | UTC                | Observation / intervention                                                                                                                                                | Evidence                      |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 18:18:15, 7 Nov   | 05:18:15           | Fly release v108, image `b8994a1`, completed before polls closed.                                                                                                         | S7                            |
| 19:00             | 06:00              | Polls-close instant in the runtime configuration.                                                                                                                         | S1/S6                         |
| 19:06:19          | 06:06:19           | First retained snapshot: 28,469 counted votes aggregated across electorates.                                                                                              | S6                            |
| 19:24:08          | 06:24:08           | The aggregate reached 25% of its eventual night-end total.                                                                                                                | S6; retrospective denominator |
| 20:02:51          | 07:02:51           | Aggregate reached 50% of its eventual night-end total.                                                                                                                    | S6                            |
| 20:15:53          | 07:15:53           | Last cached Mt Roskill/party-history snapshot later seen during the first outage: #66. This is a last-good-data timestamp, not a proven exact HTTP failure time.          | S1                            |
| 20:21–20:51       | 07:21–07:51        | Nelson specials analysis; exposed a historical-parser defect and inconsistent explanation of remaining ordinary votes.                                                    | S4                            |
| 20:45:46          | 07:45:46           | User reported Trends implying more votes were needed when it was actually loading history. Loading-state fix prepared locally.                                            | S3                            |
| 21:29:53–21:30:20 | 08:29:53–08:30:20  | User reported missing Grafana telemetry and Mt Roskill chart/table disagreement.                                                                                          | S1/S2                         |
| 21:32–21:37       | 08:32–08:37        | Production returned cached history #66 while live results moved. Collector metrics merge failed; dashboard `/health` still answered.                                      | S1                            |
| 21:35:45          | 08:35:45           | Commission Mt Roskill file: Cheung 8,793, Wood 8,692. Cached chart: Wood 6,011, Cheung 5,760.                                                                             | S1                            |
| 21:47–21:49       | 08:47–08:49        | PR #132 prepared/merged: fatal listener-error handling and socket-triggered history refresh.                                                                              | S1/S7                         |
| 21:51:27          | 08:51:27           | Fly release v109 (`a1da835`). The retained DB contains snapshots across the earlier serving outage. Exact first post-deploy healthy HTTP response was not preserved here. | S6/S7                         |
| 22:40:07          | 09:40:07           | Aggregate reached 90% of eventual night-end counted votes.                                                                                                                | S6                            |
| 23:08:57–23:13:20 | 10:08:57–10:13:20  | User asked whether the missing telemetry/stale-history condition had recurred. Initially production answered; the telemetry session checked localhost instead.            | S1/S2                         |
| 23:14–23:17       | 10:14–10:17        | Production metrics/history became intermittent, then briefly recovered through snapshot #201 at 23:17:04.                                                                 | S1                            |
| 23:20–23:29       | 10:20–10:29        | Mt Roskill proxy remained on #201 while DB writes advanced through at least #209. Direct collector HTTP requests timed out; port stayed listening.                        | S1                            |
| 23:27:53          | 10:27:53           | Fly's dashboard HTTP health check briefly failed as well.                                                                                                                 | S1 preserved Fly logs         |
| 23:31:53          | 10:31:53           | Existing machine restarted through a resize to 2 shared CPUs / 1,024 MB; image remained `a1da835`.                                                                        | S1                            |
| 23:32–23:35       | 10:32–10:35        | History recovered, snapshots #213–#217 advanced, collector metrics reachable returned to 1.                                                                               | S1                            |
| 23:35:09          | 10:35:09           | Fly release v110 (`4368c12`): metrics merge timeout increased and last-good exposition retained, PR #133.                                                                 | S7                            |
| 23:47–00:01       | 10:47–11:01        | Mt Albert reported “24/24 here” but still had outstanding seat results. Investigation showed the fractions covered different sets of places.                              | S5                            |
| 23:56:07          | 10:56:07           | Fly release v111 (`5a97069`): collector HTTP watchdog, PR #134.                                                                                                           | S7                            |
| 00:24:46, 8 Nov   | 11:24:46, 7 Nov    | Aggregate reached 99% of eventual night-end counted votes.                                                                                                                | S6                            |
| 02:23:29          | 13:23:29           | First retained snapshot with terminal aggregate 2,433,679 votes.                                                                                                          | S6                            |
| 02:24:43          | 13:24:43           | Stored history progress field reached 1.0; snapshot #354.                                                                                                                 | S6                            |
| 08:18:13          | 19:18:13, 7 Nov    | Quiet-period release v112 (`29b37ed`), daily polling/smaller machine configuration. A duplicate final snapshot followed at 08:18:43.                                      | S6/S7                         |
| 13:32–13:58       | 00:32–00:58, 8 Nov | User reported homepage still at 97.2% despite completed night. Completion/constant fix prepared and pushed as `989c40b`.                                                  | S6                            |
| 14:01:49          | 01:01:49           | Fly release v114 (`989c40b`), the count-completion fix.                                                                                                                   | S7                            |

**Do not reuse these percentages without their denominator.** The retrospective
25/50/90/99% milestones above divide each snapshot's counted total by the eventual
2,433,679 aggregate. They were not estimates available to visitors at the time,
and are not voting-place percentages. For example, the _stored history progress_
field reached 90% at 23:21:09, 95% at 00:17:26 and 99% at 02:14:41: different
times, because it measures something different.

The median snapshot-start gap is **69 seconds**. The longest gap before ordinary
completion is **5m20s**, at 01:38–01:43, not during either major history-serving
incident. This supports continued persistence; it does not prove every source
update was captured or each seat was fresh. Snapshot timestamps describe local
observation, not the Commission's publication instant.

## Incident 1: cached history concealed the live leader, around 20:16–21:51

At 21:33 a fresh production history request still returned:

```text
66 points; last snapshot #66 at 2026-11-07 07:15:53 UTC
Mt Roskill: 13,473 votes counted; Wood 6,011; Cheung 5,760
```

At 21:36 the Commission file instead reported 19,852 votes, Cheung 8,793 and
Wood 8,692. That made the stale chart materially misleading, not just cosmetically
behind: **it displayed the opposite leader**. Other seats and national history
were also pinned to older snapshots. The dashboard's current-result publication
timestamp continued advancing.

Production metrics preserved at 21:33 showed:

```text
election_collector_metrics_reachable 0
election_history_cache_events_total{result="stale"} 11995
election_history_upstream_requests_total{route="/history/electorate/:name",outcome="stale_served"} 3803
```

Dashboard `/health` returned 200; `/ready` returned a history error in this first
investigation because its snapshots probe had no useful cached answer. In the
later incident the same readiness design incorrectly returned success from cache.

**What was established:** history/metrics upstream delivery failed while live
publication continued; cached histories were served without a stale indication;
independent browser one-shot history fetching was also defective.

**What was only suspected:** a listener `error`, file-descriptor exhaustion or
another event killing the HTTP listener. Fly authentication was unavailable for
the initial investigator, and no corresponding fatal/listener-error log was
recovered. Failure to reach public `:3459` is not a useful test of a loopback-only
deployment. The next incident demonstrates why “HTTP unreachable” did not prove
the listener had died.

## Incident 2: bound-but-unresponsive HTTP, around 23:14–23:32

This is the strongest preserved evidence set:

1. At 23:13 production history had caught up to #198 and metrics were reachable.
2. At 23:14 it became intermittent, briefly reaching #201 at 23:17:04.
3. At 23:29 the same endpoint still returned #201. Stale-cache serves had reached
   2,026 on the then-running process.
4. Read-only SSH/database inspection showed newer persisted snapshots, including
   #209 completed at 23:27:34. The currently retained full history confirms
   persistence continued across this window.
5. Direct in-machine collector `/health` fetches timed out after 3s, 5s and 30s.
   A raw TCP connection succeeded, but the HTTP response did not arrive within 15s.
6. `/proc/net/tcp` showed port 3459 in LISTEN. The collector was running, around
   203 MB RSS, with roughly **100 open FDs against a 10,240 limit** at that sample.
   That sample does not support an active FD-limit-exhaustion diagnosis.
7. Production logs preserved from 23:25 show the divergence directly:

```text
10:25:02Z  DB write complete (scrape #207)
10:25:04Z  Collector metrics not merged ... This operation was aborted
10:25:07Z  Published results via socket.io
10:25:08Z  Received results update, broadcasting...
10:25:08Z  Generated 9 feed events
            [repeated API route failures in the same interval]
```

There were also multiple **webhook POST failures after retries** at 23:27:41,
followed by socket publication at 23:27:42. This makes webhook isolation in R4
an observed operational concern, though we do not have enough error detail here
to identify the webhook receiver's failure cause.

### Why the first fix did not prevent recurrence

PR #132's fatal `server.on('error')` handler cannot detect a listener that remains
bound but stops completing HTTP requests. Fly checked the healthy dashboard's
`/health`, not the collector's HTTP responsiveness. `/ready` was also insufficient:
at 23:21 it returned `ready: true`, `history: upstream`, with missing collector
identity while the history endpoint served stale data.

### Recovery and what it proves

At 23:31:53 the machine was restarted/resized to two shared CPUs and 1 GB.
Collector reachability returned to 1, history resumed through #213–#217 and the
Mt Roskill history matched the feed at the later verification.

That proves **restart/resize was an effective mitigation**. It does not isolate
which change helped. There was no event-loop profile, CPU-throttling series or
request-queue capture, and a JS loop that still scrapes is not proven globally
deadlocked. Keep CPU pressure, synchronous work, HTTP connection handling and
request overload as hypotheses. Do not declare the cause resolved by a CPU bump.

## Diagnostic quality: localhost was not production

The parallel telemetry investigation reported at 23:23 that the collector was
healthy, with 15ms metrics requests and rapidly advancing cycles. Its raw commands
targeted **`http://127.0.0.1:3459` on the developer Mac**. The health response said:

```text
source: NZ Election XML Feed (http://localhost:3457/)
socketUrl: ws://localhost:3456
lastVotesCounted: 1285500
```

That was a local mock replay, not the Fly machine. The response even acknowledged
it could not query production because Fly authentication had expired. The local
experiment can justify testing metrics fallback, but cannot rebut contemporaneous
production HTTP timeouts or identify their cause.

**Runbook requirement:** every diagnostic excerpt should include environment,
host, app, machine, deployed revision, source URL, cycle and UTC/NZDT timestamp.
Use one incident record to reconcile parallel investigators. Never infer production
health from a local development endpoint.

## Count and model issues actually encountered

### Mt Albert: “all booths here” was not “all results for this electorate”

At 23:53:46 the captured seat file reported **90/102** contributing places
(88.2%) and 29,239 votes. The geographic ledger showed **24/24 in-electorate
booths**. Both can be true: the latter excludes contributing places outside the
electorate. The underlying sets differ.

The directory listing contained **63 files**, which did not reconcile with the
seat's 102-place total. The earlier assistant attributed this to unpublished
per-place files, but no source evidence established that explanation. Retain this
as an unresolved feed-set discrepancy, not a reason to substitute 24 or 63 for
the authoritative seat reporting denominator.

**Action:** label the two sets explicitly, and handle directory/seat-total
disagreement as data provenance, not silent arithmetic. Do not declare the whole
seat complete merely because every plotted booth has reported.

### National 97.2%: forecast residue after reporting completed

The next-day user report was real: the homepage kept a forecast denominator after
all seats had reported. Low-turnout seats retained estimated uncounted votes,
even though there was no evidence they remained. Updating 2026 assumptions helped,
but the structural fix was making authoritative completion override the forecast.
That fix is now in `989c40b`, release v114.

The remaining presentation issue is unchanged: the seat band can switch from
night-progress to expected-final-vote share, including specials, while the homepage
shows ordinary completion. They require separate stable labels/visuals (R5).

The current retained seat aggregate is **2,433,679**. The next-day investigation
quoted **2,432,403** from the Commission's national preliminary release: a
**1,276-vote discrepancy**. These are distinct sources/bases and must be reconciled,
not silently made equal. The preliminary specials estimate quoted then was about
399,365, versus the model's overnight 21% share assumption.

### Nelson: the raw model result and the explanation disagreed

The 20:21 investigation's captured model output included:

```text
counted: 28,816; places fraction: 0.447
remainingVotes: 35,649; progress: 0.447
specialsOutstanding: 6,613; probability: 0.5023
```

Its subsequent prose instead said about **4,300 ordinary votes** remained. The
smaller number was the turnout-only remainder; the implemented place-based
heuristic dominated and produced 35,649. This is concrete evidence that the
heuristic was not just an invisible safety net: it could dictate the quantity
readers were trying to understand. It also illustrates why prose generated from
memory is not a reliable worked example of the actual model output.

Do not infer either number was the true remaining count from this one sample.
Use this precise state as an R5/R7 regression and calibration fixture. Expose which
estimate dominates and why; reconcile a current model explanation with its actual
structured output before publishing it.

### A discovered specials parser defect was not closed out

The Nelson session found that 2017/2020 archived headers used
**`TotalValidCandidateVotes`**, without spaces. The parser only excludes
`/^(Total Valid|Informal)/i`, so it treated that total column as a candidate.
Preserved output literally selected `TotalValidCandidateVotes` as the “winner”.

This review independently reproduced the defect against the current parser using
a small synthetic table with that exact header. The pseudo-candidate remains in
both the total and specials dictionaries. The reported 2017 mean/sd of 2.32/2.16
were reproduced in the old session from this contaminated pool.

**Action before relying on calibration claims:** normalise/validate headers,
reject summary columns as candidates, regenerate versioned cached evidence, and
rerun all derived statistics/docs. Cached JSON must be invalidated by parser
version; fixing fresh parsing alone is insufficient. Do not silently narrow the
model's spread based on the existing “4.75 points” evidence claim. The corrected
Nelson arithmetic does not validate the cross-seat calibration dataset.

## What the evidence changed

The [reliability decisions](reliability-decisions-2026-11-08.md) record what was
kept. At the time, this was the priority order the evidence produced:

- **R3/R6/R2 are the first serving-reliability tranche.** Make degradation visible,
  bound/isolate work and complete refresh recovery. Keep watchdog containment;
  root-cause profiling remains necessary. Six place fetches per electorate are
  not a global service budget.
- **R5 remains P0 for trustworthy count presentation**, preserving the landed
  completion fix while separating the different place sets and estimate bases.
- **R1/R4 remain necessary**, but the locally reproduced validator/body bug is
  **not established as the cause of these two serving outages**: persistence
  advanced. Webhook isolation now has observed failure evidence.
- **R7's parser/data-integrity repair is a P0 calibration gate**, separate from
  the broader P1 model-evaluation programme. Do it before further retuning or
  reliance on published calibration statistics.
- **R8/R9 library consolidation is secondary.** Changing libraries alone would
  not have prevented the observed server-side outages.

Additional operational work: automate deployment/source identity capture; verify
Fly access before the live window; freeze unrelated changes; record incident
ownership/timestamps; retain raw source and diagnostic evidence beyond the rolling
24-hour database window. Do not reset the volume as a diagnostic shortcut.

At 21:32 the preserved metrics reported **516 connected sockets** and thousands
of history requests. Around 42% of electorate-history requests and 50% of
voting-place requests in that process's cumulative histograms exceeded five
seconds. Those totals include the outage, so they are not a healthy-service
benchmark, but they establish meaningful production demand and severe serving
degradation. Reproduce that order of traffic, not a single-browser happy path.

## Evidence index for another agent

Retrieve sessions with `opencode api get /api/session/<sessionID>/message` and its
documented pagination, or individual records with
`opencode api get /api/session/<sessionID>/message/<messageID>`. Tool-output
timestamps may be UTC; session timestamps below were converted to NZDT.
Do not copy credentials or unrelated prompt material into the repository.

| ID  | Source                                                                                                            | Key records                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Mt Roskill chart vs table**, `ses_e4adeb4e6ffeJX1P5fsgT4xrrN`                                                   | `msg_1b5246bc8001C6yGMK74DZg8z2`: frozen #66/metrics; `msg_1b527169b001mgYtFhdI7I54E8`: feed versus chart; `msg_1b58aaeec001Fdcp2EsekPR3O0`: DB write/socket/API-failure logs; `msg_1b58b8065001mYFf5OCKTX4PcY`: process/FD sample; `msg_1b58bd8bb0015F5Ji1j3YUmua9`: TCP connects but HTTP times out; `msg_1b58c8f09001rY1vTT72vi0B00`: webhook/Fly-health failure logs; `msg_1b59066ee001OwUIs9Ok9z4qcE`, `msg_1b5909f6b001cImLHmlr7z0wVV`: resize and recovery |
| S2  | **Grafana telemetry feed missing**, `ses_e4adf1f26ffe7W6wjcgUUnPLQ8`                                              | `msg_1b523dd37001jMByn2oLZSJ491` and `msg_1b57b94a4001cMVLHkFrAbTvtn`: localhost mock source in health output; `msg_1b588bf04001EpcG5Nfr5u6wpO`: later summary that must not be read as production verification                                                                                                                                                                                                                                                   |
| S3  | **Trends page loader issue**, `ses_e4b0783a0ffexVxxssWjCM4bYG`                                                    | `msg_1b4f87c62001EC7pSGVgwFR2oE`: user report; `msg_1b4fce3aa001v7y9evob8LmLQw`: local fix summary                                                                                                                                                                                                                                                                                                                                                                |
| S4  | **Nelson special vote impact**, `ses_e4b1d9414ffepuv2JAIjdtTui8`                                                  | `msg_1b4e6208e001hILJGl9TJAKoZs`: actual 35,649 remaining output; `msg_1b4e87e5c001YO23OXaeSDdQJZ`, `msg_1b4e8ae46001tx3Li9GftunN6G`, `msg_1b4ebba4c001cf1TCPeqzSV6HI`: malformed historical candidate header and contaminated statistics                                                                                                                                                                                                                         |
| S5  | **Mt Albert vote reporting discrepancy**, `ses_e4a60fcf3ffeCOSvN7FXLOTGcK`                                        | User reports at 23:47/23:49; `msg_1b5abf322001fmBCTJXgXcYoiT`: 24 in-seat booths versus 102 contributing places, with unresolved listing mismatch                                                                                                                                                                                                                                                                                                                 |
| S6  | **Election-night vote count discrepancy**, `ses_e476df5ccffeqhRhmBS6A4S8nB`, plus fresh public history retrieval  | `msg_1b8920a38001jMvao73s1jN5pM`: 97.2% user report; `msg_1b8a3246c001E5Zv2UBS7kd6bA`: next-day analysis/fix; fresh `/api/history/party-votes` independently establishes the 357-point timeline and milestone calculations                                                                                                                                                                                                                                        |
| S7  | Fly release history, retrieved 8 Nov                                                                              | v108 `b8994a1`, v109 `a1da835`, v110 `4368c12`, v111 `5a97069`, v112 `29b37ed`, v114 `989c40b`; times in the timeline are release `CreatedAt`, not assumptions that a merged commit was already live                                                                                                                                                                                                                                                              |
| S8  | **Special vote swing and coalition seats**, `ses_e4a57628effe3DWKAGZ9rzKIy7`; current untracked briefing HTML/PDF | Scenario/briefing requested 23:58–00:17, PDF produced around 00:26. This was an as-of live-count scenario, not evidence the ordinary count had finished. Its 22.5% specials scenario must not be confused with the next-day Commission estimate.                                                                                                                                                                                                                  |

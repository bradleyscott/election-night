# Election-night lamp and announcement (Home Assistant)

`automations/election-lamp.yaml` is a single Home Assistant automation that, when
a seat's winner is called, turns `light.drawing_room_lamp` on at 100% brightness
in the winning party's colour and **says the call out loud** on
`media_player.googlehome7455`, then turns the lamp off after 30 seconds. Calls
are queued, so a burst of calls plays out one at a time rather than collapsing
into one lamp state and one overlapping sentence. Every party has a colour; there
are no patterns, flashes or transitions to read.

It relies on nothing in this repo at runtime — it is driven entirely by the
webhook payload in `WebhookPayload` (`packages/core/src/types.ts`), which is
`{ event, timestamp, electorateName, result, diff, probability, progress }`.

## What it says

Two sentences, built entirely from the webhook payload:

> Nicola WILLIS of National has a 94 percent chance of winning Selwyn. They lead
> by a margin of 12.4 percent, with 83 percent of the vote counted.

- **The name is reversed for speech.** The feed publishes names surname-first
  (`WILLIS, Nicola`), which a voice reads as a list. Only the order changes: the
  feed's own spelling is kept, because title-casing would turn `McANULTY` into
  `Mcanulty`, and a voice reads upper case identically anyway.
- **Parties are said, not written.** `National Party` becomes "National",
  `Green Party` becomes "the Green Party", `ACT New Zealand` becomes "ACT", and
  `Opportunity Party` / `The Opportunities Party (TOP)` both become "The
  Opportunity Party". An unknown party is read as published rather than dropped.
- **The percentage is the chance of winning**, rounded to a whole point, from the
  same `probability` the lamp's condition checks.
- **The margin is a counted fact, not a projection**, which is why the two
  numbers are two sentences rather than one blended figure. `marginPercent` is
  stored as a **fraction of the votes counted** (`margin / votesCounted` in
  `calculateLead`, 0.124), the same number the dashboard multiplies by 100 before
  it prints `12.4%`. The template does that multiplication itself, prints one
  decimal, and drops a trailing `.0` so a whole point reads "12 percent" rather
  than "12.0 percent".
- **"of the vote counted" is the payload's `progress`, not
  `votePercentageCounted`.** `progress` is `SeatChance.progress`: votes counted ÷
  the votes tonight is expected to produce, the same number the dashboard's count
  band prints and the feed's commentary uses. `votePercentageCounted` is the share
  of **voting places** reported, which runs hot early (advance votes arrive in
  blocks after 7pm), so when a collector predates the `progress` field the clause
  says "voting places" rather than labelling that number votes. Both are
  formatted to one decimal with a trailing `.0` dropped.
- **Missing parts drop their clause.** No candidate name gives "The Green Party
  has a 92 percent chance of winning Example."; no party (an independent) gives
  "Jane Smith has a 93 percent chance of winning Hutt South." The subject is
  capitalised with `who[:1] | upper` rather than `capitalize`, which would
  lowercase the rest of "Green Party".
- The message stays well under Google Translate's 200-character limit (the
  longest fixture is 162). That limit is silent: a longer message is truncated,
  not refused.

The wording is template logic, so it is tested rather than eyeballed:

```bash
uv run --with jinja2 --with pyyaml ops/home-assistant/test-templates.py
```

That reads the `variables:` block out of the YAML, renders it with Jinja2 the way
Home Assistant does (in order, so later variables see earlier ones), and checks
the spoken sentence for a National call, a Green call, Te Pāti Māori under both
spellings, TOP under both of its labels, an independent, an unknown party, an
apostrophe name, a missing name and a name with no comma. It also checks the
gate (`0.94` and `0.9` pass; `0.72`, `null`, an absent `probability` and every
other event type do not) and that the lamp palette still resolves every party.

## Which TTS entity?

Home Assistant names the Google Translate TTS entity after how it was added, so
the automation tries each in turn and uses whichever exists:

| entity / action               | where it comes from                                                       |
| ----------------------------- | ------------------------------------------------------------------------- |
| `tts.google_en_com`           | Google Translate text-to-speech added under Settings → Devices & services |
| `tts.google_translate_en_com` | the legacy `tts:` platform in `configuration.yaml`                        |
| `tts.google_translate_say`    | older installs, before the `tts.speak` action existed                     |

The branch is chosen by checking `state_attr(..., 'friendly_name')`, which is set
on any entity that exists, so a missing entity is skipped rather than raising.
Every branch continues on error, so a TTS failure still reaches the lamp-off
step. If none of them speaks, the TTS integration is missing entirely: add
**Google Translate text-to-speech** under Settings → Devices & services, and the
first branch starts working with no YAML change.

Nothing sets the speaker's volume. A fixed `volume_set` would be louder than the
house sometimes wants and would need a restore step that a failed announcement
could skip; set the Google Home's own volume and leave it alone.

The announcement makes the queue's backlog audible as well as visible: with
`max: 20` and 30 seconds a call, a large wave can talk about seats called ten
minutes ago. `max: 8` is about four minutes of speaking.

## Wiring the collector to it

`WEBHOOK_URL` is the only setting. It is a single URL for all four event types,
so the automation's condition picks `prediction_changed` out of the stream.

Collector on the same LAN as Home Assistant:

```bash
WEBHOOK_URL=http://homeassistant.local:8123/api/webhook/election-night-verdict \
  npm run start:collector
```

The Fly deployment is another network, so point it at your Nabu Casa Remote UI
hostname instead:

```bash
WEBHOOK_URL=https://<your-subdomain>.ui.nabu.casa/api/webhook/election-night-verdict
```

**That requires `local_only: false` on the trigger.** HA's check is

```python
is_local = not (is_cloud_connection(hass) or request.remote is None)
```

which reads as though tunnel traffic would be treated as local, but requests
arriving through the Remote UI proxy are not marked as cloud connections in
practice: with `local_only: true` every POST is answered `200`, logs
`Received remote request for local webhook ...` and never fires the automation.
Measured, not inferred — this cost a debugging session; the value in
`automations/election-lamp.yaml` is `false` for that reason, and it is the only
line in the file that depends on how the collector reaches HA.

The trade-off is real: `local_only: false` makes the endpoint reachable from the
public internet, and the **webhook ID is the only credential**. Use a long
random string (`openssl rand -hex 24`), never the value shipped here, and treat
it like a password. The worst case if it leaks is someone lighting a lamp at
their choosing, but do not reuse a memorable ID.

If instead the collector runs on the same LAN as HA, keep `local_only: true` and
use `http://homeassistant.local:8123/api/webhook/<id>`.

## Installing it

Home Assistant's automation editor reads and writes **`<config>/automations.yaml`**,
hardcoded (`AUTOMATION_CONFIG_PATH` in `homeassistant/config.py`), whatever
`configuration.yaml` says. The editor loads an automation by finding its `id` in
that one file; not finding it returns 404, which the frontend renders as "Only
automations in automations.yaml are editable." So there are two working installs
and one that silently does nothing:

| where the automation lands                                         | runs?  | UI-editable?          |
| ------------------------------------------------------------------ | ------ | --------------------- |
| `automations.yaml`, and `configuration.yaml` loads it              | yes    | yes                   |
| an included file / directory / package                             | yes    | no, by design         |
| the editor, while `configuration.yaml` loads automations elsewhere | **no** | shows the 404 message |

Deleting the `id:` is not a fix for the message: `post` appends an unrecognised
id (`if not updated: data.append(updated_value)`), so a genuinely new automation
saves either way. The `id` only decides whether the editor can find it again.

### A. Hand-edit `automations.yaml`

`automations.yaml` is a **list**; the file here is a single mapping (one
automation per file, the include form). Convert and append it from the repo
root:

```bash
awk 'BEGIN{n=0} { if (!n && $0 !~ /^[[:space:]]*#/ && $0 !~ /^[[:space:]]*$/) { print "- " $0; n=1 } else { print "  " $0 } }' \
  ops/home-assistant/automations/election-lamp.yaml >> <config>/automations.yaml
```

Then Developer tools → YAML → **Reload automations**. Confirm `configuration.yaml`
loads that file:

```yaml
# configuration.yaml
automation: !include automations.yaml
```

If `automation:` points at a directory or a package instead, paste the converted
list item into whichever file `automation:` does load. It will run; it just will
not be UI-editable.

### B. Include it as a file

```yaml
# configuration.yaml
automation: !include_dir_list automations/
```

Copy `automations/election-lamp.yaml` to `config/automations/election-lamp.yaml`.
`!include_dir_list` loads _every_ file in the directory as one automation, which
is why this README sits one level up — a stray `.md` in there is a load error.
Not UI-editable, which is fine: nothing here needs a phone.

Either way, change `webhook_id` to a long random string of your own and treat it
as a password, since it is the only credential on the endpoint.

### Version note

This file uses the plural keys (`triggers:`, `conditions:`, `actions:`) that HA
2024.10 introduced. On an older release they fail validation with `extra keys
not allowed @ data['triggers']` — rename them to `trigger:`, `condition:`,
`action:` in that case.

## Testing it without an election

The collector's own logger shows a real payload first:

```bash
npm run log:webhooks        # listens on :3458
WEBHOOK_URL=http://localhost:3458 npm run start:mock   # separate shell + collector
```

Then a single synthetic call straight at the automation:

```bash
curl -X POST http://homeassistant.local:8123/api/webhook/election-night-verdict \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "prediction_changed",
    "timestamp": 1790000000000,
    "electorateName": "Auckland Central",
    "probability": 0.94,
    "progress": 0.83,
    "result": {
      "electorateName": "Auckland Central",
      "votesCounted": 24000,
      "votePercentageCounted": 0.91,
      "leaders": {
        "leadingCandidate": "Swarbrick, Chlöe",
        "leadingCandidateParty": "Green Party",
        "secondCandidate": "Example, Candidate",
        "secondCandidateParty": "Labour Party",
        "margin": 4200,
        "marginPercent": 0.089
      }
    },
    "diff": {}
  }'
```

Set `Content-Type: application/json` or Home Assistant exposes the body as
`trigger.data` instead of `trigger.json` and the conditions never match. To test
the ignore path, re-send with `"probability": 0.72` (a withdrawal) or
`"probability": null` (a completed count) — neither should light anything or say
anything.

A passing call does three things, in order: the lamp goes to the Green Party's
colour, the speaker says

> Chlöe Swarbrick of the Green Party has a 94 percent chance of winning Auckland
> Central. They lead by a margin of 8.9 percent, with 83 percent of the vote
> counted.

(`votePercentageCounted` is deliberately `0.91` there while `progress` is
`0.83`, so the sentence proves which field it read.)

and the lamp turns off 30 seconds later. If the lamp changes but nothing is said,
open the automation's last trace: a skipped `tts.speak` step names the entity that
was missing, and a failed one carries the error. The sentence itself is checked
offline by `test-templates.py` above, so a wrong-sounding sentence is a template
bug, not a Home Assistant one.

### Is the webhook actually registered?

Every webhook outcome returns `200`, deliberately:

```python
# Always respond successfully to not give away if a hook exists or not.
if (webhook := handlers.get(webhook_id)) is None:
    return Response(status=HTTPStatus.OK)
```

So a `200` from a POST proves only that the URL is reachable — an unregistered
ID, a rejected `local_only` request and a handler that raised all look the same.
The method check runs _after_ the lookup, so a `GET` does tell them apart:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://<your-subdomain>.ui.nabu.casa/api/webhook/election-night-verdict
```

- **`405`** — registered, and POST-only, which is exactly this file's
  `allowed_methods`. The automation is loaded.
- **`200`** — nothing is registered under that ID: the automation is not loaded,
  or its `webhook_id` is not the bare name (a full URL there registers a hook
  whose ID is the whole string).

## Why the conditions look like that

- `prediction_changed` is a **crossing**, in either direction.
  `determineWebhookEvents` in `packages/core/src/diff.ts` fires it whenever
  `called !== wasCalled`, so a seat falling back under `CALL_THRESHOLD` also
  emits it, and a finished count emits it with `probability: null` (the model
  reports `complete` rather than a number). Lighting on the event name alone
  would light the lamp when a call is withdrawn.
- `>= 0.9` is `CALL_THRESHOLD` (`packages/core/src/seat-probability.ts`) — the
  same number the dashboard's "likely to win" comes from, so the lamp and the
  screen agree on when a seat was called.
- `is number` is what excludes `null` and an absent key without raising a
  template error (`None >= 0.9` would).

## Two colours are deliberately not brand colours

`partyColors` in `packages/dashboard/src/lib/constants.ts` gives New Zealand
First `#333333` and Te Pāti Māori `#000000`. A lamp at black is a lamp that is
off, so:

- **New Zealand First** → neutral grey `[180, 180, 180]`, bright enough to see.
  (Not expected to win an electorate in 2026; it is there so a surprise does not
  light the lamp black.)
- **Te Pāti Māori** → their brand red `#D81E05` pushed 45% of the way toward
  black, `[119, 17, 3]`. Their identity is red _on black_, and black cannot be
  lit — but their red on its own is Labour's red: `#D81E05` against `#D82A20` is
  a 12-point gap in green (relative luminance 0.155 vs 0.164), i.e. one colour
  on a bulb. Darkening keeps the hue and takes the second half of the brand: at
  100% brightness the maroon emits about a quarter of Labour's light, which
  reads as _deep_, not as _dimmed_, because nothing else in the palette is dim.

  The knob: `[151, 21, 4]` (70% of the brand values) is subtler, `[86, 12, 2]`
  (40%) is darker. Below about 35% it stops reading as a colour and starts
  reading as a lamp that failed to come on.

Any other party renders as white, which is a visible "unknown" rather than a
silent failure.

Everything else is the dashboard's brand value, unchanged. A lamp can render
those cooler than the swatch - the Green Party's blue-leaning `#098137` reads
teal and Labour's warm `#D82C20` reads pink on some bulbs - but per-party tuning
for one bulb was tried (CSS colour names, then hand-tuned RGB) and traded one
distortion for another without a clear win. The brand value keeps the lamp and
the dashboard telling the same story, and a bulb that cannot show a saturated
green is not something a hex value can fix.

## Bursts

Seats get called in waves, so `mode: queued` with `max: 20` gives each call its
own 30 seconds — up to ten minutes of backlog. Beyond that the newest triggers
are dropped (`max_exceeded: silent`) rather than narrating seats called ten
minutes ago. Lower `max` to narrate less of a burst; raise it to lose less. With
the announcement the backlog is spoken, not just lit, so this is the number to
lower if a wave talks over itself.

Two consequences worth knowing:

- A call that is later withdrawn and re-called lights the lamp and says the seat
  twice, because both crossings are `prediction_changed`.
- Nothing is dropped quietly. Announcements are committed with the snapshot and
  delivered by the collector's outbox, which retries `429`/`5xx`/network
  failures with backoff and dead-letters a permanent `4xx` or an exhausted
  budget; the lamp and the announcement therefore miss a seat only after a
  recorded failure.

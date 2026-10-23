# Brief: what the voting-place XML is, and what it makes possible

A self-contained prompt for a coding agent. Paste it as-is; it assumes no prior
context beyond the repository it sits in.

---

You are helping design features for a real-time New Zealand election results
dashboard. This brief explains a data source the product does not use yet. Read
it before proposing anything, and keep your first response to design, not code.

## What the Electoral Commission publishes

A plain-XML results feed over HTTPS, no authentication, cached ~30 seconds:

- **Live cycle:** `https://media.election.net.nz/xml/` — a bare path with no year
  in it.
- **Archived cycles:** `https://archive.electionresults.govt.nz/electionresults_{YEAR}/xml/`.
  2020 and 2023 include the full per-place breakdown; 2017 has seat-level files
  only; 2014 and earlier have no XML at all.

Top level, per cycle:

| File | Contents |
| --- | --- |
| `candidates.xml` | every candidate: id, name, electorate, party, list rank |
| `parties.xml` | every party: id, abbreviation, short and full name, registered flag |
| `electorates.xml` | every seat: id and name (71 in 2026: 64 general + 7 Māori) |
| `election.xml` | national party vote **and the Commission's own seat allocation** — `party_seats` (list), `candidate_seats` (electorate), `total_seats` per party |
| `statistics.xml` | national totals, including 2,686 voting places and 9,363 voting-place results |
| `votingplaces.xml` | every voting place: `vp_id`, `vp_e_no`, full address, latitude, longitude |
| `e{NN}/e{NN}.xml` | one seat's totals: statistics, party votes, candidate votes |

## The subfolders, which are the interesting part

Every seat directory also contains a `votingplaces/` folder of individual files:

```
e01/e01.xml                  the seat's total
e01/votingplaces/01-01001.xml   one batch of counted votes
e01/votingplaces/01-01002.xml
```

Each batch file carries: `vp_id`, `vp_e_no`, `e_no`, `vp_no`, `time_received`,
a `statistics` block with `total_issued_ballot_papers` and informal counts, then
`partyvotes` and `candidatevotes` for that batch.

## Three facts that change what you can design

**1. A batch is not a voting place.** There are 9,363 batches nationally for
2,686 places. A place can report more than once, and batches are the unit
results arrive in. Anything you build should count batches where it means
batches, and places where it means places.

**2. `e_no` and `vp_e_no` are different electorates.** `e_no` is the electorate
the votes count toward; `vp_e_no` is the electorate the place physically stands
in. They differ for advance votes cast outside the seat: Auckland Central's 2023
file reports **115 places counted for a seat containing 34 booths**. So a seat's
folder means *whose votes these are*, not *where they were cast*. A booth-level
picture of a seat is only valid where `vp_e_no == e_no`.

**3. Issued ballot papers are not votes.** `total_issued_ballot_papers` counts
papers handed out at that place — including voters enrolled in other seats whose
votes count elsewhere — and it is `0` before counting starts. It is an upper
bound on participation, not a vote count.

Two more things worth knowing: advance places are **not** marked in the data
(the only "Advance" string among 2,686 addresses is a school name), though
mobile teams and care-home visits are, and they carry no coordinates. And the
whole feed exists before election night with every count zeroed — the transition
from zeros to counts is what the night actually is.

## What this makes possible

1. **Where the count has reached.** Which places and batches have reported, on a
   map of the 2,524 places that carry coordinates.
2. **Seat composition.** Where a seat's votes came from: cast inside it, versus
   advance votes cast elsewhere and counted toward it. Adds up to the seat total.
3. **Remaining-vote bounds.** A seat's margin against the papers issued at
   places yet to report. If the margin exceeds them, the seat cannot change on
   the night; if it doesn't, the seat is inside the outstanding vote.
4. **A probabilistic seat call.** A model over the batches still to arrive, with
   a written spec in `docs/seat-probability-model.md`.
5. **Local swing.** Place-level comparison between cycles, where the same place
   reported in both, with everything else stated as not comparable.
6. **Data integrity.** Whether the batches sum to the seat total — a check that
   everything else rests on.
7. **Stall detection.** Places that stop arriving, or an electorate that goes
   quiet mid-count.

## Design constraints to respect

- The live collector polls seat-level files every 30–120 seconds. The per-place
  detail is roughly 130 times that volume and must not enter that poll loop.
- Special votes are counted after election night and have changed seats that
  looked settled on the night. Any "settled" claim is about the night's count.
- The product has two registers: public pages in plain, voter-facing language;
  internal notes in technical language. Keep them separate.

## What I want from you

Read the above, then respond with design thinking only:

1. Which of these opportunities are worth building, and in what order, given
   election night is close?
2. What is the strongest idea here that I have not listed?
3. What would you cut, and why?
4. Where does a naive design break — what would look right and be wrong?

Do not write code yet, and do not propose fetch strategies or schemas. When we
agree on the shape, the implementation constraints are in
`docs/voting-place-data.md`.

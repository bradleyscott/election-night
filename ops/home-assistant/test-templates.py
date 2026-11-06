#!/usr/bin/env python3
"""Render the automation's own Jinja so the wording can be checked offline.

The templates are the risky part of the Home Assistant automation: a missing
key, a surname read backwards, a party said as written, `marginPercent` (a
fraction) printed as though it were already a percentage, or voting places
passed off as votes all produce a message that is wrong in a way no YAML linter
catches. This reads the `variables:` block out of
`automations/election-lamp.yaml`, evaluates it the way Home Assistant does (in
order, so later variables see earlier ones), and asserts the spoken sentence for
a set of payloads.

It is a Python script because Home Assistant's templates are Jinja2 and nothing
in the JavaScript toolchain renders Jinja2 faithfully. It has no relation to the
collector at runtime.

    uv run --with jinja2 --with pyyaml ops/home-assistant/test-templates.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml
from jinja2 import Environment

HERE = Path(__file__).resolve().parent
AUTOMATION = HERE / "automations" / "election-lamp.yaml"

env = Environment(autoescape=False, keep_trailing_newline=False)


def render(template: str, **context):
    return env.from_string(template).render(**context)


def automation():
    return yaml.safe_load(AUTOMATION.read_text(encoding="utf-8"))


def variables_for(payload: dict) -> dict:
    """Evaluate the first `variables:` action the way Home Assistant does."""
    step = next(
        a for a in automation()["actions"] if isinstance(a, dict) and "variables" in a
    )
    rendered: dict = {}
    trigger = {"json": payload}
    for key, value in step["variables"].items():
        if isinstance(value, str):
            value = render(value, trigger=trigger, **rendered)
        rendered[key] = value
    return rendered


def spoken(payload: dict) -> str:
    return str(variables_for(payload)["tts_message"]).strip()


def condition(payload: dict) -> bool:
    """True when every template condition in the automation would pass."""
    trigger = {"json": payload}
    for item in automation()["conditions"]:
        result = render(item["value_template"], trigger=trigger).strip()
        if result != "True":
            return False
    return True


def payload(
    name,
    candidate,
    party,
    probability,
    event="prediction_changed",
    margin=0.089,
    progress=0.83,
    places=0.91,
    **extra,
):
    leaders = {
        "leadingCandidate": candidate,
        "leadingCandidateParty": party,
        "secondCandidate": "Example, Alice",
        "secondCandidateParty": "Labour Party",
        "margin": 4200,
    }
    # `marginPercent` really is a fraction of the votes counted: the reducer
    # computes margin / votesCounted and the dashboard multiplies by 100. None
    # omits the key, for the partial-payload case.
    if margin is not None:
        leaders["marginPercent"] = margin

    body = {
        "event": event,
        "timestamp": 1790000000000,
        "electorateName": name,
        "probability": probability,
        "result": {
            "electorateName": name,
            "votesCounted": 24000,
            # Deliberately different from `progress`, so a message that says 83
            # is provably reading progress and not voting places.
            "votePercentageCounted": places,
            "leaders": leaders,
        },
        "diff": {},
    }
    # Absent, not null, when the collector had no modelled seat to report.
    if progress is not None:
        body["progress"] = progress
    body.update(extra)
    return body


failures: list[str] = []


def check(label: str, actual, expected) -> None:
    if actual == expected:
        print(f"  ok   {label}")
    else:
        failures.append(label)
        print(f"  FAIL {label}\n         expected: {expected!r}\n         actual:   {actual!r}")


print("\nSpoken sentence")

cases = [
    (
        "a National call, surname reversed, one-decimal margin",
        payload("Selwyn", "WILLIS, Nicola", "National Party", 0.94, margin=0.124),
        "Nicola WILLIS of National has a 94 percent chance of winning Selwyn. "
        "They lead by a margin of 12.4 percent, with 83 percent of the vote counted.",
    ),
    (
        "a Green call keeps the macrons in the name",
        payload("Auckland Central", "Swarbrick, Chlöe", "Green Party", 0.912),
        "Chlöe Swarbrick of the Green Party has a 91 percent chance of winning "
        "Auckland Central. They lead by a margin of 8.9 percent, with 83 percent "
        "of the vote counted.",
    ),
    (
        "Te Pāti Māori is said, not written",
        payload("Waiariki", "Waititi, Rawiri", "Te Pāti Māori", 0.97),
        "Rawiri Waititi of Te Pāti Māori has a 97 percent chance of winning "
        "Waiariki. They lead by a margin of 8.9 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "Te Pati Maori, the ASCII label",
        payload("Waiariki", "Waititi, Rawiri", "Te Pati Maori", 0.97),
        "Rawiri Waititi of Te Pāti Māori has a 97 percent chance of winning "
        "Waiariki. They lead by a margin of 8.9 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "a Māori seat with a fractional margin and progress",
        payload(
            "Waiariki",
            "WAITITI, Rawiri",
            "Te Pāti Māori",
            0.97,
            margin=0.087,
            progress=0.615,
            places=0.72,
        ),
        "Rawiri WAITITI of Te Pāti Māori has a 97 percent chance of winning "
        "Waiariki. They lead by a margin of 8.7 percent, with 61.5 percent of "
        "the vote counted.",
    ),
    (
        "the 2026 label for TOP",
        payload("Rongotai", "Example, Alice", "Opportunity Party", 0.95),
        "Alice Example of The Opportunity Party has a 95 percent chance of "
        "winning Rongotai. They lead by a margin of 8.9 percent, with 83 percent "
        "of the vote counted.",
    ),
    (
        "the 2023 label for TOP",
        payload("Rongotai", "Example, Alice", "The Opportunities Party (TOP)", 0.95),
        "Alice Example of The Opportunity Party has a 95 percent chance of "
        "winning Rongotai. They lead by a margin of 8.9 percent, with 83 percent "
        "of the vote counted.",
    ),
    (
        "ACT drops the country",
        payload("Tāmaki Makaurau", "O'CONNOR, Damien", "ACT New Zealand", 0.9),
        "Damien O'CONNOR of ACT has a 90 percent chance of winning Tāmaki "
        "Makaurau. They lead by a margin of 8.9 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "New Zealand First is not read as a set of initials",
        payload("Whangārei", "Example, Alice", "New Zealand First Party", 0.91),
        "Alice Example of New Zealand First has a 91 percent chance of winning "
        "Whangārei. They lead by a margin of 8.9 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "an independent drops the party clause",
        payload("Hutt South", "Smith, Jane", "", 0.93, margin=0.12),
        "Jane Smith has a 93 percent chance of winning Hutt South. "
        "They lead by a margin of 12 percent, with 83 percent of the vote counted.",
    ),
    (
        "an unknown party is read as written, not dropped",
        payload("Example", "Smith, Jane", "Kiwi Party", 0.92),
        "Jane Smith of Kiwi Party has a 92 percent chance of winning Example. "
        "They lead by a margin of 8.9 percent, with 83 percent of the vote counted.",
    ),
    (
        "a name with no comma is left alone",
        payload("Example", "Madam Speaker", "Green Party", 0.92),
        "Madam Speaker of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 8.9 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "no candidate name falls back to the party, capitalised",
        payload("Example", "", "Green Party", 0.92),
        "The Green Party has a 92 percent chance of winning Example. "
        "They lead by a margin of 8.9 percent, with 83 percent of the vote counted.",
    ),
    (
        "a name with a comma but no given name",
        payload("Example", "Smith,", "Green Party", 0.92),
        "Smith of the Green Party has a 92 percent chance of winning Example. "
        "They lead by a margin of 8.9 percent, with 83 percent of the vote counted.",
    ),
    (
        "a whole-point margin drops the .0",
        payload("Example", "Smith, Jane", "Green Party", 0.92, margin=0.1),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 10 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "a zero margin is a number, not a blank",
        payload("Example", "Smith, Jane", "Green Party", 0.92, margin=0),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 0 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "an absent marginPercent reads as zero rather than breaking",
        payload("Example", "Smith, Jane", "Green Party", 0.92, margin=None),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 0 percent, with 83 percent of the "
        "vote counted.",
    ),
    (
        "progress prefers the modelled share over voting places",
        payload("Example", "Smith, Jane", "Green Party", 0.92, progress=0.345, places=0.9),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 8.9 percent, with 34.5 percent of the "
        "vote counted.",
    ),
    (
        "a whole progress drops the .0",
        payload("Example", "Smith, Jane", "Green Party", 0.92, progress=1),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 8.9 percent, with 100 percent of the "
        "vote counted.",
    ),
    (
        "an early, fractional progress keeps its decimal",
        payload("Example", "Smith, Jane", "Green Party", 0.92, progress=0.005),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 8.9 percent, with 0.5 percent of the "
        "vote counted.",
    ),
    (
        "no progress falls back to places, called places",
        payload("Example", "Smith, Jane", "Green Party", 0.92, progress=None),
        "Jane Smith of the Green Party has a 92 percent chance of winning "
        "Example. They lead by a margin of 8.9 percent, with 91 percent of "
        "voting places counted.",
    ),
]

for label, body, expected in cases:
    check(label, spoken(body), expected)

print("\nThe gate (probability and event)")

check("0.94 is a call", condition(cases[0][1]), True)
check("0.9 exactly is a call", condition(cases[6][1]), True)
check(
    "0.72 is a withdrawal",
    condition(payload("Selwyn", "WILLIS, Nicola", "National Party", 0.72)),
    False,
)
check(
    "null is a finished count",
    condition(payload("Selwyn", "WILLIS, Nicola", "National Party", None)),
    False,
)
check(
    "an absent probability is nothing",
    condition({k: v for k, v in cases[0][1].items() if k != "probability"}),
    False,
)
check(
    "another event type is ignored",
    condition(
        payload(
            "Selwyn", "WILLIS, Nicola", "National Party", 0.94, event="count_completed"
        )
    ),
    False,
)

print("\nSpoken messages fit Google Translate's 200-character limit")

longest = max((spoken(body) for _, body, _ in cases), key=len)
if len(longest) >= 200 or "—" in longest:
    failures.append("length/em dash")
    print(f"  FAIL longest is {len(longest)} characters: {longest!r}")
else:
    print(f"  ok   longest is {len(longest)} characters, no em dash")

print("\nLamp colours still resolve")

cores = {
    "National Party": "[0, 82, 159]",
    "Labour Party": "[216, 42, 32]",
    "Green Party": "[9, 129, 55]",
    "ACT New Zealand": "[255, 215, 0]",
    "New Zealand First Party": "[180, 180, 180]",
    "Te Pāti Māori": "[119, 17, 3]",
    "Opportunity Party": "[0, 185, 188]",
}
for party, expected in cores.items():
    body = payload("Example", "Smith, Jane", party, 0.95)
    check(f"{party} -> {expected}", str(variables_for(body)["colour"]).strip(), expected)

check(
    "an unknown party falls back to white, not black",
    str(variables_for(payload("Example", "Smith, Jane", "Kiwi Party", 0.95))["colour"]).strip(),
    "[255, 255, 255]",
)

print()
if failures:
    print(f"{len(failures)} failing check(s): {', '.join(failures)}")
    sys.exit(1)
print("all checks passed")

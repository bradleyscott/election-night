#!/usr/bin/env python3
"""Build the seats-page hemicycle comps from a capture of the running app.

Reads seats-hemicycle.before.html (a page.content() dump of /seats against the
2026 mock feed), takes the 123 rendered seat blocks with their real party
colour and fill opacity, and re-lays them on a horseshoe. Everything outside
the seat block (masthead, stat strip, party table, footer) is the captured
running page, untouched.

    python3 build.py            # writes a-semicircle.html / b-chamber.html
"""

import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SRC = HERE / "seats-hemicycle.before.html"

# ---------------------------------------------------------------- seat records

html = SRC.read_text(encoding="utf-8")

start = html.index('<div class="relative mt-8 mb-2">')
end = html.index('<div class="overflow-x-auto"><table')
block = html[start:end]

seat_re = re.compile(
    r'aria-label="(?P<label>[^"]+)"[^>]*?style="background-color: (?P<color>[^;"]+); opacity: (?P<opacity>[^;"]+);"'
)
seats = []
for m in seat_re.finditer(block):
    label = m.group("label")
    if label.endswith(" electorate seat"):
        party, kind = label[: -len(" electorate seat")], "electorate"
    elif label.endswith(" list seat"):
        party, kind = label[: -len(" list seat")], "list"
    else:
        raise SystemExit(f"unexpected seat label: {label!r}")
    seats.append(
        {
            "p": party,
            "t": kind,
            "c": m.group("color").strip(),
            "o": float(m.group("opacity")),
        }
    )

assert len(seats) == 123, len(seats)
order = []
for s in seats:
    if not order or order[-1] != s["p"]:
        order.append(s["p"])
print("seats:", len(seats), "parties:", order)

# -------------------------------------------------------------------- the comp

LAYOUT_JS = r"""
(function () {
  const RINGS = 3;
  const CFG = __CFG__;
  const SEATS = __SEATS__;
  const root = document.getElementById('chamber');
  const layer = document.getElementById('chamber-seats');
  const line = document.getElementById('chamber-line');
  const label = document.getElementById('chamber-label');
  const initialOrder = [...new Set(SEATS.map((s) => s.p))];

  let order = initialOrder.slice();
  let dragParty = null;
  let dropParty = null;
  let selected = null;

  // one element per seat record; a record keeps its own party, colour and fill
  const records = SEATS.map((s) => {
    const el = document.createElement('div');
    el.className = 'seat' + (CFG.shape === 'dot' ? ' seat--dot' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-roledescription', 'draggable seat');
    el.setAttribute('aria-label', s.p + ' ' + s.t + ' seat');
    el.draggable = true;
    el.style.backgroundColor = s.c;
    el.style.opacity = s.o;
    layer.appendChild(el);
    return Object.assign({}, s, { el: el });
  });

  const byParty = new Map();
  for (const r of records) {
    if (!byParty.has(r.p)) byParty.set(r.p, []);
    byParty.get(r.p).push(r);
  }

  function ordered() {
    return order.flatMap((p) => byParty.get(p) || []);
  }

  // The chamber is a path: two straight benches either side of the Table and a
  // round end. CFG.armFrac 0 collapses the arms into a plain semicircle.
  function geometry() {
    const W = root.clientWidth;
    const columns = Math.max(2, Math.ceil(records.length / RINGS));
    const R = Math.min((W - 4) / 2, CFG.maxR);
    const arm = R * CFG.armFrac; // straight run on each side
    const dome = Math.PI * R;
    const L = 2 * arm + dome;
    const spacing = L / (columns - 1); // column pitch along the outer bench
    // seat size: the tightest ring is the inside of the dome, where the pitch
    // shrinks by 2 * gap / R. Solve s = k * spacing * (1 - 2.6 s / R).
    const k = 0.66;
    const size = Math.max(6, Math.min(CFG.maxSeat, (k * spacing) / (1 + (2.6 * k * spacing) / R)));
    const gap = size * 1.32;
    return {
      W: W, R: R, arm: arm, dome: dome, L: L, spacing: spacing,
      size: size, gap: gap, cx: W / 2, yDome: CFG.padTop + R,
      height: CFG.padTop + R + arm + size / 2 + 2,
    };
  }

  // point at arc-length s along the outer bench, offset in towards the floor
  function pointAt(g, s, offset) {
    offset = offset || 0;
    if (s <= g.arm) {
      return { x: g.cx - g.R + offset, y: g.yDome + g.arm - s, rot: -Math.PI / 2 };
    }
    if (s <= g.arm + g.dome) {
      const th = Math.PI - (s - g.arm) / g.R;
      const r = g.R - offset;
      return { x: g.cx + r * Math.cos(th), y: g.yDome - r * Math.sin(th), rot: th - Math.PI / 2 };
    }
    return { x: g.cx + g.R - offset, y: g.yDome + (s - g.arm - g.dome), rot: Math.PI / 2 };
  }

  let geo = geometry();

  function paint() {
    geo = geometry();
    root.style.height = geo.height + 'px';

    ordered().forEach(function (rec, i) {
      const c = Math.floor(i / RINGS);
      const ring = i % RINGS;
      const p = pointAt(geo, c * geo.spacing, ring * geo.gap);
      const el = rec.el;
      el.style.width = geo.size + 'px';
      el.style.height = geo.size + 'px';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.transform =
        'translate(-50%, -50%)' + (CFG.shape === 'square' ? ' rotate(' + p.rot + 'rad)' : '');
    });

    // majority marker: half a column past the ends' midpoint, so it falls in the
    // gap between two columns instead of through the middle of one.
    const sMid = geo.L / 2 + geo.spacing / 2;
    const inner = (RINGS - 1) * geo.gap + geo.size * 0.8 + 26;
    const p1 = pointAt(geo, sMid, -7);
    const p2 = pointAt(geo, sMid, inner);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    line.style.height = len + 'px';
    line.style.left = p1.x + 'px';
    line.style.top = p1.y + 'px';
    line.style.transform =
      'translateX(-0.5px) rotate(' + Math.atan2(p2.x - p1.x, p2.y - p1.y) + 'rad)';
    label.style.left = p1.x + 'px';
    label.style.top = p1.y - 5 + 'px';
  }

  // ---- interaction -------------------------------------------------------
  function setHover(party) {
    records.forEach(function (r) {
      r.el.classList.toggle('is-hover', party !== null && r.p === party && r.p !== dragParty);
    });
    document.querySelectorAll('table tbody tr').forEach(function (tr) {
      const name = tr.querySelector('td:first-child span.font-bold');
      tr.classList.toggle('row-hover', !!name && name.textContent.trim() === party);
    });
  }

  function setDrop(party) {
    dropParty = party;
    records.forEach(function (r) {
      r.el.classList.toggle('is-drop', party !== null && r.p === party && r.p !== dragParty);
    });
  }

  function clearDrag() {
    dragParty = null;
    setDrop(null);
    records.forEach(function (r) {
      r.el.classList.remove('is-drag');
    });
  }

  function reorder(dragged, target) {
    if (!dragged || !target || dragged === target) return;
    const next = order.slice();
    const from = next.indexOf(dragged);
    const to = next.indexOf(target);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    order = next;
    paint();
    syncTable();
  }

  function syncTable() {
    const tbody = document.querySelector('table tbody');
    const rows = Array.from(tbody.children);
    const byName = new Map();
    rows.forEach(function (tr) {
      const name = tr.querySelector('td:first-child span.font-bold');
      if (name) byName.set(name.textContent.trim(), tr);
    });
    rows.forEach(function (tr) { tbody.appendChild(tr); });
    order.forEach(function (p) {
      const tr = byName.get(p);
      if (tr) tbody.appendChild(tr);
    });

    // coalition = parties in seating order, left to right, until the majority
    const total = Array.from(byName.values()).reduce(function (s, tr) {
      const cells = tr.querySelectorAll('td');
      return s + parseInt(cells[cells.length - 1].textContent.trim(), 10);
    }, 0);
    const majority = Math.floor(total / 2) + 1;
    const cell = document.querySelector('table tfoot td');
    const dot = function (color) {
      return '<span aria-hidden="true" class="inline-block flex-shrink-0 ring-1 ring-foreground/20 h-2.5 w-2.5" style="background-color:' + color + '"></span>';
    };
    const parts = [];
    let cumulative = 0;
    for (const p of order) {
      const tr = byName.get(p);
      if (!tr) continue;
      const cells = tr.querySelectorAll('td');
      const seatsCount = parseInt(cells[cells.length - 1].textContent.trim(), 10);
      if (!seatsCount || cumulative >= majority) break;
      const color = tr.querySelector('td:first-child span[aria-hidden]').style.backgroundColor;
      parts.push(
        '<span class="inline-flex items-center gap-1 whitespace-nowrap">' +
          (parts.length ? '<span class="text-muted-foreground/50 mx-0.5">+</span>' : '') +
          dot(color) +
          '<span class="font-bold">' + p + '</span></span>'
      );
      cumulative += seatsCount;
    }
    cell.innerHTML =
      '<div class="flex items-center gap-2 flex-wrap"><span class="kicker kicker--table">Coalition</span>' +
      '<div class="flex items-center gap-1 flex-wrap">' +
      parts.join('') +
      '<span class="inline-flex items-center whitespace-nowrap"><span class="text-muted-foreground/50 mx-1">=</span>' +
      '<span class="font-extrabold tabular-nums">' + cumulative + '</span>' +
      '<span class="text-muted-foreground mr-1">seats</span></span></div></div>';
  }

  records.forEach(function (rec) {
    const el = rec.el;
    el.addEventListener('mouseenter', function () { setHover(rec.p); });
    el.addEventListener('mouseleave', function () { setHover(null); });
    el.addEventListener('focus', function () { setHover(rec.p); });
    el.addEventListener('blur', function () { setHover(null); });
    el.addEventListener('click', function () {
      if (selected) selected.el.classList.remove('is-selected');
      selected = selected === rec ? null : rec;
      if (selected) selected.el.classList.add('is-selected');
    });
    el.addEventListener('dragstart', function (e) {
      dragParty = rec.p;
      el.classList.add('is-drag');
      setHover(null);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', rec.p);
      }
    });
    el.addEventListener('dragend', function () { clearDrag(); });
    el.addEventListener('dragenter', function () {
      if (dragParty && rec.p !== dragParty) setDrop(rec.p);
    });
    el.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      const dragged = dragParty;
      clearDrag();
      reorder(dragged, rec.p);
    });
  });

  document.querySelectorAll('table tbody tr').forEach(function (tr) {
    const name = tr.querySelector('td:first-child span.font-bold');
    if (!name) return;
    const party = name.textContent.trim();
    tr.addEventListener('mouseenter', function () { setHover(party); });
    tr.addEventListener('mouseleave', function () { setHover(null); });
  });

  const reset = Array.from(document.querySelectorAll('button')).find(function (b) {
    return b.textContent.trim() === 'Reset';
  });
  if (reset) {
    reset.addEventListener('click', function () {
      order = initialOrder.slice();
      paint();
      syncTable();
    });
  }

  paint();
  syncTable();
  if (window.ResizeObserver) new ResizeObserver(paint).observe(root);
  window.addEventListener('resize', paint);
})();
"""

EXTRA_CSS = """
/* ── comp: hemicycle seating ─────────────────────────────────────────────── */
#chamber { position: relative; width: 100%; margin-bottom: 14px; }
#chamber-seats { position: absolute; inset: 0; }
.seat {
  position: absolute;
  box-shadow: 0 0 0 1px hsl(var(--foreground) / 0.15);
  font-size: 0;
  transition: left 0.32s cubic-bezier(.2,.7,.3,1), top 0.32s cubic-bezier(.2,.7,.3,1),
              transform 0.32s cubic-bezier(.2,.7,.3,1), opacity 0.12s, box-shadow 0.12s;
  cursor: pointer;
}
.seat.seat--dot { border-radius: 9999px; }
.seat[aria-roledescription] { outline: none; }
.seat.is-hover { box-shadow: 0 0 0 2px hsl(var(--foreground) / 0.55); z-index: 6; }
.seat.is-drop { box-shadow: 0 0 0 2px hsl(var(--primary)); z-index: 7; }
.seat.is-drag { opacity: 0.45 !important; box-shadow: 0 0 0 2px hsl(var(--foreground) / 0.6); z-index: 7; }
.seat.is-selected { box-shadow: 0 0 0 2px hsl(var(--foreground)); z-index: 8; }
.seat:focus-visible { box-shadow: 0 0 0 2px hsl(var(--ring)); z-index: 9; }
tr.row-hover { background-color: hsl(var(--muted) / 0.3); }
#chamber-line {
  position: absolute;
  width: 1px;
  background: hsl(var(--primary));
  transform-origin: 50% 0%;
  z-index: 4;
  pointer-events: none;
}
#chamber-label { position: absolute; z-index: 5; pointer-events: none; }
"""

CHAMBER = """<div class="relative mt-1" id="chamber">
            <div id="chamber-seats"></div>
            <div id="chamber-line"></div>
            <div id="chamber-label">
              <div class="bg-brand text-background font-label text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 whitespace-nowrap" style="transform: translate(-50%, -100%)">{majority} seats required to govern</div>
            </div>
          </div>
          """

COMP_NOTE = """<p class="text-[11px] leading-snug text-muted-foreground">Layout comp. Seats, colours, fills, party table and coalition line are from the running dashboard against the 2026 mock feed at {counted} counted; the arc is a proposal, not shipped. Drag a seat onto another party to reorder.</p>"""


def build(name: str, cfg: dict) -> None:
    body = html[:start] + CHAMBER.format(majority=62) + html[end:]

    script = (
        "<style>\n"
        + EXTRA_CSS
        + "</style>\n<script>\n"
        + LAYOUT_JS.replace("__CFG__", json.dumps(cfg)).replace(
            "__SEATS__", json.dumps(seats, ensure_ascii=False)
        )
        + "\n</script>\n"
    )

    # comp footnote under the "Show all parties" chip, inside the panel
    anchor = '<div class="flex justify-center"><button class="chip-print chip-print--ink'
    i = body.index(anchor)
    j = body.index("</div>", body.index("</button>", i)) + len("</div>")
    body = body[:j] + '<div class="mt-3">' + COMP_NOTE.format(counted="87.4%") + "</div>" + body[j:]

    body = body.replace("</body>", script + "</body>")
    out = HERE / name
    out.write_text(body, encoding="utf-8")
    print("wrote", out, len(body))


build(
    "a-semicircle.html",
    {"span": 180, "armFrac": 0, "maxR": 372, "maxSeat": 19, "padTop": 28, "shape": "square"},
)
build(
    "b-stadium.html",
    {"span": 180, "armFrac": 0.42, "maxR": 352, "maxSeat": 21, "padTop": 28, "shape": "square"},
)
build(
    "d-stadium-dots.html",
    {"span": 180, "armFrac": 0.42, "maxR": 352, "maxSeat": 21, "padTop": 28, "shape": "dot"},
)

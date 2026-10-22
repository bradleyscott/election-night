// Benchmark for the Tier 2 seat simulation. Three implementations of the same
// job, so the answer to "how much compute" is measured rather than assumed.
//
//   A  full per-batch multinomial over all candidates (the naive design)
//   B  per-batch, leader vs challenger only
//   C  aggregate: Beta over the remaining share + a size distribution
//
// Realistic parameters: 71 seats, ~40 outstanding batches per seat, 20,000
// draws per seat.

const SEATS = 71;
const BATCHES = 40;
const CANDIDATES = 7;
const DRAWS = 20_000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

function normal(mu, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia–Tsang gamma, shape >= 1 (our Dirichlet shapes are >> 1).
function gamma(shape) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(0, 1); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function dirichlet(k, concentration) {
  const out = new Array(k);
  let sum = 0;
  for (let i = 0; i < k; i++) { out[i] = gamma(concentration / k); sum += out[i]; }
  for (let i = 0; i < k; i++) out[i] /= sum;
  return out;
}

const seatShares = Array.from({ length: CANDIDATES }, (_, i) => 0.45 - i * 0.06);

function runA() {
  let winners = 0;
  for (let s = 0; s < SEATS; s++) {
    let lead = 1_000, challenge = 0;
    for (let d = 0; d < DRAWS; d++) {
      let a = lead, b = challenge;
      for (let i = 0; i < BATCHES; i++) {
        const n = Math.max(0, Math.round(normal(300, 90)));
        const p = dirichlet(CANDIDATES, 60);
        a += n * p[0];
        b += n * p[1];
      }
      if (a > b) winners++;
    }
  }
  return winners;
}

function runB() {
  let winners = 0;
  for (let s = 0; s < SEATS; s++) {
    let lead = 1_000, challenge = 0;
    for (let d = 0; d < DRAWS; d++) {
      let a = lead, b = challenge;
      for (let i = 0; i < BATCHES; i++) {
        const n = Math.max(0, Math.round(normal(300, 90)));
        const p = dirichlet(2, 60);
        a += n * p[0];
        b += n * p[1];
      }
      if (a > b) winners++;
    }
  }
  return winners;
}

function runC() {
  let winners = 0;
  for (let s = 0; s < SEATS; s++) {
    let lead = 1_000, challenge = 0;
    // Moment-matched once per seat, not per draw.
    const meanRemaining = BATCHES * 300;
    const sdRemaining = Math.sqrt(BATCHES) * 90;
    for (let d = 0; d < DRAWS; d++) {
      const n = Math.max(0, normal(meanRemaining, sdRemaining));
      const share = Math.min(0.95, Math.max(0.05, normal(seatShares[0], 0.05)));
      const a = lead + n * share;
      const b = challenge + n * (1 - share);
      if (a > b) winners++;
    }
  }
  return winners;
}

function time(label, fn) {
  const t0 = process.hrtime.bigint();
  const winners = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perSeat = ms / SEATS;
  console.log(
    `${label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms total   ${perSeat.toFixed(2).padStart(6)} ms/seat   ` +
      `${(winners / (SEATS * DRAWS) * 100).toFixed(1)}% leader holds`
  );
  return { ms, perSeat };
}

console.log(`node ${process.version} · ${SEATS} seats · ${BATCHES} batches · ${CANDIDATES} candidates · ${DRAWS.toLocaleString()} draws/seat\n`);
const a = time('A full multinomial per batch', runA);
const b = time('B per batch, top two only', runB);
const c = time('C aggregate Beta + size', runC);

console.log(
  `\nper poll (all seats):      A ${(a.ms / 1000).toFixed(2)}s   B ${(b.ms / 1000).toFixed(2)}s   C ${(c.ms / 1000).toFixed(3)}s`
);
console.log(
  `over a 5-hour night @30s:  A ${((a.ms * 600) / 60000).toFixed(1)} min   B ${((b.ms * 600) / 60000).toFixed(1)} min   C ${((c.ms * 600) / 60000).toFixed(2)} min`
);

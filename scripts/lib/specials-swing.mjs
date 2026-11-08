/**
 * Parsing and measurement for the special-vote evidence behind
 * `SPECIALS_SWING_SD`. Side-effect free so fixtures can run without fetching
 * the Wayback Machine or executing the CLI.
 *
 * The bug this module exists to prevent: the header row contains candidates
 * and then summary columns ("Total Valid Candidate Votes", "Informal Candidate
 * Votes"). Dropping the summary labels from the header but then reading the
 * first N data cells shifts every value after a summary column, so a summary
 * figure becomes a candidate's vote and the specials come out at twice their
 * real total. Columns are therefore classified with their original index, and
 * data rows are read at those indexes.
 */

/** A page's `<tr>`s, each as an array of trimmed, tag-stripped cell strings. */
export function rows(html) {
  const body = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/&nbsp;/g, ' ');
  const out = [];
  for (const raw of body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [];
    for (const cell of raw.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []) {
      cells.push(
        cell
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    out.push(cells);
  }
  return out;
}

function headerKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True for a summary column, which is a figure about the row (or the table)
 * and never a candidate. Spacing, case and punctuation vary between cycles.
 */
export function isSummaryHeader(label) {
  const key = headerKey(label);
  if (!key) return true;
  return (
    key === 'total valid candidate votes' ||
    key === 'total valid votes' ||
    key === 'informal candidate votes' ||
    key === 'informal votes' ||
    key.startsWith('total valid ') ||
    key.startsWith('informal ')
  );
}

function isTotalRow(label) {
  return /\btotal$/i.test(label.trim());
}

function isSpecialRow(label) {
  if (!/special\s*votes?/i.test(label)) return false;
  if (/less than/i.test(label)) return false;
  // A pre-summed special row would double the three category rows.
  if (/^special votes? total$/i.test(headerKey(label))) return false;
  return true;
}

/**
 * One electorate page → its candidates, its total, and its special votes.
 *
 * `columns` keeps each candidate's original cell index. Consumers that only
 * need names use `candidates`; the row reader uses `columns` so a summary
 * column anywhere in the header cannot shift the numbers.
 */
export function parsePage(html) {
  let columns = null;
  let electorate = null;
  const special = {};
  let total = null;

  const num = (value) => {
    const digits = String(value ?? '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  };

  for (const cells of rows(html)) {
    if (!cells.length) continue;

    if (!columns) {
      if (/Candidate Vote Details?$/.test(cells[0]) && cells.length > 3) {
        columns = [];
        cells.slice(1).forEach((label, index) => {
          if (isSummaryHeader(label)) return;
          columns.push({ name: label, index: index + 1 });
        });
        electorate = cells[0]
          .replace(/\s+\d+$/, '')
          .replace(/\s*Candidate Vote Details?$/, '')
          .trim();
      }
      continue;
    }

    if (columns.length === 0) continue;
    if (columns.some(({ index }) => index >= cells.length)) continue;

    const values = columns.map(({ index }) => num(cells[index]));

    if (isSpecialRow(cells[0])) {
      columns.forEach(({ name }, i) => {
        special[name] = (special[name] ?? 0) + values[i];
      });
    } else if (isTotalRow(cells[0])) {
      total = {};
      columns.forEach(({ name }, i) => {
        total[name] = values[i];
      });
    }
  }

  return {
    electorate,
    candidates: columns?.map(({ name }) => name) ?? null,
    columns,
    special,
    total,
  };
}

/** The two-candidate differential, as a fraction of the votes in that pool. */
export function differential(a, b, pool) {
  const total = Object.values(pool).reduce((n, v) => n + v, 0);
  return total > 0 ? (pool[a] - pool[b]) / total : null;
}

export function measure(seats) {
  const out = [];
  for (const [electorate, s] of Object.entries(seats)) {
    if (!s.special || !s.total) continue;
    const top = Object.keys(s.total)
      .sort((a, b) => s.total[b] - s.total[a])
      .slice(0, 2);
    if (top.length < 2) continue;
    const [a, b] = top;

    const ordinary = {};
    for (const name of Object.keys(s.total)) {
      ordinary[name] = s.total[name] - (s.special[name] ?? 0);
    }
    const dSpecial = differential(a, b, s.special);
    const dOrdinary = differential(a, b, ordinary);
    if (dSpecial === null || dOrdinary === null) continue;

    const specialTotal = Object.values(s.special).reduce((n, v) => n + v, 0);
    if (specialTotal <= 0) continue;

    out.push({
      electorate,
      winner: a,
      runnerUp: b,
      specialVotes: specialTotal,
      finalMargin: s.total[a] - s.total[b],
      countMargin: ordinary[a] - ordinary[b],
      swing: Number(((dSpecial - dOrdinary) * 100).toFixed(2)),
    });
  }
  return out.sort((x, y) => x.electorate.localeCompare(y.electorate));
}

export function stats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  );
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) =>
    sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return {
    n,
    mean,
    sd,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    over10: values.filter((v) => Math.abs(v) > 10).length,
  };
}

/**
 * Bump when the parsed shape or the parser's meaning changes. A cache without
 * this exact version is refused rather than trusted; the CLI regenerates it.
 */
export const CACHE_VERSION = 2;

/** Parse a cached seats file, returning null for a legacy or foreign cache. */
export function decodeParsedCache(raw, year) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.version !== CACHE_VERSION || parsed.year !== year) {
    return null;
  }
  const seats = parsed.seats;
  if (!seats || typeof seats !== 'object' || Array.isArray(seats)) return null;
  return seats;
}

/** Wrap the seats with their version, cycle, generation time and sources. */
export function encodeParsedCache({ year, seats, sources }) {
  return JSON.stringify(
    {
      version: CACHE_VERSION,
      year,
      generatedAt: new Date().toISOString(),
      sources,
      seats,
    },
    null,
    1
  );
}

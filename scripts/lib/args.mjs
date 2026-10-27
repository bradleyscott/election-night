/**
 * Argument reading for the offline scripts.
 *
 * Two spellings are in use: `--name value` (the baseline builder) and
 * `--name=value` (the validation harness). Each script implemented only its
 * own, so passing the other form silently fell back to the default — running
 * `validate-seat-probability.mjs --year 2020` validated 2023. One reader
 * accepts both, and `hasFlag` covers a bare switch.
 *
 * The boundary fetcher keeps its own strict parser: it has a fixed set of
 * options, rejects an unknown one, and prints its own source as `--help`.
 */
export function arg(name, fallback) {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) return value;
  }

  return fallback;
}

/** Whether a bare `--name` switch is present. */
export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

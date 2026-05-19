/**
 * Compute the next look_NN id given the current maximum.
 *
 * Pure function. Caller is responsible for fetching the max look_id from the DB
 * (e.g. via `SELECT look_id FROM rachel_looks ORDER BY look_id DESC LIMIT 1`).
 *
 * @param currentMaxLookId — the current max look_id in the table, or null if the table is empty.
 * @returns the next zero-padded `look_NN` id.
 * @throws on overflow (current max is look_99) — format decision deferred per YAR-136 plan.
 * @throws on malformed input that doesn't match /^look_\d{2}$/.
 */
export function nextLookIdFrom(currentMaxLookId: string | null): string {
  if (currentMaxLookId === null) return 'look_01';

  const match = /^look_(\d{2})$/.exec(currentMaxLookId);
  if (!match) {
    throw new Error(`nextLookIdFrom: malformed look_id "${currentMaxLookId}" — expected /^look_\\d{2}$/`);
  }
  const n = Number.parseInt(match[1], 10);
  if (n >= 99) {
    throw new Error(`nextLookIdFrom: overflow — current max is "${currentMaxLookId}", cannot increment past look_99 with 2-digit format`);
  }
  return `look_${String(n + 1).padStart(2, '0')}`;
}

/**
 * Compute the next sequential ID for a given prefix.
 *
 * Pure function. Caller is responsible for fetching the current max ID from
 * the DB (e.g. `SELECT look_id FROM rachel_looks ORDER BY look_id DESC LIMIT 1`).
 *
 * @param prefix - e.g. 'look' or 'location'. ID format is `<prefix>_NN` with
 *   two-digit zero-padded numeric suffix.
 * @param currentMaxId - current max ID matching `<prefix>_NN`, or null if
 *   no rows exist.
 * @returns the next zero-padded ID, e.g. 'look_12'.
 * @throws on overflow (99 → 100 would break 2-digit format) or malformed input.
 */
export function nextIdFrom(prefix: string, currentMaxId: string | null): string {
  if (currentMaxId === null) return `${prefix}_01`;

  const re = new RegExp(`^${prefix}_(\\d{2})$`);
  const match = re.exec(currentMaxId);
  if (!match) {
    throw new Error(
      `nextIdFrom: malformed id "${currentMaxId}" — expected /^${prefix}_\\d{2}$/`,
    );
  }
  const n = Number.parseInt(match[1], 10);
  if (n >= 99) {
    throw new Error(
      `nextIdFrom: overflow — current max is "${currentMaxId}", cannot increment past 99 with 2-digit format`,
    );
  }
  return `${prefix}_${String(n + 1).padStart(2, '0')}`;
}

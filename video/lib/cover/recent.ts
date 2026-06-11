// Recent-cover extraction for the variance rule: any
// {expression, framing, composition_side} combination used in the last 5
// covers is excluded from the next directive.

import { COMPOSITION_ROTATION, FRAMING_ROTATION } from "./directive.js";
import type { CompositionSide, CoverFraming, RecentCover } from "./types.js";

/**
 * Parse content_queue rows (ordered newest-first) into the variance slice.
 * Rows without a well-formed metadata.cover are skipped, not invented.
 */
export function parseRecentCovers(rows: Array<{ metadata: unknown }>): RecentCover[] {
  const out: RecentCover[] = [];
  for (const row of rows) {
    const cover = (row.metadata as Record<string, any> | null)?.cover;
    if (!cover || typeof cover.expression !== "string") continue;
    if (!FRAMING_ROTATION.includes(cover.framing)) continue;
    if (!COMPOSITION_ROTATION.includes(cover.composition_side)) continue;
    out.push({
      expression: cover.expression,
      framing: cover.framing as CoverFraming,
      composition_side: cover.composition_side as CompositionSide,
    });
  }
  return out.slice(0, 5);
}

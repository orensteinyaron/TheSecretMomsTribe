/**
 * Hook-overlay font-fit rules — pure, dependency-free.
 *
 * Shared sizing logic for the SMT hook overlay so the same rule governs the
 * three locked siblings:
 *   - the Remotion component (`video/src/templates/shared/SMTHookOverlay.tsx`)
 *   - the static thumbnail SVG (`video/scripts/generate-hook-card.ts`)
 *   - the documented design in `FACE_OF_SMT_V1.md`
 *
 * Why a length-tiered font size:
 * 124 px is the LOCKED design size for short, punchy hooks — the whole
 * point of the overlay is a bold dominant line. But the purple block bleeds
 * edge-to-edge by design (left/right −100 px on a 1080 px frame), so a wide
 * dominant line (e.g. "BEST PARENTING") rendered at 124 px overflows the
 * frame into that bleed zone and clips at both edges. The fix: keep 124 px
 * for genuinely short hooks and step the font down for longer ones so the
 * widest wrapped line fits inside the ~90 % safe width of the frame. The TEXT
 * stays inside the frame; the BLOCK still bleeds.
 *
 * Tier boundaries are on VISIBLE character count (trimmed, whitespace
 * collapsed) — spaces don't add render width the way glyphs do, so they're
 * excluded from the count.
 */

/**
 * Text maxWidth as a fraction of frame width. The dominant/secondary lines
 * are constrained to this so wrapped text never reaches the bleeding edge.
 */
export const HOOK_SAFE_WIDTH_FRAC = 0.9;

/** Visible-char count: trim, then collapse internal whitespace runs to nothing. */
function visibleCharCount(s: string): number {
  return s.replace(/\s+/g, "").length;
}

/**
 * Length-tiered dominant-line font size (px).
 *
 *   ≤ 12 visible chars → 124 (locked design size for short hooks)
 *   ≤ 18 visible chars → 108
 *   else               →  92
 *
 * @param primary the dominant hook line (raw, may contain whitespace/case).
 */
export function hookPrimaryFontSize(primary: string): number {
  const chars = visibleCharCount(primary);
  if (chars <= 12) return 124;
  if (chars <= 18) return 108;
  return 92;
}

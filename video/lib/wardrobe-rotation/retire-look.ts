import type { RachelLook } from './types.js';
import { getLook, updateLookStatus, listActiveLooks } from './db.js';

/**
 * Pure floor-3 guard check. Pulled out for testability.
 *
 * cooldown=2 picker needs ≥3 active to avoid persistent fallback path.
 * post-retire count = currentActiveCount - 1, so retire is allowed only when
 * currentActiveCount > 3 (post-retire ≥ 3).
 *
 * @returns `{ ok: true }` if retire is allowed, `{ ok: false; reason }` otherwise.
 */
export function assertCanRetire(
  currentActiveCount: number,
): { ok: true } | { ok: false; reason: string } {
  if (currentActiveCount <= 3) {
    return {
      ok: false,
      reason: `only ${currentActiveCount} active looks remain; pool floor is 3 (cooldown=2 picker needs ≥3 active to avoid persistent fallback path)`,
    };
  }
  return { ok: true };
}

/**
 * Transitions a look from 'active' → 'retired'.
 *
 * Guards:
 * - Look must exist.
 * - Look must currently be 'active'.
 * - Floor-3 guard: retiring must not drop the active pool below 3.
 *   cooldown=2 picker needs ≥3 active to avoid persistent fallback path.
 *   Retire is allowed only when there are at least 4 active looks (post-retire ≥ 3).
 */
export async function retireLook(look_id: string): Promise<RachelLook> {
  const row = await getLook(look_id);

  if (row === null) {
    throw new Error(`retireLook: look_id '${look_id}' not found`);
  }

  if (row.status !== 'active') {
    throw new Error(
      `retireLook: refusing to retire look_id '${look_id}' — current status is '${row.status}', expected 'active'`,
    );
  }

  const activeLooks = await listActiveLooks();

  const decision = assertCanRetire(activeLooks.length);
  if (!decision.ok) {
    throw new Error(`retireLook: refusing to retire look_id '${look_id}' — ${decision.reason}`);
  }

  return updateLookStatus(look_id, 'retired');
}

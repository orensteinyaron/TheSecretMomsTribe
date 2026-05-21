export const LOOK_POOL_FLOOR = 4;
export const LOOK_POOL_WARNING_THRESHOLD = 5;

export function assertCanRetireLook(currentActiveCount: number):
  | { ok: true; warning?: string }
  | { ok: false; reason: string } {
  if (currentActiveCount <= LOOK_POOL_FLOOR) {
    return {
      ok: false,
      reason: `only ${currentActiveCount} active looks remain; pool floor is ${LOOK_POOL_FLOOR} (cooldown=3 picker needs >=4 active to keep >=1 candidate after cooldown)`,
    };
  }
  if (currentActiveCount === LOOK_POOL_WARNING_THRESHOLD) {
    return {
      ok: true,
      warning: `look pool is thinning: only ${currentActiveCount} active looks remain after this retire. Bootstrap more canon looks before retiring further.`,
    };
  }
  return { ok: true };
}

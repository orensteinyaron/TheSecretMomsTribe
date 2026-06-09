/**
 * Publishing lifecycle layer — public surface.
 *
 * Shared by BOTH create-from-url (Phase 1) and smt_publisher (Phase 2).
 *
 *   import { createLifecycle, SupabaseLifecycleStore } from '../../lib/lifecycle/index.js';
 *   const lifecycle = createLifecycle(new SupabaseLifecycleStore());
 *   const { contentId } = await lifecycle.enqueuePiece({ ... });
 *
 * Dry-run / shadow mode (no DB, no platforms):
 *
 *   import { createLifecycle, ShadowLifecycleStore } from '../../lib/lifecycle/index.js';
 *   const lifecycle = createLifecycle(new ShadowLifecycleStore());
 */

export { createLifecycle, type Lifecycle } from './lifecycle.js';
export { SupabaseLifecycleStore } from './supabase-store.js';
export { ShadowLifecycleStore } from './shadow-store.js';
export type { LifecycleStore } from './store.js';
export * from './types.js';

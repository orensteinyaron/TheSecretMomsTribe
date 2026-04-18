/**
 * Shared Supabase client for SMT agents.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env and returns
 * a single createClient instance. Every agent should import from here
 * rather than calling createClient directly — keeps env checks in one
 * place.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

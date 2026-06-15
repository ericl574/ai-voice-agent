import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

// SERVICE-ROLE Supabase client — SERVER-ONLY, for trusted machine-to-machine writers that have
// no user session (Stripe webhook, Twilio phone-call save). It must NEVER be imported from any
// client component or any code path that returns its data unscoped to a caller.
//
// This is not an RLS bypass for user requests: every write made with it is keyed to a specific
// business_id that the server itself resolved (Stripe metadata / Twilio number mapping), and the
// tables it writes keep their RLS for all user-facing reads.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (server env only — never NEXT_PUBLIC_*).

export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

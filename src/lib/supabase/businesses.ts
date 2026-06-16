export interface AgentConfig {
  // Existing fields (Settings page)
  tone?: string;
  staff_handoff_rule?: string;
  booking_rule?: string;
  callback_expectation?: string;
  collect_name?: boolean;
  collect_phone?: boolean;
  collect_service?: boolean;
  collect_notes?: boolean;
  collect_urgency?: boolean;
  // Layer 1 — call behavior profile (stored in JSONB, no migration needed)
  tone_tags?: string[];           // multi-select presets, e.g. ['friendly','calm']
  custom_tone?: string;           // free-form tone text, e.g. "premium, calm, and concise"
  business_hours?: string;        // free-form text, e.g. "Mon–Fri 9am–6pm, Sat 10am–4pm"
  walk_in_allowed?: boolean;
  appointments_require_confirmation?: boolean;
  // Reservation confirmation mode (Settings page):
  //  'staff' (default) — current behavior: reservations land pending; staff confirm manually.
  //  'auto'  — reservation is auto-taken but the caller must confirm via an SMS link by adding a
  //            card on file; status is 'awaiting_customer' until they complete it, then 'confirmed'.
  reservation_confirmation_mode?: 'staff' | 'auto';
  confirmation_window_hours?: number; // hours the caller has to complete the card step (default 24)
  // Call Delivery / after-hours report preferences. Toggles gate delivery; the *_to fields are
  // optional destination overrides (default to the business's own phone/email). Stored in JSONB —
  // no migration.
  notify_email?: boolean;
  notify_sms?: boolean;
  notify_email_to?: string;       // override email destination; falls back to businesses.email
  notify_sms_to?: string;         // override SMS destination; falls back to businesses.phone
  // Delivery model. MVP default is the daily after-hours digest (sent by /api/cron/digest); the
  // instant_* modes are optional per-call delivery (kept, but off by default).
  delivery_mode?: 'daily_digest' | 'after_hours_digest' | 'instant_all' | 'instant_action_needed';
  digest_send_hour?: number;      // 0–23, local business time; the digest goes out at/after this hour (default 8)
  // Editable, vertical-aware chip arrays (owner can add/remove/customize). Empty/undefined
  // → the prompt builder falls back to the vertical's suggested defaults.
  main_request_types?: string[];  // request types this front desk handles
  details_to_collect?: string[];  // caller details to collect when action is needed
  // Chips the owner ×-deleted, hidden from the suggestion row (persisted so deletes survive
  // refresh). Subtracted from suggestions and from the prompt. Cleared by "Reset to defaults".
  hidden_request_types?: string[];
  hidden_details_to_collect?: string[];
  hidden_tone_tags?: string[];
  // Voice settings (applied to the Realtime session's audio.output)
  voice_id?: string;              // OpenAI Realtime voice id, e.g. 'alloy' | 'coral' | 'sage' | 'shimmer'
  voice_speed?: number;           // speaking speed, 0.85–1.25 (default 1.0)
  // Layer 3 — custom instructions (stored in JSONB, no migration needed)
  custom_instructions?: string;
}

export interface Business {
  id: string;
  name: string;
  business_type: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
  timezone: string;
  ai_agent_name: string | null;
  greeting: string | null;
  // Requires migration: ALTER TABLE businesses ADD COLUMN IF NOT EXISTS agent_config jsonb DEFAULT '{}'::jsonb;
  agent_config: AgentConfig | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Accepts both server and browser Supabase clients (no generated DB types required)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getActiveBusiness(supabase: any): Promise<Business | null> {
  try {
    const { data: member, error: memberError } = await supabase
      .from('business_members')
      .select('business_id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError || !member?.business_id) return null;

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', member.business_id)
      .maybeSingle();

    if (bizError || !business) return null;
    return business as Business;
  } catch {
    return null;
  }
}

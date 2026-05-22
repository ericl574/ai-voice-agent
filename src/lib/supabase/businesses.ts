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
  tone_tags?: string[];           // multi-select: ['friendly','calm','direct','efficient']
  business_hours?: string;        // free-form text, e.g. "Mon–Fri 9am–6pm, Sat 10am–4pm"
  walk_in_allowed?: boolean;
  appointments_require_confirmation?: boolean;
  main_request_types?: string[];  // e.g. ['appointments','service_requests','inquiries']
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

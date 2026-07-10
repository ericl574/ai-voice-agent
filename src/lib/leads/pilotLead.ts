// Pure normalize + validate for an inbound pilot request → a durable lead row.
//
// No imports on purpose so the deterministic QA runner can load it (same pattern as digest.ts).
// The /api/pilot-request route uses this to shape a lead it stores in Supabase (source of truth)
// and to reject incomplete submissions BEFORE any storage/email side effect.

// Raw inbound form body (all optional / untrusted).
export interface PilotRequestBody {
  businessName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  businessType?: unknown;
  city?: unknown;
  message?: unknown;
}

// A normalized lead ready to insert. Column names match the pilot_requests table.
export interface PilotLead {
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  business_type: string;
  city: string | null;
  message: string | null;
  source: string;
}

export type BuildPilotLeadResult =
  | { ok: true; lead: PilotLead }
  | { ok: false; error: string };

// Trim + length-cap an untrusted value to a string (empty when absent/non-string).
function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Empty → null (so absent optional fields store as NULL, not '').
function orNull(v: string): string | null {
  return v.length > 0 ? v : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Validate + normalize. Requires a business name, a contact name, and a syntactically valid email;
// everything else is optional. `source` tags where the lead came from (default 'contact_form').
export function buildPilotLead(
  body: PilotRequestBody,
  opts?: { source?: string },
): BuildPilotLeadResult {
  const business_name = clean(body.businessName, 120);
  const contact_name = clean(body.contactName, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const business_type = clean(body.businessType, 40) || 'other';
  const city = clean(body.city, 120);
  const message = clean(body.message, 2000);

  if (!business_name || !contact_name || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please include your business name, your name, and a valid email.' };
  }

  return {
    ok: true,
    lead: {
      business_name,
      contact_name,
      email,
      phone: orNull(phone),
      business_type,
      city: orNull(city),
      message: orNull(message),
      source: opts?.source ?? 'contact_form',
    },
  };
}

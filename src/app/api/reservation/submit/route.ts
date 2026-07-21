import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { AgentConfig } from '@/lib/supabase/businesses';
import { getVertical } from '@/lib/agents/verticals/registry';
import { draftFromClient, canSubmit, stillNeeded, requiredReservationFields } from '@/lib/call-pipeline/reservationDraft';
import { persistReservationRequest, type ReservationMode } from '@/lib/call-pipeline/reservationPersist';

// Browser submit route for the reservation tool. Auth = the owner's Supabase session (RLS); the
// reservation is saved under the owner's active business. The bridge uses the sibling
// /api/twilio/reservation-submit (secret + service-role) — both call the SAME persistReservationRequest
// core, so browser and phone persist identically. NEVER claims "confirmed" (persist status is only
// pending / awaiting_customer). Re-validates the draft server-side (client statuses are not trusted).

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { requestRef?: string; draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const requestRef = typeof body.requestRef === 'string' ? body.requestRef : '';
  if (!requestRef) return NextResponse.json({ persisted: false, error: 'Missing requestRef' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ persisted: false, error: 'unauthorized' }, { status: 401 });

  const business = await getActiveBusiness(supabase);
  if (!business) return NextResponse.json({ persisted: false, error: 'no_business' }, { status: 400 });

  const agentConfig = business.agent_config as AgentConfig | null;
  const mode: ReservationMode = agentConfig?.reservation_confirmation_mode === 'auto' ? 'auto' : 'staff';
  const required = requiredReservationFields(business.business_type, getVertical(business.business_type).requiredFields);
  const draft = draftFromClient(body.draft, required);

  // Deterministic gate: nothing persists (and the assistant may not claim submission) until every
  // required field is valid AND the caller confirmed a read-back.
  if (!canSubmit(draft, required)) {
    return NextResponse.json({ persisted: false, still_needed: stillNeeded(draft, required) });
  }

  const result = await persistReservationRequest(supabase, {
    businessId: business.id,
    requestRef,
    callId: null,
    draft,
    mode,
    windowHours: agentConfig?.confirmation_window_hours ?? 24,
  });
  return NextResponse.json(result);
}

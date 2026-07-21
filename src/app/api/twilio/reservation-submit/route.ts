import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentConfig } from '@/lib/supabase/businesses';
import { getVertical } from '@/lib/agents/verticals/registry';
import { draftFromClient, canSubmit, stillNeeded, requiredReservationFields } from '@/lib/call-pipeline/reservationDraft';
import { persistReservationRequest, type ReservationMode } from '@/lib/call-pipeline/reservationPersist';

// Bridge submit route for the reservation tool. Auth = the shared TWILIO_BRIDGE_SECRET (machine-to-
// machine; the bridge has no user session). business_id is server-supplied by the bridge (originally
// pinned by /api/twilio/voice from the dialed number). Calls the SAME persistReservationRequest core
// as the browser route, so the two paths persist identically. Re-validates the draft server-side.

export const runtime = 'nodejs';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TWILIO_BRIDGE_SECRET;
  if (!secret) return NextResponse.json({ persisted: false, error: 'Bridge not configured' }, { status: 503 });
  if (!secretsMatch(req.headers.get('x-bridge-secret'), secret)) {
    return NextResponse.json({ persisted: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { businessId?: string; requestRef?: string; draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ persisted: false, error: 'Invalid body' }, { status: 400 });
  }
  const businessId = typeof body.businessId === 'string' ? body.businessId : '';
  const requestRef = typeof body.requestRef === 'string' ? body.requestRef : '';
  if (!businessId || !requestRef) {
    return NextResponse.json({ persisted: false, error: 'Missing businessId/requestRef' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ persisted: false, error: 'storage_not_configured' }, { status: 503 });

  const { data: business } = await admin
    .from('businesses')
    .select('business_type, agent_config')
    .eq('id', businessId)
    .maybeSingle();
  if (!business) return NextResponse.json({ persisted: false, error: 'business_unavailable' }, { status: 422 });

  const agentConfig = (business.agent_config as AgentConfig | null) ?? null;
  const mode: ReservationMode = agentConfig?.reservation_confirmation_mode === 'auto' ? 'auto' : 'staff';
  const businessType = (business.business_type as string | null) ?? null;
  const required = requiredReservationFields(businessType, getVertical(businessType).requiredFields);
  const draft = draftFromClient(body.draft, required);

  if (!canSubmit(draft, required)) {
    return NextResponse.json({ persisted: false, still_needed: stillNeeded(draft, required) });
  }

  const result = await persistReservationRequest(admin, {
    businessId,
    requestRef,
    callId: null,
    draft,
    mode,
    windowHours: agentConfig?.confirmation_window_hours ?? 24,
  });
  return NextResponse.json(result);
}

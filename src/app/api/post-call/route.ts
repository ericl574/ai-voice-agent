import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runPostCallExtraction } from '@/lib/call-pipeline/postCallCore';
import { rateLimit, clientKey } from '@/lib/rate-limit';

// Post-call entry point for BROWSER calls (dashboard test calls). Authorizes the signed-in user
// and verifies call ownership, then delegates to the shared post-call core
// (src/lib/call-pipeline/postCallCore.ts) — the same core the Twilio phone path uses, so
// extraction behavior never diverges between the two call sources.

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  let body: { call_id?: string; business_id?: string; transcript?: string; request_ref?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { call_id, business_id, transcript } = body;
  // Idempotency key for a reservation submitted DURING the call (browser reservation tool flow). When
  // present, the post-call core ENRICHES that already-persisted row (matched by request_ref) instead
  // of creating a duplicate; absent → the legacy create-from-transcript path is unchanged.
  const requestRef = typeof body.request_ref === 'string' && body.request_ref ? body.request_ref : null;
  if (!call_id || !business_id || typeof transcript !== 'string') {
    return NextResponse.json(
      { error: 'Missing required fields: call_id, business_id, transcript' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Throttle: each accepted request costs an OpenAI extraction call. Normal flow is one
  // request per finished call, so 20/min/user only stops runaway client loops.
  const rl = rateLimit(`post-call:${clientKey(req, user.id)}`, 20, 60_000);
  if (!rl.ok) {
    console.warn('[FD] post-call rate limited:', clientKey(req, user.id));
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Verify call belongs to this user's business (RLS + explicit eq check)
  const { data: callRow } = await supabase
    .from('calls')
    .select('id')
    .eq('id', call_id)
    .eq('business_id', business_id)
    .single();

  if (!callRow) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // Business context for the extraction (timezone for relative dates, vertical, agent config) and
  // Call Delivery (email destination fallback).
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('timezone, name, phone, email, business_type, agent_config')
    .eq('id', business_id)
    .single();

  const result = await runPostCallExtraction({
    supabase,
    apiKey,
    callId: call_id,
    businessId: business_id,
    transcript,
    bizRow: bizRow ?? null,
    origin: new URL(req.url).origin,
    requestRef,
  });

  return NextResponse.json({
    ok: true,
    extraction: result.extraction,
    appointmentCreated: result.appointmentCreated,
    serviceRequestCreated: result.serviceRequestCreated,
    ...(result.appointmentError && { appointmentError: result.appointmentError }),
    ...(result.serviceRequestError && { serviceRequestError: result.serviceRequestError }),
  });
}

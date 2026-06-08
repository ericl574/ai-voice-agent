import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, clientKey } from '@/lib/rate-limit';

// Server front for the public reservation-confirmation flow. The unauthenticated /confirm/[token]
// page calls this instead of hitting the anon RPCs directly — giving one throttle + logging
// choke-point. The SECURITY DEFINER RPCs remain the only DB surface anon can reach.

export const runtime = 'nodejs';

// GET /api/reservations/confirm?token=… → reservation summary (or null)
export async function GET(req: NextRequest) {
  const rl = rateLimit(`reservation-confirm:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_reservation_for_confirmation', { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    const reservation = Array.isArray(data) ? data[0] ?? null : data ?? null;
    return NextResponse.json({ reservation });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// POST /api/reservations/confirm { token } → { result }
export async function POST(req: NextRequest) {
  const rl = rateLimit(`reservation-confirm:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('confirm_reservation', { p_token: body.token });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    console.log('[FD] reservation confirm result:', String(data));
    return NextResponse.json({ result: String(data) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

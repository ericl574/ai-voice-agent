import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { classifyCallHealth } from '@/lib/call-pipeline/callHealth';

// GET /api/ops/calls?hours=48&limit=100
// Operator-only quick view of recent calls + failure/low-quality flags ACROSS all businesses, so a
// concierge-pilot operator can spot bad calls fast without signing into each dashboard. Guarded by
// CRON_SECRET (Authorization: Bearer <CRON_SECRET>), read-only, service-role. No caller PII beyond a
// truncated summary; returns ids + flags. See docs/first-customer-onboarding.md.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Ops endpoint not configured (set CRON_SECRET)' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!secretsMatch(bearer, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Server storage not configured' }, { status: 503 });
  }

  const hours = Math.min(720, Math.max(1, Number(req.nextUrl.searchParams.get('hours')) || 48));
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  // `*` so a missing `analysis` column (calls_analysis migration not yet run) never errors the query.
  const { data, error } = await admin
    .from('calls')
    .select('*')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[FD] ops/calls query failed:', error.message);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const calls = rows.map((r) => {
    const health = classifyCallHealth({
      status: r.status as string | null,
      summary: r.summary as string | null,
      needs_staff_followup: r.needs_staff_followup as boolean | null,
      analysis:
        (r.analysis as { confidence?: string; risk_flags?: string[]; staff_action_required?: boolean } | null) ?? null,
    });
    return {
      id: r.id,
      business_id: r.business_id,
      created_at: r.created_at,
      status: r.status,
      intent: r.intent,
      problem: health.problem,
      needs_followup: health.needs_followup,
      reasons: health.reasons,
      summary: typeof r.summary === 'string' ? (r.summary as string).slice(0, 160) : null,
    };
  });

  return NextResponse.json({
    ok: true,
    window_hours: hours,
    total: calls.length,
    problems: calls.filter((c) => c.problem).length,
    needs_followup: calls.filter((c) => c.needs_followup).length,
    // problem calls first, then newest.
    calls: calls.sort((a, b) => Number(b.problem) - Number(a.problem)),
  });
}

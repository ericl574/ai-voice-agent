import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { getVertical } from '@/lib/agents/verticals/registry';
import {
  formatKnowledgeForRealtime,
  retrieveKnowledge,
} from '@/lib/knowledge/retrieval';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rl = rateLimit(
  `knowledge-retrieve:${clientKey(req, user.id)}`,
  20,
  60_000,
);

if (!rl.ok) {
  return NextResponse.json(
    { error: 'Too many retrieval requests' },
    {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    },
  );
}

  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 1000) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }

  const business = await getActiveBusiness(supabase);
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const verticalId = getVertical(business.business_type).id;
  if (verticalId !== 'auto_repair') {
    return NextResponse.json({ error: 'Knowledge retrieval unavailable' }, { status: 422 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Retrieval unavailable' }, { status: 503 });
  }

  try {
    const chunks = await retrieveKnowledge(admin, {
      businessId: business.id,
      verticalId,
      query,
    });

    return NextResponse.json({
      context: formatKnowledgeForRealtime(chunks),
      matchCount: chunks.length,
    });
  } catch {
    return NextResponse.json({ error: 'Retrieval failed' }, { status: 502 });
  }
}
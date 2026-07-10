// Concierge activation helper — map a business to its FrontDesk Twilio number.
//
// Given a business_id (and optionally a Twilio number), it: verifies the business exists, saves/maps
// businesses.twilio_number (normalized to E.164), and prints the remaining env/webhook checklist.
// It does NOT buy Twilio numbers and does NOT deploy anything — those stay manual (PILOT_ACTIVATION.md).
//
// Run:  npm run pilot:map -- <business_id> [twilio_number]
//   e.g. npm run pilot:map -- 3f2a…  "+16045550100"
//   (read-only check — omit the number)   npm run pilot:map -- 3f2a…
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the npm script loads .env.local).

import { createAdminClient } from '../src/lib/supabase/admin.ts';

function toE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (raw.trim().startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits; // NANP 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits; // best-effort for international
}

function fail(msg: string): never {
  console.error(`\n✗  ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [businessId, rawNumber] = process.argv.slice(2);
  if (!businessId) {
    fail('Usage: npm run pilot:map -- <business_id> [twilio_number]');
  }

  const admin = createAdminClient();
  if (!admin) {
    fail(
      'Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n' +
        '   (the pilot:map npm script loads .env.local automatically — make sure both are in it).',
    );
  }

  // 1) Verify the business exists.
  const { data: biz, error: bizErr } = await admin
    .from('businesses')
    .select('id, name, business_type, timezone, twilio_number')
    .eq('id', businessId)
    .maybeSingle();
  if (bizErr) fail(`Lookup failed: ${bizErr.message}`);
  if (!biz) fail(`No business found with id ${businessId}. Check the id in Supabase → businesses.`);

  console.log(`\n✓  Business: ${biz.name ?? '(unnamed)'}  [${biz.business_type ?? 'other'}]  tz=${biz.timezone ?? '?'}`);
  console.log(`   current twilio_number: ${biz.twilio_number ?? '(none)'}`);

  // 2) Map the number, if provided.
  let mapped = biz.twilio_number as string | null;
  if (rawNumber) {
    const e164 = toE164(rawNumber);
    if (!e164 || e164.replace(/\D/g, '').length < 10) fail(`"${rawNumber}" is not a usable phone number.`);
    const { error: updErr } = await admin.from('businesses').update({ twilio_number: e164 }).eq('id', businessId);
    if (updErr) {
      fail(
        `Could not save twilio_number: ${updErr.message}\n` +
          '   If it says the column is missing, apply migration\n' +
          '   supabase/migrations/20260702000000_business_twilio_number.sql first.',
      );
    }
    mapped = e164;
    console.log(`\n✓  Mapped ${biz.name ?? businessId} → ${e164}`);
  } else {
    console.log('\n(no number given — read-only check. Pass a number as the 2nd arg to map it.)');
  }

  // 3) Remaining steps checklist.
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || '<your-vercel-domain>';
  console.log('\n── Remaining concierge activation steps (see PILOT_ACTIVATION.md) ──');
  console.log(`  [ ] Twilio number ${mapped ?? '<number>'} → "A call comes in" webhook: ${appUrl}/api/twilio/voice  (HTTP POST)`);
  console.log('  [ ] Vercel env: OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL, TWILIO_AUTH_TOKEN,');
  console.log('       TWILIO_STREAM_URL, TWILIO_BRIDGE_SECRET, CRON_SECRET  (+ RESEND_API_KEY/NOTIFY_EMAIL_FROM for email)');
  console.log('  [ ] Bridge host env: OPENAI_API_KEY, TWILIO_BRIDGE_SECRET, FD_APP_URL  — then `npm run twilio:bridge`');
  console.log('  [ ] Confirm RLS on business-data tables (docs/supabase-rls-verification.md)');
  console.log('  [ ] Place ONE real acceptance call; watch bridge logs for `post-call → 200`');
  console.log('  [ ] Monitor: curl -H "Authorization: Bearer $CRON_SECRET" ' + appUrl + '/api/ops/calls\n');
}

void main();

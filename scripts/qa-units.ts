// qa-units.ts
// Deterministic unit tests for pure helpers (no browser, no network, no Supabase).
// Run: node --experimental-strip-types scripts/qa-units.ts

import {
  parseApptDateTime,
  effectiveStatus,
  startOfWeek,
  type DbAppointment,
} from '../src/lib/appointments.ts';

import {
  resolveRuntimeVoice,
  getVoiceById,
  ENABLED_VOICE_OPTIONS,
} from '../src/lib/voice/voices.ts';

import { looksLikeNoiseOrEmpty } from '../src/lib/call-pipeline/noise.ts';
import { classifyCallerIntent } from '../src/lib/call-pipeline/intent.ts';
import { looksLikeEndCall } from '../src/lib/call-pipeline/endCall.ts';
import { deriveCallStatus } from '../src/lib/call-pipeline/callStatus.ts';
import { isPastAppointment } from '../src/lib/call-pipeline/pastTime.ts';
import { REALTIME_VAD, REALTIME_NOISE_REDUCTION } from '../src/lib/realtime/turnDetection.ts';
import { readFileSync } from 'node:fs';
import {
  decideDelivery,
  composeCallSms,
  composeCallEmail,
  type CallSummaryForDelivery,
} from '../src/lib/notify/compose.ts';
import {
  composeDigestEmail,
  composeDigestSms,
  buildCallsCsv,
  type DigestCall,
} from '../src/lib/notify/digest.ts';
import { toE164 } from '../src/lib/notify/sms.ts';
import {
  buildOpsAlert,
  dueForAlert,
  markAlertSent,
  notifyOps,
  opsAlertKey,
  OPS_ALERT_COOLDOWN_MS,
} from '../src/lib/notify/ops.ts';
import { buildTranscript, countCallerTurns } from '../src/lib/call-pipeline/transcript.ts';
import { nowInTimeZone } from '../src/lib/call-pipeline/time.ts';
import {
  EXTRACTION_SKIPPED_NO_API_KEY,
  extractionSkippedResponse,
  extractionSkippedOpsAlert,
} from '../src/lib/call-pipeline/extractionSkip.ts';
import { buildBridgeHealth } from '../server/twilio-bridge.ts';

// Vertical profiles imported DIRECTLY (each file's only import is `import type`, stripped at
// runtime), so the Node QA runner can load them — unlike registry.ts, which has extensionless
// cross-file value imports the runner can't resolve.
import { genericProfile } from '../src/lib/agents/verticals/generic.ts';
import { restaurantProfile } from '../src/lib/agents/verticals/restaurant.ts';
import { autoRepairProfile } from '../src/lib/agents/verticals/autoRepair.ts';
import { salonSpaProfile } from '../src/lib/agents/verticals/salonSpa.ts';
import { clinicProfile } from '../src/lib/agents/verticals/clinic.ts';
import { tutoringProfile } from '../src/lib/agents/verticals/tutoring.ts';
import { homeServicesProfile } from '../src/lib/agents/verticals/homeServices.ts';
import { GLOBAL_RULES } from '../src/lib/agents/core/globalRules.ts';
import type { VerticalProfile, CollectableField } from '../src/lib/agents/core/types.ts';

// ── Minimal test runner (mirrors qa-call-pipeline.ts) ────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];
const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

async function runTests(): Promise<void> {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓  ${name}`);
      passed++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗  ${name}`);
      console.error(`     ${msg}`);
      failures.push(`${name}: ${msg}`);
      failed++;
    }
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function appt(partial: Partial<DbAppointment>): DbAppointment {
  return { id: 'x', business_id: 'b', status: 'pending', created_at: '2026-01-01T00:00:00Z', ...partial };
}

// ── parseApptDateTime ────────────────────────────────────────────────────────

test('parseApptDateTime — ISO date + time', () => {
  const d = parseApptDateTime(appt({ appointment_date: '2026-06-10', appointment_time: '14:30' }));
  assert(d != null, 'should parse ISO');
  eq(d!.getHours(), 14, 'hours');
  eq(d!.getMinutes(), 30, 'minutes');
});

test('parseApptDateTime — demo locale strings', () => {
  const d = parseApptDateTime(appt({ appointment_date: 'Jun 7, 2026', appointment_time: '6:30 PM' }));
  assert(d != null, 'should parse locale string');
  eq(d!.getHours(), 18, 'PM hour');
});

test('parseApptDateTime — falls back to requested_* fields', () => {
  const d = parseApptDateTime(appt({ requested_date: '2026-06-10', requested_time: '09:00' }));
  assert(d != null, 'should parse requested_* fallback');
  eq(d!.getHours(), 9, 'hours');
});

test('parseApptDateTime — missing time → null', () => {
  eq(parseApptDateTime(appt({ appointment_date: '2026-06-10' })), null, 'no time');
});

test('parseApptDateTime — missing date → null', () => {
  eq(parseApptDateTime(appt({ appointment_time: '14:30' })), null, 'no date');
});

// ── effectiveStatus ──────────────────────────────────────────────────────────

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();

test('effectiveStatus — awaiting past window → expired', () => {
  eq(effectiveStatus(appt({ status: 'awaiting_customer', expires_at: past })), 'expired', 'expired');
});

test('effectiveStatus — awaiting within window → awaiting_customer', () => {
  eq(effectiveStatus(appt({ status: 'awaiting_customer', expires_at: future })), 'awaiting_customer', 'still awaiting');
});

test('effectiveStatus — awaiting with no expires_at → awaiting_customer', () => {
  eq(effectiveStatus(appt({ status: 'awaiting_customer' })), 'awaiting_customer', 'no expiry');
});

test('effectiveStatus — confirmed/pending pass through', () => {
  eq(effectiveStatus(appt({ status: 'confirmed' })), 'confirmed', 'confirmed');
  eq(effectiveStatus(appt({ status: 'pending' })), 'pending', 'pending');
});

// ── startOfWeek ──────────────────────────────────────────────────────────────

test('startOfWeek — Monday anchor', () => {
  // 2026-06-10 is a Wednesday → week start Monday 2026-06-08.
  const s = startOfWeek(new Date(2026, 5, 10));
  eq(s.getDay(), 1, 'Monday is day 1');
  eq(s.getDate(), 8, 'Monday date');
});

// ── voices config ────────────────────────────────────────────────────────────

test('resolveRuntimeVoice — known voice resolves', () => {
  const v = resolveRuntimeVoice('alloy');
  assert(v != null, 'alloy resolves');
  eq(v!.runtimeVoiceId, 'alloy', 'runtimeVoiceId');
});

test('resolveRuntimeVoice — unknown / null → undefined', () => {
  eq(resolveRuntimeVoice('bogus'), undefined, 'bogus');
  eq(resolveRuntimeVoice(null), undefined, 'null');
});

test('getVoiceById — known / unknown', () => {
  assert(getVoiceById('coral') != null, 'coral exists');
  eq(getVoiceById('nope'), undefined, 'nope');
});

test('ENABLED_VOICE_OPTIONS — all enabled + have preview urls', () => {
  assert(ENABLED_VOICE_OPTIONS.length > 0, 'has voices');
  for (const v of ENABLED_VOICE_OPTIONS) {
    assert(v.enabled, `${v.id} enabled`);
    assert(v.previewAudioUrl.startsWith('/voice-samples/'), `${v.id} preview url`);
  }
});

// ── looksLikeNoiseOrEmpty — noisy-call fragment filtering ─────────────────────

test('looksLikeNoiseOrEmpty — filters empty / whitespace', () => {
  assert(looksLikeNoiseOrEmpty('') === true, 'empty');
  assert(looksLikeNoiseOrEmpty('   ') === true, 'whitespace');
});

test('looksLikeNoiseOrEmpty — filters punctuation-only', () => {
  for (const s of ['.', '...', '?', '?!', '-', '. . .']) {
    assert(looksLikeNoiseOrEmpty(s) === true, `punctuation: ${JSON.stringify(s)}`);
  }
});

test('looksLikeNoiseOrEmpty — filters known fillers / silence hallucinations (exact only)', () => {
  for (const s of ['uh', 'um', 'hmm', 'You', 'you', 'Thanks for watching', 'thank you for watching.', '[BLANK_AUDIO]', '(inaudible)']) {
    assert(looksLikeNoiseOrEmpty(s) === true, `junk: ${JSON.stringify(s)}`);
  }
});

test('looksLikeNoiseOrEmpty — KEEPS valid short replies', () => {
  for (const s of ['yes', 'no', 'yep', 'no thanks', 'ok', 'okay', 'Friday', 'Monday', 'tomorrow', 'today', '2 PM', '7:30', 'Eric', "that's all", 'sounds good', 'thank you', 'thanks', 'bye', '555-1234', '5551234']) {
    assert(looksLikeNoiseOrEmpty(s) === false, `should keep: ${JSON.stringify(s)}`);
  }
});

test('looksLikeNoiseOrEmpty — junk token only filtered as whole fragment, not as substring', () => {
  // "you" is filtered alone, but a real sentence containing it is kept.
  assert(looksLikeNoiseOrEmpty('you') === true, 'lone you');
  assert(looksLikeNoiseOrEmpty('can you book me for Friday') === false, 'sentence with you');
  assert(looksLikeNoiseOrEmpty('thank you so much, see you Friday') === false, 'closing sentence');
});

test('looksLikeNoiseOrEmpty — keeps non-Latin caller turns (Unicode-aware)', () => {
  for (const s of [
    '我想改预订时间',          // Chinese
    '明日の予約をしたいです',   // Japanese
    '내일 예약하고 싶어요',     // Korean
    'хочу записаться завтра',  // Russian/Cyrillic
    'أريد حجز موعد غدا',       // Arabic
    'I want to book 明天上午十点', // code-switched
  ]) {
    assert(looksLikeNoiseOrEmpty(s) === false, `non-Latin/code-switched must be kept: ${JSON.stringify(s)}`);
  }
});

// ── buildTranscript — Realtime transcript assembly (source of truth) ──────────

test('buildTranscript — interleaved order + role labels', () => {
  const out = buildTranscript([
    { role: 'assistant', text: 'Thanks for calling, how can I help?' },
    { role: 'user', text: "I'd like a table Friday" },
    { role: 'assistant', text: 'For how many?' },
    { role: 'user', text: 'Four' },
  ]);
  eq(
    out,
    'Front desk: Thanks for calling, how can I help?\nCaller: I\'d like a table Friday\nFront desk: For how many?\nCaller: Four',
    'interleaved transcript',
  );
});

test('buildTranscript — drops empty placeholders and caller noise/junk', () => {
  const out = buildTranscript([
    { role: 'user', text: '' },          // empty placeholder
    { role: 'user', text: '  ' },        // whitespace
    { role: 'user', text: 'uh' },        // filler junk
    { role: 'user', text: '...' },       // punctuation
    { role: 'user', text: 'you' },       // silence hallucination
    { role: 'assistant', text: 'Hello' },
    { role: 'user', text: 'yes' },       // valid short reply — kept
  ], looksLikeNoiseOrEmpty);
  eq(out, 'Front desk: Hello\nCaller: yes', 'noise/empty dropped, valid kept');
});

test('buildTranscript — never filters assistant turns', () => {
  // "you" would be filtered as a caller turn, but assistant turns are never filtered.
  const out = buildTranscript([{ role: 'assistant', text: 'you' }], looksLikeNoiseOrEmpty);
  eq(out, 'Front desk: you', 'assistant kept');
});

test('countCallerTurns — counts only real caller speech', () => {
  eq(
    countCallerTurns([
      { role: 'user', text: 'yes' },
      { role: 'user', text: 'uh' },     // junk — not counted
      { role: 'user', text: '' },        // empty — not counted
      { role: 'assistant', text: 'ok' }, // assistant — not a caller turn
      { role: 'user', text: 'Friday' },
    ], looksLikeNoiseOrEmpty),
    2,
    'two real caller turns',
  );
});

// ── classifyCallerIntent — Layer 2 caller-intent gate ─────────────────────────
// Runs AFTER looksLikeNoiseOrEmpty, so it only sees plausibly-real caller text. Conservative:
// 'backchannel' only for whole-fragment bare acknowledgements (suppressed only while the assistant
// speaks); explicit control phrases → 'interruption'; everything else → 'substantive'.

test('classifyCallerIntent — bare acknowledgements → backchannel', () => {
  for (const s of ['mhm', 'mm-hmm', 'uh-huh', 'yeah', 'yep', 'ok', 'okay', 'right', 'sure', 'got it', 'I see', 'hmm', 'oh okay']) {
    eq(classifyCallerIntent(s), 'backchannel', `backchannel: ${JSON.stringify(s)}`);
  }
});

test('classifyCallerIntent — backchannel only as WHOLE fragment, not substring', () => {
  // A real answer that merely starts with an ack word must stay substantive.
  eq(classifyCallerIntent('okay tomorrow at five'), 'substantive', 'okay + content');
  eq(classifyCallerIntent('yeah book me for Friday'), 'substantive', 'yeah + content');
  eq(classifyCallerIntent('sure, four people'), 'substantive', 'sure + content');
});

test('classifyCallerIntent — meaningful short answers stay substantive', () => {
  // "no" is NEVER a backchannel; real one-word/value answers are substantive.
  for (const s of [
    'no', 'no thanks', 'five', 'five people', 'Eric', 'Friday', '2 PM', 'tomorrow',
    'tonight', 'evening', 'noon', 'two', 'a haircut', '555-1234', '6045551234',
  ]) {
    eq(classifyCallerIntent(s), 'substantive', `substantive: ${JSON.stringify(s)}`);
  }
});

test('classifyCallerIntent — explicit control phrases → interruption', () => {
  for (const s of ['wait', 'stop', 'hold on', 'hang on', 'no actually', 'never mind', 'cancel that', 'I want to change that', 'back to English', 'can you speak English']) {
    eq(classifyCallerIntent(s), 'interruption', `interruption: ${JSON.stringify(s)}`);
  }
});

test('classifyCallerIntent — non-Latin / code-switched text stays substantive', () => {
  for (const s of ['三位', '我想改预订时间', '내일 예약하고 싶어요', 'I want to book 明天上午十点']) {
    eq(classifyCallerIntent(s), 'substantive', `non-Latin substantive: ${JSON.stringify(s)}`);
  }
});

// ── looksLikeEndCall — context-free hard end-cue detection (freeze) ───────────
// Context-free: matches ONLY unambiguous hard end cues. Bare "thanks"/"no thanks" are intentionally
// NOT hard end cues — their natural close comes from prompt behavior + the playback-aware/inactivity
// end flow, not this helper.

test('looksLikeEndCall — positive hard end cues → true', () => {
  for (const s of ["bye", "that's all", "nothing else", "no that's it", "I'm done", "we're done", "hang up", "goodbye", "you can hang up"]) {
    assert(looksLikeEndCall(s) === true, `should end: ${JSON.stringify(s)}`);
  }
});

test('looksLikeEndCall — bare "thanks" is NOT a context-free hard end cue', () => {
  // The helper can't know the assistant just asked "anything else?"; bare thanks closes via prompt +
  // playback-aware/inactivity flow instead.
  for (const s of ["thanks", "thank you", "thanks so much", "no thanks"]) {
    assert(looksLikeEndCall(s) === false, `should NOT hard-end: ${JSON.stringify(s)}`);
  }
});

test('looksLikeEndCall — a real follow-up question is never an end', () => {
  for (const s of ["no, what are your hours?", "actually one more thing", "thanks, can you check Friday?", "bye, do you take walk-ins?"]) {
    assert(looksLikeEndCall(s) === false, `should NOT end (follow-up): ${JSON.stringify(s)}`);
  }
});

// ── Vertical required-fields schema + caution #1 guard (Batch 2) ──────────────
// The requiredFields schema (post-call completeness SoT) must stay sane, AND must NOT cause the
// prompt to lose vertical-specific detail — those details still live in collectionPriorities /
// suggestedDetailFields. This suite locks both invariants deterministically.

const ALL_PROFILES: VerticalProfile[] = [
  genericProfile, restaurantProfile, autoRepairProfile, salonSpaProfile,
  clinicProfile, tutoringProfile, homeServicesProfile,
];
const VALID_FIELDS = new Set<CollectableField>(['name', 'phone', 'date', 'time', 'service']);

test('requiredFields/optionalFields use only valid core keys, and are disjoint', () => {
  for (const p of ALL_PROFILES) {
    for (const f of p.requiredFields) assert(VALID_FIELDS.has(f), `${p.id} required has invalid key ${f}`);
    for (const f of p.optionalFields) assert(VALID_FIELDS.has(f), `${p.id} optional has invalid key ${f}`);
    const overlap = p.requiredFields.filter((f) => p.optionalFields.includes(f));
    eq(overlap.length, 0, `${p.id} required/optional overlap`);
  }
});

test('phone is NEVER a required field (product rule: never block on missing phone)', () => {
  for (const p of ALL_PROFILES) {
    assert(!p.requiredFields.includes('phone'), `${p.id} must not require phone`);
  }
});

test('caution #1 — vertical-specific details remain in prompt guidance (not lost to the core schema)', () => {
  // requiredFields is COARSE; these industry specifics must still be present in the prompt text.
  const expect: Array<{ p: VerticalProfile; needle: string }> = [
    { p: restaurantProfile, needle: 'party size' },
    { p: autoRepairProfile, needle: 'vehicle' },
    { p: homeServicesProfile, needle: 'location' },
    { p: clinicProfile, needle: 'reason' },
    { p: tutoringProfile, needle: 'subject' },
    { p: salonSpaProfile, needle: 'staff' },
  ];
  for (const { p, needle } of expect) {
    const text = `${p.collectionPriorities} ${p.suggestedDetailFields.join(' ')}`.toLowerCase();
    assert(text.includes(needle), `${p.id} prompt guidance must still mention "${needle}"`);
  }
});

// ── GLOBAL_RULES — load-bearing safety lines (cheap guard) ────────────────────
// Coarse substring checks only: the prompt wording may evolve freely, but these safety-critical
// concepts must never silently disappear from the core rules.

test('GLOBAL_RULES — safety-critical lines are present', () => {
  const rules = GLOBAL_RULES.toLowerCase();
  const fragments: Array<[string, string]> = [
    ['never claim to be human', 'identity honesty'],
    ['phone number is always optional', 'phone never blocks a request'],
    ['never invent, pad, correct, reformat', 'phone digits are exact'],
    ['credit card numbers', 'sensitive-data decline (cards)'],
    ['passwords', 'sensitive-data decline (passwords)'],
    ['stay in english', 'language default stability'],
    ['until the caller clearly switches again', 'language switch hysteresis'],
  ];
  for (const [needle, label] of fragments) {
    assert(rules.includes(needle), `GLOBAL_RULES must contain "${needle}" (${label})`);
  }
});

// ── nowInTimeZone — current business-local time for the prompt ─────────────────

test('nowInTimeZone — America/Vancouver returns a readable stamp', () => {
  const s = nowInTimeZone('America/Vancouver');
  assert(s.length > 0, 'non-empty');
  assert(/\b\d{4}\b/.test(s), `has a 4-digit year: ${s}`);
  assert(/\b\d{1,2}:\d{2}\s?[AP]M\b/i.test(s), `has a clock time with AM/PM: ${s}`);
  assert(/\bat\b/.test(s), `has date/time "at" separator: ${s}`);
});

test('nowInTimeZone — invalid timezone falls back without throwing', () => {
  let s = '';
  // Should not throw — falls back to the default business timezone.
  s = nowInTimeZone('Not/AZone');
  assert(s.length > 0, 'fallback non-empty');
  assert(/\b\d{1,2}:\d{2}\s?[AP]M\b/i.test(s), `fallback has a clock time: ${s}`);
  // Empty / null input also falls back.
  assert(nowInTimeZone('').length > 0, 'empty tz falls back');
  assert(nowInTimeZone(null).length > 0, 'null tz falls back');
});

// ── Call Delivery — gating + message composition (pure) ───────────────────────
// decideDelivery encodes the product rules: a channel sends only when the owner enabled it AND a
// destination exists (explicit override, else the business's own phone/email). Composition is
// deterministic so the staff-facing text is locked.

const sampleCall: CallSummaryForDelivery = {
  businessName: 'Summit Auto Care',
  source: 'phone',
  callerName: 'Eric',
  callerPhone: '778-798-5201',
  intent: 'appointment_request',
  summary: 'Caller wants an oil change tomorrow afternoon.',
  nextAction: 'Confirm the appointment and call the customer back.',
  appointment: { date: '2026-06-16', time: '14:00', service: 'Oil change' },
  serviceRequest: null,
  dashboardUrl: 'https://example.com/dashboard/calls',
};

test('decideDelivery — disabled toggles → nothing sends', () => {
  const plan = decideDelivery({ phone: '111', email: 'a@b.com', agentConfig: {} });
  eq(plan.sms.send, false, 'sms off by default');
  eq(plan.email.send, false, 'email off by default');
});

test('decideDelivery — enabled + business fallback destinations', () => {
  const plan = decideDelivery({
    phone: '+16045551234',
    email: 'owner@biz.com',
    agentConfig: { notify_sms: true, notify_email: true },
  });
  eq(plan.sms.send, true, 'sms sends');
  eq(plan.sms.to, '+16045551234', 'falls back to business phone');
  eq(plan.email.send, true, 'email sends');
  eq(plan.email.to, 'owner@biz.com', 'falls back to business email');
});

test('decideDelivery — explicit override wins over business fallback', () => {
  const plan = decideDelivery({
    phone: '+1111',
    email: 'biz@x.com',
    agentConfig: {
      notify_sms: true,
      notify_email: true,
      notify_sms_to: '+1999',
      notify_email_to: 'alerts@x.com',
    },
  });
  eq(plan.sms.to, '+1999', 'sms override');
  eq(plan.email.to, 'alerts@x.com', 'email override');
});

test('decideDelivery — enabled but NO destination anywhere → does not send', () => {
  const plan = decideDelivery({ phone: null, email: '   ', agentConfig: { notify_sms: true, notify_email: true } });
  eq(plan.sms.send, false, 'no phone → no sms');
  eq(plan.email.send, false, 'blank email → no email');
});

test('composeCallSms — compact, includes caller + appointment, bounded length', () => {
  const sms = composeCallSms(sampleCall);
  assert(sms.includes('Eric'), 'has caller name');
  assert(sms.includes('778-798-5201'), 'has caller phone');
  assert(/oil change/i.test(sms), 'mentions the service');
  assert(sms.length <= 460, `within length cap: ${sms.length}`);
});

test('composeCallSms — falls back to summary when no structured request', () => {
  const sms = composeCallSms({ ...sampleCall, appointment: null, serviceRequest: null });
  assert(sms.includes('oil change') || sms.includes('Caller wants'), 'uses summary text');
});

test('composeCallEmail — subject + body carry the key facts and link', () => {
  const { subject, text, html } = composeCallEmail(sampleCall);
  assert(subject.includes('Summit Auto Care'), 'subject names business');
  assert(/appointment request/i.test(subject), 'subject has intent label');
  assert(text.includes('778-798-5201'), 'body has caller phone');
  assert(text.includes('Oil change'), 'body has service');
  assert(text.includes('https://example.com/dashboard/calls'), 'body has dashboard link');
  assert(html.includes('<a href="https://example.com/dashboard/calls"'), 'html links the dashboard');
});

test('composeCallEmail — service-request call renders the request block', () => {
  const { text } = composeCallEmail({
    ...sampleCall,
    intent: 'service_request',
    appointment: null,
    serviceRequest: { title: 'Brake noise', urgency: 'urgent' },
  });
  assert(text.includes('Brake noise'), 'has request title');
  assert(text.includes('[URGENT]'), 'flags urgency');
});

// ── After-hours digest — compose + CSV (pure) ─────────────────────────────────
// The daily digest is the MVP delivery default: one report per business, readable summary + CSV.

const digestCalls: DigestCall[] = [
  {
    callTimeIso: '2026-06-16T03:40:00Z',
    callerName: 'Sara Lee',
    callerPhone: '604-555-0101',
    intent: 'appointment_request',
    preferredDate: '2026-06-17',
    preferredTime: '10:00',
    summary: 'Wants a haircut tomorrow morning.',
    followUp: 'Call Sara to confirm 10am.',
  },
  {
    callTimeIso: '2026-06-16T05:12:00Z',
    callerName: null,
    callerPhone: '604-555-0199',
    intent: 'service_request',
    preferredDate: null,
    preferredTime: null,
    summary: 'Asking about a quote, mentioned "leak, kitchen".',
    followUp: null,
  },
];

test('composeDigestSms — one-line report alert with count', () => {
  eq(composeDigestSms(6), 'FrontDesk captured 6 after-hours calls. Report sent to your email.', 'plural');
  assert(composeDigestSms(1).includes('1 after-hours call.'), 'singular noun');
});

test('composeDigestEmail — subject + body carry totals, callers, and link', () => {
  const { subject, text, html } = composeDigestEmail(
    { name: 'Luxe Hair', timezone: 'America/Vancouver' },
    digestCalls,
    'https://example.com/dashboard/calls',
  );
  assert(subject.includes('2 calls'), `subject has count: ${subject}`);
  assert(text.includes('Sara Lee'), 'body has a caller name');
  assert(text.includes('604-555-0199'), 'body has a caller phone');
  assert(text.includes('https://example.com/dashboard/calls'), 'body links the dashboard');
  assert(/CSV/.test(text), 'body mentions the attached CSV');
  assert(html.includes('<table'), 'html renders a table');
});

test('buildCallsCsv — header + one row per call, fields escaped', () => {
  const csv = buildCallsCsv(digestCalls, 'America/Vancouver');
  const lines = csv.split('\r\n');
  eq(lines.length, 3, 'header + 2 rows');
  assert(lines[0].startsWith('Call time,Caller name,Caller phone'), 'has header');
  // The second call's summary contains a comma → must be quoted.
  assert(/"Asking about a quote, mentioned ""leak, kitchen""\."/.test(csv), 'quotes + escapes commas/quotes');
  assert(csv.includes('Appointment request'), 'maps intent label');
  assert(csv.includes('Sara Lee'), 'includes caller');
});

test('buildCallsCsv — empty caller fields render as empty cells, not "null"', () => {
  const csv = buildCallsCsv([digestCalls[1]], 'America/Vancouver');
  assert(!/null/.test(csv), 'no literal null');
});

// ── SMS phone normalization (Twilio requires E.164) ───────────────────────────

test('toE164 — bare 10-digit US/Canada number gets +1 (the SMS-test 400 fix)', () => {
  eq(toE164('7787985201'), '+17787985201', '10-digit → +1');
  eq(toE164('(778) 798-5201'), '+17787985201', 'strips punctuation/spaces');
});

test('toE164 — 11-digit leading-1 and already-E.164 pass through', () => {
  eq(toE164('17787985201'), '+17787985201', '1XXXXXXXXXX → +1…');
  eq(toE164('+17787985201'), '+17787985201', 'already E.164 unchanged');
  eq(toE164(' +1 778 798 5201 '), '+17787985201', 'trims + strips inner spaces');
});

test('toE164 — empty stays empty', () => {
  eq(toE164(''), '', 'empty in → empty out');
  eq(toE164('   '), '', 'whitespace-only → empty');
});

// ── Ops alerts (operator SMS: safe, best-effort, cooled down) ────────────────

test('buildOpsAlert — short safe SMS redacts obvious secrets and contact details', () => {
  const msg = buildOpsAlert({
    component: 'cron/digest',
    event: 'business_query_failed',
    error: 'bad provider credential [redacted-test-credential] and account [redacted-test-account-id]',
    context: {
      businessId: 'biz_123',
      email: 'owner@example.com',
      phone: '+1 (778) 798-5201',
    },
    at: new Date('2026-06-21T12:00:00.000Z'),
  });
  assert(msg.startsWith('FrontDesk ALERT | cron/digest | business_query_failed'), `prefix: ${msg}`);
  assert(msg.includes('2026-06-21T12:00:00.000Z'), 'timestamp included');
  assert(msg.includes('businessId=biz_123'), 'safe context included');
  assert(msg.includes('[redacted-test-credential]'), 'safe credential placeholder included');
  assert(msg.includes('[redacted-test-account-id]'), 'safe account placeholder included');
  assert(!/AC[a-fA-F0-9]{20,}/.test(msg), 'no Twilio Account SID-shaped value');
  assert(!/SK[a-fA-F0-9]{20,}/.test(msg), 'no Twilio API Key SID-shaped value');
  assert(!msg.includes('owner@example.com'), 'email redacted');
  assert(!msg.includes('7787985201'), 'phone redacted');
  assert(msg.length <= 300, 'bounded for SMS');
});

test('notifyOps — missing OPS_ALERT_SMS_TO no-ops without throwing', async () => {
  const before = process.env.OPS_ALERT_SMS_TO;
  delete process.env.OPS_ALERT_SMS_TO;
  const result = await notifyOps({
    component: 'qa',
    event: 'missing_destination',
    error: 'simulated',
    at: new Date('2026-06-21T12:00:00.000Z'),
  });
  if (before === undefined) delete process.env.OPS_ALERT_SMS_TO;
  else process.env.OPS_ALERT_SMS_TO = before;
  eq(result.sent, false, 'not sent');
  eq(result.skippedReason, 'missing_destination', 'safe no-op reason');
});

test('ops alert cooldown — repeated same event is suppressed', () => {
  const last = new Map<string, number>();
  const key = opsAlertKey({ component: 'twilio/post-call', event: 'call_save_failed' });
  assert(dueForAlert(key, 1_000, last), 'first alert is due');
  markAlertSent(key, 1_000, last);
  assert(!dueForAlert(key, 1_000 + OPS_ALERT_COOLDOWN_MS - 1, last), 'same event suppressed within cooldown');
  assert(dueForAlert(key, 1_000 + OPS_ALERT_COOLDOWN_MS, last), 'same event due after cooldown');
});

test('ops alert cooldown — different event keys alert independently', () => {
  const last = new Map<string, number>();
  const keyA = opsAlertKey({ component: 'twilio/post-call', event: 'call_save_failed' });
  const keyB = opsAlertKey({ component: 'cron/digest', event: 'business_query_failed' });
  markAlertSent(keyA, 1_000, last);
  assert(!dueForAlert(keyA, 2_000, last), 'same key suppressed');
  assert(dueForAlert(keyB, 2_000, last), 'different key still due');
});

// ── Call status mapping (no "Resolved" for actionable/incomplete calls) ───────

test('deriveCallStatus — actionable intent → pending, not resolved', () => {
  eq(deriveCallStatus('appointment_request', 0), 'pending', 'appointment → pending');
  eq(deriveCallStatus('service_request', 0), 'pending', 'service → pending');
  eq(deriveCallStatus('complaint', 0), 'pending', 'complaint → pending');
});

test('deriveCallStatus — actionable but missing required details → pending', () => {
  // The failing real call: appointment intent, name/party unclear → must NOT be Resolved.
  eq(deriveCallStatus('appointment_request', 2), 'pending', 'incomplete appointment → pending');
});

test('deriveCallStatus — answered question / nothing to do → resolved', () => {
  eq(deriveCallStatus('general_question', 0), 'resolved', 'plain question → resolved');
  eq(deriveCallStatus('other', 0), 'resolved', 'no actionable intent → resolved');
});

// ── Realtime session parity (browser ⇄ phone share ONE turn-taking config) ────

test('REALTIME_VAD — locked safety-critical turn-taking values', () => {
  eq(REALTIME_VAD.type, 'server_vad', 'server VAD');
  eq(REALTIME_VAD.threshold, 0.7, 'threshold');
  eq(REALTIME_VAD.prefix_padding_ms, 300, 'prefix padding');
  eq(REALTIME_VAD.silence_duration_ms, 1000, 'silence duration');
  eq(REALTIME_VAD.interrupt_response, false, 'no barge-in — assistant finishes its turn');
  eq(REALTIME_NOISE_REDUCTION.type, 'far_field', 'far-field noise reduction');
});

test('browser + phone both consume the shared turn-taking config (no drift)', () => {
  const voiceSession = readFileSync('src/app/api/voice-session/route.ts', 'utf8');
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(voiceSession.includes('REALTIME_VAD'), 'voice-session uses shared REALTIME_VAD');
  assert(bridge.includes('REALTIME_VAD'), 'phone bridge uses shared REALTIME_VAD');
  assert(bridge.includes('REALTIME_NOISE_REDUCTION'), 'phone bridge uses shared noise reduction');
});

test('phone greeting uses the session prompt (bare response.create), not a per-response override', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(bridge.includes("sendToOpenAI({ type: 'response.create' })"), 'bridge sends a bare response.create');
  assert(!bridge.includes('your GREETING from the instructions'), 'no per-response greeting override remains');
});

test('phone bridge no longer force-clears Twilio audio on caller speech (no barge-in truncation)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(!bridge.includes("sendToTwilio({ event: 'clear', streamSid })"), 'manual barge-in clear removed');
});

test('phone bridge /health shape is safe JSON', () => {
  const health = buildBridgeHealth(new Date('2026-06-21T12:00:00.000Z'));
  eq(health.status, 'ok', 'status');
  eq(health.timestamp, '2026-06-21T12:00:00.000Z', 'timestamp');
  assert(Number.isInteger(health.uptimeSec) && health.uptimeSec >= 0, 'uptimeSec integer');
  assert(Number.isInteger(health.activeStreams), 'activeStreams integer');
  assert(Number.isInteger(health.callsHandled), 'callsHandled integer');
  const json = JSON.stringify(health);
  for (const unsafe of ['OPENAI_API_KEY', 'TWILIO_AUTH_TOKEN', 'TWILIO_BRIDGE_SECRET', 'FD_APP_URL', 'TWILIO_STREAM_URL']) {
    assert(!json.includes(unsafe), `health must not expose ${unsafe}`);
  }
});

test('silent-failure routes wire best-effort ops alerts', () => {
  const postCall = readFileSync('src/app/api/twilio/post-call/route.ts', 'utf8');
  const digest = readFileSync('src/app/api/cron/digest/route.ts', 'utf8');
  for (const needle of ['call_save_failed', 'extraction_failed', 'transcript_rows_failed']) {
    assert(postCall.includes(needle), `post-call alerts ${needle}`);
  }
  for (const needle of ['business_query_failed', 'call_query_failed', 'email_send_failed', 'sms_send_failed', 'business_processing_failed']) {
    assert(digest.includes(needle), `digest alerts ${needle}`);
  }
});

// ── Phone post-call: OPENAI_API_KEY-missing extraction-skip path (pure) ───────
// When the app deployment has no OPENAI_API_KEY, the phone call is still SAVED but analysis is
// skipped. The response must say so explicitly, the operator gets a best-effort alert, and neither
// the response nor the alert may carry the caller transcript or personal details.

test('extractionSkippedResponse — explicit reason, saved, extraction did not run', () => {
  const r = extractionSkippedResponse('call_abc');
  eq(r.reason, 'extraction_skipped_no_api_key', 'reason code');
  eq(r.reason, EXTRACTION_SKIPPED_NO_API_KEY, 'reason uses the shared constant');
  eq(r.extractionRan, false, 'extraction did not run');
  eq(r.saved, true, 'call is still saved');
  eq(r.callId, 'call_abc', 'echoes the call id');
});

test('extractionSkippedOpsAlert — best-effort alert names the event and carries only ids', () => {
  const a = extractionSkippedOpsAlert('biz_1', 'call_abc');
  eq(a.component, 'twilio/post-call', 'component');
  eq(a.event, 'extraction_skipped_no_api_key', 'event name');
  eq(Object.keys(a.context).sort().join(','), 'businessId,callId', 'context has ONLY the two ids');
  eq(a.context.businessId, 'biz_1', 'businessId');
  eq(a.context.callId, 'call_abc', 'callId');
});

test('extraction-skip outcome leaks no caller transcript or personal details', () => {
  // Builders take only ids, so PII is impossible by construction — asserted here so it can't regress.
  const serialized = JSON.stringify({
    response: extractionSkippedResponse('call_xyz'),
    alert: extractionSkippedOpsAlert('biz_9', 'call_xyz'),
  });
  for (const pii of ['Caller:', 'Front desk:', 'transcript', '778-798-5201', 'Sarah', '@']) {
    assert(!serialized.includes(pii), `skip outcome must not include "${pii}"`);
  }
});

test('phone post-call wires the skip alert + explicit response from the shared helper', () => {
  const postCall = readFileSync('src/app/api/twilio/post-call/route.ts', 'utf8');
  assert(postCall.includes('extractionSkippedOpsAlert'), 'route sends the best-effort skip ops alert');
  assert(postCall.includes('extractionSkippedResponse'), 'route returns the explicit skip response');
});

// ── Past-time appointment guard (deterministic; flags, never silently books) ──

test('isPastAppointment — earlier-today time is flagged as past', () => {
  const now = new Date('2026-06-21T18:30:00-07:00'); // 6:30 PM in America/Vancouver (PDT)
  eq(isPastAppointment('2026-06-21', '17:00', 'America/Vancouver', now), true, '5pm today already passed');
  eq(isPastAppointment('2026-06-21', '9:00', 'America/Vancouver', now), true, 'unpadded morning time also past');
});

test('isPastAppointment — future time is not flagged', () => {
  const now = new Date('2026-06-21T18:30:00-07:00');
  eq(isPastAppointment('2026-06-21', '19:00', 'America/Vancouver', now), false, '7pm today is upcoming');
  eq(isPastAppointment('2026-06-22', '09:00', 'America/Vancouver', now), false, 'tomorrow is not past');
});

test('isPastAppointment — missing date or time is never flagged', () => {
  const now = new Date('2026-06-21T18:30:00-07:00');
  eq(isPastAppointment(null, '17:00', 'America/Vancouver', now), false, 'no date');
  eq(isPastAppointment('2026-06-21', null, 'America/Vancouver', now), false, 'no time');
});

// ── Results ──────────────────────────────────────────────────────────────────

await runTests();

const total = passed + failed;
console.log('\n────────────────────────────────────────────────────────────────');

if (failed === 0) {
  console.log(`\n✓  All ${total} tests passed.\n`);
} else {
  console.error(`\n✗  ${failed}/${total} tests failed:\n`);
  for (const f of failures) {
    console.error(`   • ${f}`);
  }
  console.error('');
  process.exit(1);
}

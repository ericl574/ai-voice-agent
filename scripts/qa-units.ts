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
import { deriveNeedsStaffFollowup } from '../src/lib/call-pipeline/followup.ts';
import { buildCallQualityMetric } from '../src/lib/call-pipeline/callQuality.ts';
import { routeIntent, SPECIALISTS, CALLER_INTENTS } from '../src/lib/agents/routing/intents.ts';
import { buildAnalystResult } from '../src/lib/call-pipeline/analyst.ts';
import { ROUTER_PLAYBOOK } from '../src/lib/agents/specialists/router.ts';
import { BOOKING_PLAYBOOK } from '../src/lib/agents/specialists/booking.ts';
import { FAQ_PLAYBOOK } from '../src/lib/agents/specialists/faq.ts';
import { ESCALATION_PLAYBOOK } from '../src/lib/agents/specialists/escalation.ts';
import { classifyCallHealth } from '../src/lib/call-pipeline/callHealth.ts';
import { isPastAppointment } from '../src/lib/call-pipeline/pastTime.ts';
import { REALTIME_VAD, REALTIME_NOISE_REDUCTION } from '../src/lib/realtime/turnDetection.ts';
import { classifyConnectionState } from '../src/lib/realtime/connectionState.ts';
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
  shouldAdvanceCoverage,
  type DigestCall,
  type DigestChannelStatus,
} from '../src/lib/notify/digest.ts';
import { toE164 } from '../src/lib/notify/sms.ts';
import { canonicalPhone, matchBusinessIdByNumber } from '../src/lib/twilio/numberRouting.ts';
import { buildPilotLead } from '../src/lib/leads/pilotLead.ts';
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
import {
  buildBridgeHealth,
  MAX_CALL_DURATION_MS,
  IDLE_TIMEOUT_MS,
  END_CUE_DRAIN_MS,
  OPENAI_RECONNECT_MAX_MS,
  decideOpenAIDropAction,
} from '../server/twilio-bridge.ts';

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
    // Behavior-upgrade contract — the load-bearing decision framework + non-negotiables.
    ['how to handle every call', 'front-loaded decision contract'],
    ['non-negotiables', 'non-negotiables block'],
    ['pass this to the team', 'capture as request, never false-confirm'],
    ['unanswered question is a follow-up', 'unknown question becomes staff follow-up'],
  ];
  for (const [needle, label] of fragments) {
    assert(rules.includes(needle), `GLOBAL_RULES must contain "${needle}" (${label})`);
  }
});

test('GLOBAL_RULES — stays vertical-neutral (industry words live only in vertical profiles)', () => {
  const rules = GLOBAL_RULES.toLowerCase();
  for (const word of ['party size', 'takeout', 'vehicle', 'oil change', 'haircut', 'stylist', 'prescription', 'tutor']) {
    assert(!rules.includes(word), `core rules must stay vertical-neutral — found "${word}"`);
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

// ── shouldAdvanceCoverage — never mark calls "covered" on a failed send (retry next run) ───────
// The digest's high-water mark (covered_through) must only advance when the report was actually
// delivered. A transient provider failure must leave the mark unchanged so the SAME calls are
// retried on the next cron tick — otherwise a failed email silently drops that day's report forever.
// Email is the PRIMARY deliverable; SMS is an optional alert. 'skipped' (no-domain mode) and
// 'disabled' are intentional non-error states and still advance (never an unbounded backlog).

test('shouldAdvanceCoverage — a FAILED email (primary channel) never advances → retried next run', () => {
  const cases: DigestChannelStatus[] = ['sent', 'failed', 'skipped', 'disabled'];
  for (const sms of cases) {
    eq(shouldAdvanceCoverage('failed', sms), false, `email failed + sms=${sms} must not advance`);
  }
});

test('shouldAdvanceCoverage — SMS-only setup: a failed SMS does not advance (retries)', () => {
  // Email not the deliverable this run (disabled or no-domain skip), SMS was the channel and failed.
  eq(shouldAdvanceCoverage('disabled', 'failed'), false, 'sms-only + sms failed → retry');
  eq(shouldAdvanceCoverage('skipped', 'failed'), false, 'email skipped + sms failed → retry');
});

test('shouldAdvanceCoverage — a failed OPTIONAL sms does not block a delivered email', () => {
  // Email is primary; if it sent, one failed optional SMS must NOT cause a duplicate email next run.
  eq(shouldAdvanceCoverage('sent', 'failed'), true, 'email sent, optional sms failed → advance');
});

test('shouldAdvanceCoverage — successful / intentional non-error states advance', () => {
  eq(shouldAdvanceCoverage('sent', 'sent'), true, 'both sent');
  eq(shouldAdvanceCoverage('sent', 'disabled'), true, 'email sent, sms off');
  eq(shouldAdvanceCoverage('skipped', 'disabled'), true, 'no-domain skip advances (no backlog)');
  eq(shouldAdvanceCoverage('disabled', 'disabled'), true, 'nothing enabled → nothing to retry');
  eq(shouldAdvanceCoverage('disabled', 'sent'), true, 'sms-only delivered');
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

// ── Multi-business Twilio routing — resolve the business from the dialed number ────────────────
// A real inbound call must map to the correct business by the number it was dialed on (params.To),
// so ONE deployment can serve many pilots instead of a single env-pinned TWILIO_BUSINESS_ID. The
// matcher is NANP-aware so a stored '(604) 555-0100' matches Twilio's E.164 '+16045550100'.

test('canonicalPhone — NANP forms all reduce to the same 10 digits', () => {
  eq(canonicalPhone('+16045550100'), '6045550100', 'E.164');
  eq(canonicalPhone('16045550100'), '6045550100', '11-digit leading 1');
  eq(canonicalPhone('(604) 555-0100'), '6045550100', 'formatted');
  eq(canonicalPhone('604.555.0100'), '6045550100', 'dotted');
  eq(canonicalPhone(' 604 555 0100 '), '6045550100', 'spaced/trimmed');
});

test('canonicalPhone — empty / null / no-digit input → empty string', () => {
  eq(canonicalPhone(''), '', 'empty');
  eq(canonicalPhone('   '), '', 'whitespace');
  eq(canonicalPhone(null), '', 'null');
  eq(canonicalPhone(undefined), '', 'undefined');
  eq(canonicalPhone('abc'), '', 'letters only');
});

test('canonicalPhone — non-NANP international digits are preserved (no leading-1 strip)', () => {
  eq(canonicalPhone('+44 7911 123456'), '447911123456', 'UK number kept whole');
});

const numberRows = [
  { id: 'biz_a', twilio_number: '+16045550100' },
  { id: 'biz_b', twilio_number: '(778) 555-0200' },
  { id: 'biz_c', twilio_number: null },
];

test('matchBusinessIdByNumber — resolves the owning business across formats', () => {
  eq(matchBusinessIdByNumber(numberRows, '+16045550100'), 'biz_a', 'E.164 dialed → biz_a');
  eq(matchBusinessIdByNumber(numberRows, '+17785550200'), 'biz_b', 'matches formatted stored number');
});

test('matchBusinessIdByNumber — unknown / blank number resolves to null (no accidental match)', () => {
  eq(matchBusinessIdByNumber(numberRows, '+15559999999'), null, 'unmapped number');
  eq(matchBusinessIdByNumber(numberRows, ''), null, 'blank dialed number');
  eq(matchBusinessIdByNumber(numberRows, null), null, 'null dialed number');
  // A row with a null/blank stored number must never be matched by a blank dialed number.
  eq(matchBusinessIdByNumber([{ id: 'biz_c', twilio_number: null }], ''), null, 'blank never matches null row');
});

test('twilio/voice resolves the business from the dialed number, with an env fallback', () => {
  const route = readFileSync('src/app/api/twilio/voice/route.ts', 'utf8');
  assert(route.includes('matchBusinessIdByNumber'), 'route resolves business by dialed number');
  assert(route.includes('resolveBusinessId'), 'route uses the number → business resolver');
  assert(route.includes('TWILIO_BUSINESS_ID'), 'legacy single-tenant env kept as dev/back-compat fallback');
  // The businessId must come from the resolver, not straight from the env var anymore.
  assert(route.includes('await resolveBusinessId(to)'), 'businessId is resolved from params.To');
});

// ── buildPilotLead — normalize + validate a pilot request into a durable lead row ─────────────
// Every pilot request must be storable in Supabase (source of truth) so a lead is never lost to an
// unconfigured/failed email. This pure builder normalizes + validates; the route stores + emails.

const validLeadBody = {
  businessName: '  Sunrise Auto  ',
  contactName: '  Jamie Lee ',
  email: ' jamie@sunriseauto.com ',
  phone: '(604) 555-0100',
  businessType: 'auto_repair',
  city: ' Vancouver ',
  message: '  Miss a lot of after-hours calls.  ',
};

test('buildPilotLead — valid body → trimmed, typed lead with default source', () => {
  const r = buildPilotLead(validLeadBody);
  assert(r.ok, 'valid body accepted');
  if (!r.ok) return;
  eq(r.lead.business_name, 'Sunrise Auto', 'business name trimmed');
  eq(r.lead.contact_name, 'Jamie Lee', 'contact name trimmed');
  eq(r.lead.email, 'jamie@sunriseauto.com', 'email trimmed');
  eq(r.lead.phone, '(604) 555-0100', 'phone kept as given');
  eq(r.lead.business_type, 'auto_repair', 'business type');
  eq(r.lead.city, 'Vancouver', 'city trimmed');
  eq(r.lead.message, 'Miss a lot of after-hours calls.', 'message trimmed');
  eq(r.lead.source, 'contact_form', 'default source');
});

test('buildPilotLead — minimal body → optional fields null, business_type defaults to other', () => {
  const r = buildPilotLead({ businessName: 'Acme', contactName: 'Pat', email: 'pat@acme.com' });
  assert(r.ok, 'minimal accepted');
  if (!r.ok) return;
  eq(r.lead.phone, null, 'no phone → null');
  eq(r.lead.city, null, 'no city → null');
  eq(r.lead.message, null, 'no message → null');
  eq(r.lead.business_type, 'other', 'business type default');
});

test('buildPilotLead — missing required fields / bad email → error (never a partial lead)', () => {
  eq(buildPilotLead({ contactName: 'Pat', email: 'pat@acme.com' }).ok, false, 'missing business name');
  eq(buildPilotLead({ businessName: 'Acme', email: 'pat@acme.com' }).ok, false, 'missing contact name');
  eq(buildPilotLead({ businessName: 'Acme', contactName: 'Pat', email: 'not-an-email' }).ok, false, 'bad email');
  eq(buildPilotLead({ businessName: 'Acme', contactName: 'Pat', email: '' }).ok, false, 'empty email');
});

test('buildPilotLead — over-long fields are length-capped', () => {
  const r = buildPilotLead({
    businessName: 'B'.repeat(500),
    contactName: 'Pat',
    email: 'pat@acme.com',
    message: 'm'.repeat(5000),
  });
  assert(r.ok, 'accepted');
  if (!r.ok) return;
  assert(r.lead.business_name.length <= 120, `business name capped: ${r.lead.business_name.length}`);
  assert((r.lead.message ?? '').length <= 2000, `message capped: ${(r.lead.message ?? '').length}`);
});

test('buildPilotLead — source can be overridden', () => {
  const r = buildPilotLead({ businessName: 'Acme', contactName: 'Pat', email: 'pat@acme.com' }, { source: 'api' });
  assert(r.ok && r.lead.source === 'api', 'custom source applied');
});

test('pilot-request route stores the lead durably (Supabase) before/besides emailing', () => {
  const route = readFileSync('src/app/api/pilot-request/route.ts', 'utf8');
  assert(route.includes('buildPilotLead'), 'route builds a normalized lead');
  assert(route.includes("from('pilot_requests').insert"), 'route inserts the lead into pilot_requests');
  assert(route.includes('createAdminClient'), 'route uses the service-role client for storage');
  assert(route.includes('lead_store_failed') || route.includes('lead_store_unconfigured'), 'route alerts if storage fails');
});

test('getActiveBusiness scopes business_members by the signed-in user (tenant isolation, not RLS-only)', () => {
  // Defense-in-depth: the active-business lookup must filter memberships by the authenticated user id,
  // so a missing/wrong business_members RLS policy can never resolve a user to another business.
  const src = readFileSync('src/lib/supabase/businesses.ts', 'utf8');
  assert(src.includes('auth.getUser()'), 'resolves the signed-in user');
  assert(/\.eq\('user_id',\s*userId\)/.test(src), "filters business_members by .eq('user_id', userId)");
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

// ── Staff follow-up flag (unanswered questions must reach staff) ───────────────

test('deriveNeedsStaffFollowup — actionable intents always need follow-up', () => {
  for (const intent of ['appointment_request', 'service_request', 'quote_request', 'complaint']) {
    eq(deriveNeedsStaffFollowup(intent, false), true, `${intent} → follow-up`);
  }
});

test('deriveNeedsStaffFollowup — answered question / empty call → no follow-up', () => {
  eq(deriveNeedsStaffFollowup('general_question', false), false, 'answered question');
  eq(deriveNeedsStaffFollowup('other', false), false, 'no-content call');
});

test('deriveNeedsStaffFollowup — an UNANSWERED question is flagged for staff', () => {
  // The gap this closes: a question the front desk could not answer must still reach staff.
  eq(deriveNeedsStaffFollowup('general_question', true), true, 'unresolved question → follow-up');
  eq(deriveNeedsStaffFollowup('other', true), true, 'unresolved "other" → follow-up');
});

// ── Behavior-eval dataset integrity (lightweight — NOT a live-model runner) ────
// Guards the static eval dataset so it can't drift into bad future signals: it parses, the declared
// count matches, every case is well-formed, ids are unique, and every expected_intent is in the
// documented taxonomy (canonical app intents ∪ legacy eval labels). New cases should use canonical
// app intents (meta.intent_taxonomy.canonical) — see docs/agent-behavior.md.

test('eval dataset — parses, count matches, cases well-formed, intents in documented taxonomy', () => {
  const data = JSON.parse(
    readFileSync('tests/voice-agent-evals/frontdesk-ai-eval-cases.json', 'utf8'),
  ) as {
    meta: { total_cases: number; intent_taxonomy: { canonical: string[]; legacy: string[] } };
    cases: Array<Record<string, unknown>>;
  };

  eq(data.meta.total_cases, data.cases.length, 'meta.total_cases matches actual case count');

  const allowedIntents = new Set([
    ...data.meta.intent_taxonomy.canonical,
    ...data.meta.intent_taxonomy.legacy,
  ]);
  const stringFields = [
    'id', 'business_type', 'category', 'scenario',
    'customer_utterance', 'expected_behavior', 'expected_intent', 'severity_if_failed',
  ];
  const ids = new Set<string>();

  for (const c of data.cases) {
    const id = String(c.id);
    for (const f of stringFields) {
      assert(typeof c[f] === 'string' && (c[f] as string).length > 0, `case ${id}: "${f}" must be a non-empty string`);
    }
    assert(Array.isArray(c.must_include), `case ${id}: must_include must be an array`);
    assert(Array.isArray(c.must_not_include), `case ${id}: must_not_include must be an array`);
    assert(typeof c.expected_followup_required === 'boolean', `case ${id}: expected_followup_required must be boolean`);
    assert(
      c.expected_structured_fields != null &&
        typeof c.expected_structured_fields === 'object' &&
        !Array.isArray(c.expected_structured_fields),
      `case ${id}: expected_structured_fields must be an object`,
    );
    assert(allowedIntents.has(c.expected_intent as string), `case ${id}: expected_intent "${String(c.expected_intent)}" not in documented taxonomy`);
    assert(!ids.has(id), `case ${id}: duplicate id`);
    ids.add(id);
  }
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

// ── classifyConnectionState — survive a transient WebRTC blip instead of tearing down ─────────
// WebRTC 'disconnected' is often momentary and self-heals back to 'connected'; only 'failed'/'closed'
// are terminal. The browser call must WAIT out a 'disconnected' (grace period) rather than ending
// the call the instant the state flips — a brief network hiccup should not drop a live call.

test('classifyConnectionState — transient disconnect waits for recovery', () => {
  eq(classifyConnectionState('disconnected'), 'recover-wait', 'disconnected → wait, not end');
});

test('classifyConnectionState — failed/closed are terminal (end the call)', () => {
  eq(classifyConnectionState('failed'), 'fatal', 'failed → end');
  eq(classifyConnectionState('closed'), 'fatal', 'closed → end');
});

test('classifyConnectionState — healthy/normal states are ignored', () => {
  for (const s of ['new', 'connecting', 'connected']) {
    eq(classifyConnectionState(s), 'ignore', `${s} → ignore`);
  }
});

test('voice page waits out a transient disconnect (does not instantly tear down)', () => {
  const page = readFileSync('src/app/dashboard/voice/page.tsx', 'utf8');
  assert(page.includes('classifyConnectionState'), 'page uses the shared disposition rule');
  assert(page.includes('reconnectGraceTimerRef'), 'page arms a grace timer on a transient disconnect');
  assert(page.includes('recovered from transient disconnect'), 'page cancels teardown when it recovers');
  // The old code ended on any of failed/disconnected/closed in one branch — that must be gone.
  assert(
    !page.includes("s === 'failed' || s === 'disconnected' || s === 'closed'"),
    'no longer ends instantly on a bare disconnected',
  );
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

test('digest cron only advances the coverage mark on delivery (failed send retries next run)', () => {
  const digest = readFileSync('src/app/api/cron/digest/route.ts', 'utf8');
  assert(digest.includes('shouldAdvanceCoverage'), 'digest route gates the record on shouldAdvanceCoverage');
  assert(digest.includes('digest_delivery_failed'), 'digest route alerts on a non-delivered digest');
  // The gate must run BEFORE the call_digests upsert, so a failed send never writes the record.
  const gateAt = digest.indexOf('shouldAdvanceCoverage(emailStatus, smsStatus)');
  const upsertAt = digest.indexOf("from('call_digests').upsert");
  assert(gateAt > 0 && upsertAt > 0 && gateAt < upsertAt, 'delivery gate precedes the digest record write');
});

test('digest cron does NOT gate delivery on a per-business send hour (single daily Hobby tick must deliver)', () => {
  // Regression guard: the old `if (hour < sendHour) return 'skipped'` gate made Pacific/Mountain/Alaska/
  // Hawaii businesses (incl. the America/Vancouver default) NEVER receive a report under Vercel Hobby's
  // one-tick-per-day cron. With a single daily tick that gate must stay removed.
  const digest = readFileSync('src/app/api/cron/digest/route.ts', 'utf8');
  assert(!/hour\s*<\s*sendHour/.test(digest), 'send-hour gate must be removed (one daily tick cannot honor per-business hours)');
  // Delivery is still deduped to at most one digest per business per LOCAL day via the call_digests read.
  assert(digest.includes("eq('digest_date', date)"), 'once-per-local-day idempotency guard remains');
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

// ── Phone bridge safety caps + clean shutdown (controlled real-call readiness) ─
// The phone path uses the server's auto-response (no Layer 2), so these safety caps live in the
// bridge itself: a hard max duration (cost backstop), a conservative idle timeout, and a
// deterministic goodbye/end-cue shutdown — all funnelling through the single idempotent finish().
// Source-grepped because the bridge's socket/timer wiring has no unit-test seam (no socket mock
// harness in the repo); the numeric sanity is also asserted via the exported constants below.

test('bridge defines a hard max call duration cap (cost backstop, matches browser 10 min)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(/MAX_CALL_DURATION_MS\s*=\s*10\s*\*\s*60_000/.test(bridge), 'MAX_CALL_DURATION_MS = 10 * 60_000');
  assert(bridge.includes('maxDurationTimer'), 'arms a max-duration timer');
  assert(bridge.includes("finish('max-duration')"), 'finalizes with the max-duration reason');
});

test('bridge defines a conservative idle timeout (not aggressive — avoids cutting normal pauses)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  const m = bridge.match(/IDLE_TIMEOUT_MS\s*=\s*([0-9_]+)/);
  assert(!!m, 'IDLE_TIMEOUT_MS is defined');
  const ms = Number(m![1].replace(/_/g, ''));
  assert(ms >= 20_000 && ms <= 60_000, `idle timeout conservative (20–60s), got ${ms}`);
  assert(bridge.includes('idleTimer'), 'arms an idle timer');
  assert(bridge.includes("finish('idle-timeout')"), 'finalizes with the idle-timeout reason');
  assert(bridge.includes('resetIdle'), 'resets idle on meaningful caller/assistant activity');
});

test('bridge reuses the shared looksLikeEndCall helper for a deterministic goodbye shutdown', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(
    /import\s*\{\s*looksLikeEndCall\s*\}\s*from\s*'\.\.\/src\/lib\/call-pipeline\/endCall\.ts'/.test(bridge),
    'imports looksLikeEndCall from the shared, pure helper',
  );
  assert(bridge.includes('looksLikeEndCall('), 'calls looksLikeEndCall on a captured turn');
  assert(bridge.includes("finish('end-cue')"), 'finalizes with the end-cue reason after a goodbye');
  const m = bridge.match(/END_CUE_DRAIN_MS\s*=\s*([0-9_]+)/);
  assert(!!m, 'END_CUE_DRAIN_MS drain window is defined');
  const ms = Number(m![1].replace(/_/g, ''));
  assert(ms >= 2_000 && ms <= 8_000, `end-cue drain short (2–8s), got ${ms}`);
});

test('bridge finalization is idempotent and clears every timer (exactly one post-call)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(bridge.includes('if (closed) return'), 'finish() short-circuits once closed (single post-call)');
  assert(bridge.includes('clearAllTimers'), 'clears all timers on finalize so a closed call arms nothing');
});

test('bridge tags every call with a trace id and loudly warns when business identity is missing', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(bridge.includes('traceId'), 'per-call trace id for correlatable logs');
  // A session-config failure drops business identity/KB (generic fallback prompt) — must be loud.
  assert(/FALLBACK INSTRUCTIONS/i.test(bridge), 'loud warning when the call falls back to generic instructions');
});

test('bridge safety caps are sane and correctly ordered (max > idle > end-cue drain)', () => {
  eq(MAX_CALL_DURATION_MS, 600_000, 'max duration is 10 minutes');
  assert(IDLE_TIMEOUT_MS >= 20_000 && IDLE_TIMEOUT_MS <= 60_000, 'idle conservative (20–60s)');
  assert(END_CUE_DRAIN_MS >= 2_000 && END_CUE_DRAIN_MS <= 8_000, 'end-cue drain short (2–8s)');
  assert(
    MAX_CALL_DURATION_MS > IDLE_TIMEOUT_MS && IDLE_TIMEOUT_MS > END_CUE_DRAIN_MS,
    'ordered: max > idle > drain',
  );
});

// ── OpenAI drop handling — no dead air on a mid-call socket drop ───────────────────────────────
// Previously an OpenAI WS close mid-call left the caller in silence until the 30s idle timeout. Now
// the bridge tries ONE bounded reconnect (context is lost — graceful degrade), else ends promptly.

test('decideOpenAIDropAction — expected teardown during finish() is ignored', () => {
  eq(decideOpenAIDropAction({ closed: true, reconnectAttempted: false, haveConfig: true }), 'ignore', 'closed → ignore');
  eq(decideOpenAIDropAction({ closed: true, reconnectAttempted: true, haveConfig: false }), 'ignore', 'closed dominates');
});

test('decideOpenAIDropAction — first unexpected drop with a config → one reconnect', () => {
  eq(decideOpenAIDropAction({ closed: false, reconnectAttempted: false, haveConfig: true }), 'reconnect', 'first drop → reconnect');
});

test('decideOpenAIDropAction — already retried, or no config → end (never dead air, never a loop)', () => {
  eq(decideOpenAIDropAction({ closed: false, reconnectAttempted: true, haveConfig: true }), 'end', 'second drop → end');
  eq(decideOpenAIDropAction({ closed: false, reconnectAttempted: false, haveConfig: false }), 'end', 'no config → end');
});

test('OPENAI_RECONNECT_MAX_MS resolves well before the idle timeout would fire', () => {
  assert(OPENAI_RECONNECT_MAX_MS > 0 && OPENAI_RECONNECT_MAX_MS < IDLE_TIMEOUT_MS, 'reconnect window < idle timeout');
});

test('bridge wires OpenAI-drop handling (no silent dead-air regression)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  assert(bridge.includes('decideOpenAIDropAction'), 'bridge uses the tested drop decision');
  assert(bridge.includes('handleOpenAIDrop'), 'bridge routes OpenAI closes through the drop handler');
  assert(bridge.includes("finish('openai-reconnect-failed')") || bridge.includes("finish('openai-closed')"),
    'bridge ends promptly when reconnect is unavailable/fails');
});

// ── Per-call quality metric (observability + best-effort alert on a broken call) ──────────────
// Summarizes one call into machine-readable concerns and a should-page decision. Alerts only on
// SERIOUS signals (fallback prompt used, the assistant never spoke, or an abnormal/error end) — a
// bare 0-caller-turn call (hangup/wrong number) and a skipped extraction (its own alert) are noted
// but do NOT page. Pure so both the phone bridge and the app post-call route share one definition.

const cleanCall = {
  endReason: 'twilio stop',
  callerTurns: 4,
  assistantTurns: 5,
  usedFallbackInstructions: false,
  durationSec: 92,
  extraction: 'ran' as const,
};

test('buildCallQualityMetric — a clean call has no concerns and does not alert', () => {
  const m = buildCallQualityMetric(cleanCall);
  eq(m.concerns.length, 0, 'no concerns');
  eq(m.shouldAlert, false, 'no alert');
  eq(m.extraction, 'ran', 'extraction status carried');
});

test('buildCallQualityMetric — fallback instructions (business identity/KB not loaded) → alert', () => {
  const m = buildCallQualityMetric({ ...cleanCall, usedFallbackInstructions: true });
  assert(m.concerns.includes('fallback_instructions'), 'flags fallback');
  eq(m.shouldAlert, true, 'pages ops — the caller heard a generic front desk');
});

test('buildCallQualityMetric — assistant never spoke → alert', () => {
  const m = buildCallQualityMetric({ ...cleanCall, assistantTurns: 0 });
  assert(m.concerns.includes('no_assistant_turns'), 'flags silent assistant');
  eq(m.shouldAlert, true, 'pages ops');
});

test('buildCallQualityMetric — abnormal/error end reason → alert', () => {
  for (const reason of ['openai-closed', 'twilio ws error', 'realtime-error']) {
    const m = buildCallQualityMetric({ ...cleanCall, endReason: reason });
    assert(m.concerns.includes('abnormal_end'), `flags abnormal end: ${reason}`);
    eq(m.shouldAlert, true, `pages ops on ${reason}`);
  }
});

test('buildCallQualityMetric — a bare 0-caller-turn call is noted but NOT paged (hangup/wrong number)', () => {
  const m = buildCallQualityMetric({ ...cleanCall, callerTurns: 0, endReason: 'idle-timeout' });
  assert(m.concerns.includes('no_caller_turns'), 'notes no caller turns');
  eq(m.shouldAlert, false, 'does not page on a lone hangup signal');
});

test('buildCallQualityMetric — skipped extraction is noted but NOT paged (has its own alert)', () => {
  const m = buildCallQualityMetric({ ...cleanCall, extraction: 'skipped' });
  assert(m.concerns.includes('extraction_skipped'), 'notes skipped extraction');
  eq(m.shouldAlert, false, 'does not double-page for extraction');
});

test('buildCallQualityMetric — extraction defaults to unknown when unset', () => {
  const { extraction, ...noExtraction } = cleanCall;
  void extraction;
  eq(buildCallQualityMetric(noExtraction).extraction, 'unknown', 'defaults to unknown');
});

test('buildCallQualityMetric — an unreported/unknown end reason is NOT treated as abnormal (no false alert)', () => {
  // The app defaults endReason to 'unknown' when an older bridge does not report it — that absence
  // of signal must never look like an error end, or every such call would page ops.
  for (const reason of ['unknown', '']) {
    const m = buildCallQualityMetric({ ...cleanCall, endReason: reason });
    assert(!m.concerns.includes('abnormal_end'), `unknown end not abnormal: ${JSON.stringify(reason)}`);
    eq(m.shouldAlert, false, `no false alert for ${JSON.stringify(reason)}`);
  }
});

test('bridge + app both emit the per-call quality metric (observability cannot silently regress)', () => {
  const bridge = readFileSync('server/twilio-bridge.ts', 'utf8');
  const postCall = readFileSync('src/app/api/twilio/post-call/route.ts', 'utf8');
  assert(bridge.includes('buildCallQualityMetric'), 'bridge builds the metric');
  assert(bridge.includes('usedFallbackInstructions'), 'bridge reports fallback-instruction use to the app');
  assert(postCall.includes('buildCallQualityMetric'), 'post-call builds the metric');
  assert(postCall.includes('call_quality_alert'), 'post-call pages ops on a low-quality call');
});

// ── Specialist routing — caller intent → specialist (single source of truth) ──────────────────

test('routeIntent — booking family → booking; faq → faq; complaint/escalation → escalation; else router', () => {
  eq(routeIntent('booking'), 'booking', 'booking');
  eq(routeIntent('reschedule'), 'booking', 'reschedule');
  eq(routeIntent('cancel'), 'booking', 'cancel');
  eq(routeIntent('faq'), 'faq', 'faq');
  eq(routeIntent('complaint'), 'escalation', 'complaint');
  eq(routeIntent('escalation'), 'escalation', 'escalation');
  eq(routeIntent('general'), 'router', 'general');
  eq(routeIntent('unknown'), 'router', 'unknown');
});

test('routeIntent — invalid/empty input falls back to router (never throws, never a dead end)', () => {
  eq(routeIntent(''), 'router', 'empty');
  eq(routeIntent(null), 'router', 'null');
  eq(routeIntent('gibberish'), 'router', 'gibberish');
});

test('SPECIALISTS registry — every caller intent routes to a specialist that declares it', () => {
  for (const intent of CALLER_INTENTS) {
    const sid = routeIntent(intent);
    assert(SPECIALISTS[sid].handles.includes(intent), `${sid} must handle ${intent}`);
  }
  assert(SPECIALISTS.booking.serverFunctions.length > 0, 'booking triggers a server function');
  eq(SPECIALISTS.router.serverFunctions.length, 0, 'router calls no server function directly');
});

// ── Post-call Analyst — structured staff-facing analysis (pure) ────────────────────────────────

test('buildAnalystResult — complete booking → captured, staff action, high confidence, no risk flags', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Books an oil change tomorrow 9am.', intent: 'appointment_request', caller_name: 'Sara', caller_phone: '6045550101', appointment: { should_create: true, requested_date: '2026-07-10', requested_time: '09:00', service: 'Oil change', notes: null }, service_request: null, next_action: '' },
    assessment: { collected: ['name', 'date', 'time', 'service'], missingRequired: [], hasEnoughToAct: true },
  });
  eq(r.intent, 'booking', 'intent'); eq(r.booking_status, 'captured', 'captured');
  eq(r.staff_action_required, true, 'staff confirms'); eq(r.confidence, 'high', 'high');
  eq(r.requested_service, 'Oil change', 'service'); eq(r.risk_flags.length, 0, 'no flags');
});

test('buildAnalystResult — incomplete booking → incomplete + missing flags + low confidence', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Wants an appointment, no time given.', intent: 'appointment_request', caller_name: null, caller_phone: null, appointment: { should_create: true, requested_date: null, requested_time: null, service: 'Haircut', notes: null }, service_request: null, next_action: '' },
    assessment: { collected: ['service'], missingRequired: ['name', 'date', 'time'], hasEnoughToAct: false },
  });
  eq(r.booking_status, 'incomplete', 'incomplete');
  assert(r.risk_flags.includes('incomplete_booking'), 'incomplete flag');
  assert(r.risk_flags.includes('no_caller_name') && r.risk_flags.includes('no_callback_number'), 'missing name+phone');
  eq(r.confidence, 'low', 'low (>=2 missing)'); eq(r.staff_action_required, true, 'staff acts');
});

test('buildAnalystResult — answered FAQ → intent faq, no record, no staff action, high confidence', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Asked hours; answered from KB.', intent: 'general_question', caller_name: null, caller_phone: null, appointment: null, service_request: null, next_action: '', unresolved_question: false },
    assessment: { collected: [], missingRequired: [], hasEnoughToAct: true },
  });
  eq(r.intent, 'faq', 'faq'); eq(r.booking_status, 'none', 'none');
  eq(r.staff_action_required, false, 'no staff action'); eq(r.confidence, 'high', 'high');
});

test('buildAnalystResult — unanswered FAQ → unresolved flag + staff action', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Asked a policy not in KB.', intent: 'general_question', caller_name: null, caller_phone: null, appointment: null, service_request: null, next_action: '', unresolved_question: true },
    assessment: { collected: [], missingRequired: [], hasEnoughToAct: true },
  });
  assert(r.risk_flags.includes('unresolved_question'), 'unresolved flagged');
  eq(r.staff_action_required, true, 'staff acts');
});

test('buildAnalystResult — complaint → escalation intent, staff action, flag', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Upset about a previous visit.', intent: 'complaint', caller_name: 'Pat', caller_phone: '6045550111', appointment: null, service_request: null, next_action: '' },
    assessment: { collected: [], missingRequired: [], hasEnoughToAct: true },
  });
  eq(r.intent, 'escalation', 'escalation'); eq(r.staff_action_required, true, 'staff acts');
  assert(r.risk_flags.includes('complaint_or_escalation'), 'complaint flag');
});

test('buildAnalystResult — past time flagged + staff action', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'Wanted 8am today (already passed).', intent: 'appointment_request', caller_name: 'Lee', caller_phone: '6045550122', appointment: { should_create: true, requested_date: '2026-07-09', requested_time: '08:00', service: 'Trim', notes: null }, service_request: null, next_action: '' },
    assessment: { collected: ['name', 'date', 'time', 'service'], missingRequired: [], hasEnoughToAct: true },
    pastTime: true,
  });
  assert(r.risk_flags.includes('past_time'), 'past_time flagged'); eq(r.staff_action_required, true, 'staff acts');
});

test('buildAnalystResult — staff_summary is a capped summary, never the transcript', () => {
  const r = buildAnalystResult({
    extraction: { summary: 'x'.repeat(400), intent: 'other', caller_name: null, caller_phone: null, appointment: null, service_request: null, next_action: '' },
    assessment: { collected: [], missingRequired: [], hasEnoughToAct: true },
  });
  assert(r.staff_summary.length <= 240, `capped: ${r.staff_summary.length}`);
  assert(!r.staff_summary.includes('Front desk:') && !r.staff_summary.includes('Caller:'), 'not a transcript');
});

// ── Specialist playbooks — content + silent-routing contract ──────────────────────────────────

test('specialist playbooks — instruct SILENT routing (one smooth front desk, no announced hand-off)', () => {
  const router = ROUTER_PLAYBOOK.toLowerCase();
  assert(router.includes('silently') || router.includes('silent'), 'router routes silently');
  assert(router.includes('one front desk'), 'reinforces one-assistant experience');
  assert(router.includes('never announce') || router.includes('never say you are transferring'), 'no announced transfer');
  for (const [name, text] of Object.entries({ ROUTER_PLAYBOOK, BOOKING_PLAYBOOK, FAQ_PLAYBOOK, ESCALATION_PLAYBOOK })) {
    assert(text.length > 60, `${name} non-trivial`);
  }
});

test('booking playbook — collects required details, validates, never false-confirms', () => {
  const t = BOOKING_PLAYBOOK.toLowerCase();
  for (const needle of ['name', 'date and time', 'reschedule', 'cancellation', 'past']) {
    assert(t.includes(needle), `booking mentions "${needle}"`);
  }
  assert(t.includes('staff confirm') || /never say it is[\s\S]{0,30}booked/.test(t), 'never false-confirms');
});

test('faq playbook — answers only from KB, never invents, offers a note', () => {
  const t = FAQ_PLAYBOOK.toLowerCase();
  assert(t.includes('knowledge base'), 'references KB');
  assert(t.includes('do not invent'), 'no invention');
  assert(t.includes('note'), 'offers a note for staff');
});

test('escalation playbook — collects a staff message, promises follow-up, no fake resolution', () => {
  const t = ESCALATION_PLAYBOOK.toLowerCase();
  assert(t.includes('message for the team'), 'collects a concise staff message');
  assert(t.includes('follow up'), 'promises follow-up');
  assert(t.includes('do not promise') || t.includes('not claim to have fixed'), 'no fake resolution');
});

test('buildSystemPrompt wires the specialist playbooks into BOTH prompt branches', () => {
  const src = readFileSync('src/lib/agents/core/promptBuilder.ts', 'utf8');
  const idx = readFileSync('src/lib/agents/specialists/index.ts', 'utf8');
  eq((src.match(/renderSpecialistPlaybooks\(\)/g) || []).length, 2, 'rendered in both no-business + business branches');
  assert(idx.includes('SPECIALIST PLAYBOOKS') && idx.includes('SILENTLY'), 'composer emits the section + silent-routing rule');
});

// ── classifyCallHealth — operator failed/low-quality call visibility (pure) ────────────────────

test('classifyCallHealth — degraded capture/analysis summary → problem', () => {
  for (const s of ['Phone call recorded — analysis pending.', 'Call recorded — automatic analysis unavailable.', 'No caller speech was captured on this call.']) {
    const h = classifyCallHealth({ summary: s });
    eq(h.problem, true, `problem: ${s}`);
    assert(h.reasons.includes('capture_or_analysis_failed'), 'flags capture/analysis failure');
  }
});

test('classifyCallHealth — low confidence + risk flags from analysis → problem with reasons', () => {
  const h = classifyCallHealth({ summary: 'Wants a booking.', analysis: { confidence: 'low', risk_flags: ['past_time', 'incomplete_booking'], staff_action_required: true } });
  eq(h.problem, true, 'problem'); eq(h.needs_followup, true, 'needs followup');
  assert(h.reasons.includes('low_confidence'), 'low_confidence');
  assert(h.reasons.includes('risk:past_time') && h.reasons.includes('risk:incomplete_booking'), 'risk flags carried');
});

test('classifyCallHealth — clean captured booking → NOT a problem, but needs follow-up', () => {
  const h = classifyCallHealth({ summary: 'Booked an oil change tomorrow 9am.', needs_staff_followup: true, analysis: { confidence: 'high', risk_flags: [], staff_action_required: true } });
  eq(h.problem, false, 'not a failure'); eq(h.needs_followup, true, 'needs staff confirm');
});

test('classifyCallHealth — clean answered call → not a problem, no follow-up', () => {
  const h = classifyCallHealth({ summary: 'Answered hours from the KB.', needs_staff_followup: false });
  eq(h.problem, false, 'clean'); eq(h.needs_followup, false, 'no follow-up');
});

test('classifyCallHealth — works with no analysis column present (pre-migration)', () => {
  const h = classifyCallHealth({ summary: 'analysis pending', needs_staff_followup: false });
  eq(h.problem, true, 'still detects failure from summary'); eq(h.needs_followup, false, 'no followup');
});

test('ops/calls route — secret-guarded, service-role, read-only, uses classifyCallHealth', () => {
  const route = readFileSync('src/app/api/ops/calls/route.ts', 'utf8');
  assert(route.includes('CRON_SECRET') && route.includes('timingSafeEqual'), 'timing-safe secret guard');
  assert(route.includes('createAdminClient'), 'service-role read');
  assert(route.includes('classifyCallHealth'), 'uses the tested health classifier');
  assert(/export async function GET/.test(route) && !/export async function (POST|PUT|DELETE|PATCH)/.test(route), 'read-only (GET only)');
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

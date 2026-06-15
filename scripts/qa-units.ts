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
import { buildTranscript, countCallerTurns } from '../src/lib/call-pipeline/transcript.ts';
import { nowInTimeZone } from '../src/lib/call-pipeline/time.ts';

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

function test(name: string, fn: () => void): void {
  try {
    fn();
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

// ── Results ──────────────────────────────────────────────────────────────────

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

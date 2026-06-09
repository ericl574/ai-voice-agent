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
import { buildTranscript, countCallerTurns } from '../src/lib/call-pipeline/transcript.ts';
import { nowInTimeZone } from '../src/lib/call-pipeline/time.ts';

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

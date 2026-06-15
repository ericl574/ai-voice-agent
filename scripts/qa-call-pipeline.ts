// qa-call-pipeline.ts
// Deterministic call-pipeline QA tests.
// No browser, no microphone, no OpenAI Realtime, no Supabase writes.
// Run: node --experimental-strip-types scripts/qa-call-pipeline.ts

import {
  callerLinesOnly,
  hasAppointmentKeywords,
  hasServiceKeywords,
  applyKeywordFallbacks,
  assessCollection,
  looksLikePhone,
  type ExtractionResult,
} from '../src/lib/call-pipeline/extraction.ts';

import { roleLabel } from '../src/lib/call-pipeline/roles.ts';
import { buildTranscript, CALLER_LABEL, FRONT_DESK_LABEL } from '../src/lib/call-pipeline/transcript.ts';

// ── Minimal test runner ──────────────────────────────────────────────────────

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

// ── Pipeline helper ───────────────────────────────────────────────────────────
// Simulates the fallback path (no OpenAI available).
// This is the deterministic half of the pipeline that runs in production
// whenever OpenAI is unavailable OR as a safety net after AI extraction.

function runFallback(transcript: string): ExtractionResult {
  const callerText = callerLinesOnly(transcript);
  const base: ExtractionResult = {
    summary: 'Call recorded — automatic analysis unavailable.',
    intent: 'other',
    caller_name: null,
    caller_phone: null,
    appointment: null,
    service_request: null,
    next_action: 'Review call transcript manually.',
  };
  return applyKeywordFallbacks(base, callerText, 'fallback');
}

// ── Suite 1: Appointment classification ──────────────────────────────────────

console.log('\n── FrontDesk Call-Pipeline QA ──────────────────────────────────\n');
console.log('Suite 1: Appointment classification');

test('"I want to make an appointment tomorrow at 5 PM" → appointment_request, appointment.should_create=true, service_request=false', () => {
  const t = [
    'Front desk: Thank you for calling. How can I help?',
    'Caller: I want to make an appointment tomorrow at 5 PM.',
    'Front desk: I will pass that along to staff.',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'appointment_request', 'intent');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

test('"Can I come in tomorrow at 5?" → appointment_request even without explicit service type', () => {
  const t = [
    'Front desk: Thank you for calling.',
    'Caller: Can I come in tomorrow at 5?',
    'Front desk: Of course — what service were you looking for?',
    'Caller: Just a checkup.',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'appointment_request', 'intent');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

test('"I would like to book a time for next week" → appointment.should_create=true', () => {
  const t = [
    'Front desk: How can I help?',
    "Caller: I would like to book a time for next week.",
    'Front desk: Sure, let me take your details.',
  ].join('\n');
  const r = runFallback(t);
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
});

test('"I need to schedule something" (no time given) → appointment_request — time ref not required', () => {
  const t = [
    'Front desk: How can I help?',
    'Caller: I need to schedule something.',
    'Front desk: Of course.',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'appointment_request', 'intent — time reference must NOT be required');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
});

// ── Suite 2: Service request classification ───────────────────────────────────

console.log('\nSuite 2: Service request classification');

test('"I need help with a service issue. Can someone follow up?" → service_request=true, appointment=false', () => {
  const t = [
    'Front desk: Thank you for calling.',
    'Caller: I need help with a service issue. Can someone follow up?',
    'Front desk: I will have someone contact you.',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'service_request', 'intent');
  assert(r.service_request?.should_create === true, 'service_request.should_create must be true');
  assert(!r.appointment?.should_create, 'appointment.should_create must be false');
});

test('Appointment intent wins over service keyword ("schedule an appointment for a repair")', () => {
  const t = [
    'Front desk: What can I help with?',
    "Caller: I'd like to schedule an appointment for a repair.",
    'Front desk: Sure.',
  ].join('\n');
  const r = runFallback(t);
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!r.service_request?.should_create, 'service_request must not be created when appointment is created');
});

test('Keyword fallback corrects OpenAI service_request misclassification → appointment_request, service_request cleared', () => {
  // Simulates OpenAI returning service_request when caller actually asked for appointment.
  // This is the real-world failure mode: front-desk "service?" in transcript leaks into AI output.
  const base: ExtractionResult = {
    summary: 'Caller asked about services.',
    intent: 'service_request',
    caller_name: null,
    caller_phone: null,
    appointment: { should_create: false, requested_date: null, requested_time: null, service: null, notes: null },
    service_request: { should_create: true, title: 'Service inquiry', description: null, urgency: 'normal' },
    next_action: 'Contact caller.',
  };
  const callerText = 'I want to make an appointment tomorrow at 5 PM.';
  const result = applyKeywordFallbacks(base, callerText, 'openai');
  eq(result.intent, 'appointment_request', 'intent must be corrected from service_request to appointment_request');
  assert(result.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!result.service_request?.should_create, 'service_request.should_create must be cleared when appointment wins');
});

test('Appointment keyword win clears pre-existing service_request.should_create from AI, regardless of prior intent', () => {
  const base: ExtractionResult = {
    summary: 'Caller needed help.',
    intent: 'other',
    caller_name: null,
    caller_phone: null,
    appointment: null,
    service_request: { should_create: true, title: 'Help needed', description: null, urgency: null },
    next_action: 'Review.',
  };
  const callerText = 'Can I book a time for next week?';
  const result = applyKeywordFallbacks(base, callerText, 'openai');
  assert(result.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!result.service_request?.should_create, 'service_request.should_create must be cleared when appointment wins');
});

// ── Suite 3: General question — no records created ────────────────────────────

console.log('\nSuite 3: General question — no record creation');

test('"What time are you open?" → other/general_question, no appointment, no service_request', () => {
  const t = [
    'Front desk: Thank you for calling.',
    'Caller: What time are you open?',
    'Front desk: We are open Monday to Friday, 9 AM to 6 PM.',
  ].join('\n');
  const r = runFallback(t);
  assert(
    r.intent === 'other' || r.intent === 'general_question',
    `intent must be other or general_question, got: ${r.intent}`,
  );
  assert(!r.appointment?.should_create, 'appointment.should_create must be false');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

test('Front desk "service" keyword must not trigger service_request when caller says nothing actionable', () => {
  const t = [
    'Front desk: What service are you looking for today?',
    'Caller: Okay, I just wanted to check your hours. Thank you.',
    'Front desk: Sure, have a great day.',
  ].join('\n');
  const r = runFallback(t);
  assert(!r.appointment?.should_create, 'appointment.should_create must be false');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

// ── Suite 4: Role mapping ─────────────────────────────────────────────────────

console.log('\nSuite 4: Role mapping');

const ASSISTANT_ROLES = ['assistant', 'ai', 'agent', 'front_desk'];
const CALLER_ROLES    = ['caller', 'user', 'customer'];

for (const role of ASSISTANT_ROLES) {
  test(`roleLabel("${role}") → "Front desk"`, () => {
    eq(roleLabel(role), 'Front desk', `roleLabel("${role}")`);
  });
}

for (const role of CALLER_ROLES) {
  test(`roleLabel("${role}") → "Caller"`, () => {
    eq(roleLabel(role), 'Caller', `roleLabel("${role}")`);
  });
}

test('Assistant roles never resolve to "Caller" or "You"', () => {
  for (const role of ASSISTANT_ROLES) {
    const label = roleLabel(role);
    assert(label !== 'Caller', `"${role}" must not map to "Caller", got "${label}"`);
    assert(label !== 'You',    `"${role}" must not map to "You", got "${label}"`);
  }
});

// ── Suite 5: No invented name / phone ─────────────────────────────────────────

console.log('\nSuite 5: Null name/phone when caller does not provide them');

test('Caller who does not state name or phone → caller_name=null, caller_phone=null', () => {
  const t = [
    'Front desk: What is your name?',
    'Caller: I want to make an appointment for next week.',
    'Front desk: I will pass that along.',
  ].join('\n');
  const r = runFallback(t);
  assert(r.caller_name === null,  `caller_name must be null, got: ${JSON.stringify(r.caller_name)}`);
  assert(r.caller_phone === null, `caller_phone must be null, got: ${JSON.stringify(r.caller_phone)}`);
});

test('Fallback pipeline never invents caller_name or caller_phone', () => {
  const transcripts = [
    'Front desk: Hi.\nCaller: I need help.\nFront desk: Sure.',
    'Front desk: What is your name?\nCaller: Can I book an appointment?\nFront desk: Of course.',
  ];
  for (const t of transcripts) {
    const r = runFallback(t);
    assert(r.caller_name === null,  `caller_name must be null for: "${t}"`);
    assert(r.caller_phone === null, `caller_phone must be null for: "${t}"`);
  }
});

// ── Suite 6: callerLinesOnly isolation ───────────────────────────────────────

console.log('\nSuite 6: callerLinesOnly — keyword isolation');

test('callerLinesOnly excludes front desk lines', () => {
  const t = [
    'Front desk: My name is Alex, how can I help?',
    'Caller: I need some help please.',
    'Front desk: Of course.',
  ].join('\n');
  const callerText = callerLinesOnly(t);
  assert(!callerText.includes('Alex'), 'callerLinesOnly must not include front desk content');
  assert(callerText.includes('help'),  'callerLinesOnly must include caller content');
});

test('Front desk "service" keyword does not trigger hasServiceKeywords after callerLinesOnly', () => {
  const t = [
    'Front desk: What kind of service are you looking for?',
    'Caller: I just had a quick question about pricing.',
    'Front desk: Sure.',
  ].join('\n');
  const callerText = callerLinesOnly(t);
  assert(
    !hasServiceKeywords(callerText),
    `"service" in front desk line must not trigger hasServiceKeywords; callerText="${callerText}"`,
  );
});

test('"appointment" in caller line triggers hasAppointmentKeywords', () => {
  const callerText = callerLinesOnly('Front desk: Hi.\nCaller: I want to make an appointment.');
  assert(hasAppointmentKeywords(callerText), 'hasAppointmentKeywords must match "appointment"');
});

test('"appointment" only in front desk line does not trigger hasAppointmentKeywords', () => {
  const callerText = callerLinesOnly('Front desk: We handle appointment requests.\nCaller: Okay thanks.');
  assert(
    !hasAppointmentKeywords(callerText),
    'hasAppointmentKeywords must not match when "appointment" is only in front desk line',
  );
});

test('"come in" in caller line triggers hasAppointmentKeywords (no explicit "appointment" word needed)', () => {
  const callerText = callerLinesOnly('Front desk: Hi.\nCaller: Can I come in on Friday?');
  assert(hasAppointmentKeywords(callerText), 'hasAppointmentKeywords must match "come in"');
});

// ── Suite 7: Multilingual — Chinese and mixed-language transcripts ─────────────

console.log('\nSuite 7: Multilingual — Chinese and mixed-language');

test('"我想预约明天下午五点。" → appointment_request, appointment.should_create=true', () => {
  const t = [
    'Front desk: 您好，请问有什么可以帮您？',
    'Caller: 我想预约明天下午五点。',
    'Front desk: 好的，我会转告工作人员。',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'appointment_request', 'intent');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

test('"我想 book an appointment tomorrow at 5" (mixed) → appointment_request', () => {
  const t = [
    'Front desk: Hi, how can I help you today?',
    'Caller: 我想 book an appointment tomorrow at 5.',
    'Front desk: Of course, let me take your details.',
  ].join('\n');
  const r = runFallback(t);
  eq(r.intent, 'appointment_request', 'intent');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
});

test('"你们几点开门？" (Chinese general question) → no appointment, no service_request', () => {
  const t = [
    'Front desk: 您好，请问有什么可以帮您？',
    'Caller: 你们几点开门？',
    'Front desk: 我们工作日早上九点到晚上六点。',
  ].join('\n');
  const r = runFallback(t);
  assert(
    r.intent === 'other' || r.intent === 'general_question',
    `intent must be other or general_question, got: ${r.intent}`,
  );
  assert(!r.appointment?.should_create, 'appointment.should_create must be false');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

test('hasAppointmentKeywords matches 预约 (Chinese appointment word)', () => {
  assert(hasAppointmentKeywords('我想预约明天下午五点'), 'must match 预约');
  assert(hasAppointmentKeywords('我想预订一个位子'), 'must match 预订');
  assert(!hasAppointmentKeywords('你们几点开门'), 'must NOT match Chinese general question');
});

// ── Suite 8: Semantic extraction path — intent without explicit booking keywords ──────
//
// These tests simulate a correct model (gpt-4o-mini) extraction for utterances that have
// NO explicit booking keyword ("appointment", "book", "schedule", 预约, "come in", etc.).
// They verify that applyKeywordFallbacks (source='openai') PRESERVES correct semantic output
// without requiring keywords to be present.
//
// This is the critical contract: the keyword guardrail layer must not corrupt or downgrade
// a correct semantic extraction. The model is the primary intelligence; keywords are a fallback.

console.log('\nSuite 8: Semantic extraction path — non-keyword intent preservation');

function runSemanticPath(
  callerText: string,
  aiIntent: string,
  aiApptShouldCreate: boolean,
  aiSRShouldCreate: boolean = false,
): ExtractionResult {
  const base: ExtractionResult = {
    summary: 'AI semantic extraction result.',
    intent: aiIntent,
    caller_name: null,
    caller_phone: null,
    appointment: aiApptShouldCreate
      ? { should_create: true, requested_date: null, requested_time: null, service: null, notes: null }
      : null,
    service_request: aiSRShouldCreate
      ? { should_create: true, title: null, description: null, urgency: 'normal' }
      : null,
    next_action: 'Follow up with caller.',
  };
  return applyKeywordFallbacks(base, callerText, 'openai');
}

test('"Can I come by tomorrow around five?" — model detects implicit visit+time → appointment preserved', () => {
  // No explicit booking keyword needed — model identifies visit intent + time reference
  const r = runSemanticPath('Can I come by tomorrow around five?', 'appointment_request', true);
  eq(r.intent, 'appointment_request', 'intent must be preserved from model extraction');
  assert(r.appointment?.should_create === true, 'appointment.should_create must remain true');
  assert(!r.service_request?.should_create, 'service_request must not be created');
});

test('"Do you have time Friday afternoon?" — model detects implicit scheduling intent → appointment preserved', () => {
  // Purely semantic: time availability query to a service business = appointment intent
  const r = runSemanticPath('Do you have time Friday afternoon?', 'appointment_request', true);
  eq(r.intent, 'appointment_request', 'intent must be preserved from model extraction');
  assert(r.appointment?.should_create === true, 'appointment.should_create must remain true');
  assert(!r.service_request?.should_create, 'service_request must not be created');
});

test('"我明天下午能过去吗？" — model detects Chinese implicit visit intent → appointment preserved', () => {
  // No 预约/预订 keyword — model reads "can I go there tomorrow afternoon" as visit intent
  const r = runSemanticPath('我明天下午能过去吗？', 'appointment_request', true);
  eq(r.intent, 'appointment_request', 'intent must be preserved from model extraction');
  assert(r.appointment?.should_create === true, 'appointment.should_create must remain true');
  assert(!r.service_request?.should_create, 'service_request must not be created');
});

test('"明天五点可以吗？" — model detects Chinese time-availability query → appointment preserved', () => {
  const r = runSemanticPath('明天五点可以吗？', 'appointment_request', true);
  eq(r.intent, 'appointment_request', 'intent');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
});

test('Model appointment_request wins over service keywords present in caller text', () => {
  // "I need help — do you have time Friday?" has "help" (service keyword) but appointment intent.
  // Model correctly returns appointment_request; keyword guardrail must not override it with service_request.
  const r = runSemanticPath('I need help — do you have time Friday?', 'appointment_request', true);
  eq(r.intent, 'appointment_request', 'appointment intent from model must win over service keywords');
  assert(r.appointment?.should_create === true, 'appointment.should_create must be true');
  assert(!r.service_request?.should_create, 'service_request must not be created alongside appointment');
});

test('Pure service request (no visit intent) is preserved without upgrading to appointment', () => {
  // "Can someone call me back?" — model returns service_request. Guardrail must not add appointment.
  const r = runSemanticPath('Can someone call me back?', 'service_request', false, true);
  assert(!r.appointment?.should_create, 'appointment must not be created for callback-only request');
});

test('General question (no visit/service intent) — model result produces no records', () => {
  // "What time are you open?" — model returns general_question. Guardrail must not create records.
  const r = runSemanticPath('What time are you open?', 'general_question', false, false);
  assert(
    r.intent === 'general_question' || r.intent === 'other',
    `intent must stay general_question or other, got: ${r.intent}`,
  );
  assert(!r.appointment?.should_create, 'appointment.should_create must be false');
  assert(!r.service_request?.should_create, 'service_request.should_create must be false');
});

// ── Suite 9: looksLikePhone — phone-turn detection for display correction ─────
//
// looksLikePhone identifies the caller turn that is a phone number, so its lossy
// transcription can be replaced with the front-desk-confirmed number. It must match
// digit-dominant turns and reject time/date/word turns.

console.log('\nSuite 9: looksLikePhone — phone-turn detection');

test('phone numbers (various formats) → true', () => {
  assert(looksLikePhone('7070 798 5201'), 'spaced digits must match');
  assert(looksLikePhone('778-798-5201'), 'dashed phone must match');
  assert(looksLikePhone('(778) 798-5201'), 'parens/dashes phone must match');
  assert(looksLikePhone('7787985201'), 'bare 10-digit must match');
});

test('time/date/word turns → false', () => {
  assert(!looksLikePhone('8 PM'), '"8 PM" must NOT match');
  assert(!looksLikePhone('tomorrow at 5'), '"tomorrow at 5" must NOT match');
  assert(!looksLikePhone('My name is Eric'), 'name turn must NOT match');
  assert(!looksLikePhone('All good.'), 'plain sentence must NOT match');
  assert(!looksLikePhone(''), 'empty string must NOT match');
});

test('too-short / too-long digit runs → false', () => {
  assert(!looksLikePhone('12345'), '5 digits is below phone length');
  assert(!looksLikePhone('1234567890123456'), '16 digits is above phone length');
});

// ── Suite 10: role-label contract — buildTranscript() <-> callerLinesOnly() ──────
// These live in two files (transcript.ts owns the canonical labels; extraction.ts re-encodes the
// `Caller:` prefix as a literal because the Node QA runner can't import across files). This test
// locks the contract: if one side's label changes, this fails.
console.log('\nSuite 10: role-label contract (buildTranscript ↔ callerLinesOnly)');

test('canonical labels are the expected strings', () => {
  eq(FRONT_DESK_LABEL, 'Front desk:', 'front desk label');
  eq(CALLER_LABEL, 'Caller:', 'caller label');
});

test('callerLinesOnly isolates exactly the caller lines from buildTranscript output', () => {
  const transcript = buildTranscript([
    { role: 'assistant', text: 'Thanks for calling, how can I help?' },
    { role: 'user', text: "I'd like a table Friday" },
    { role: 'assistant', text: 'For how many?' },
    { role: 'user', text: 'Four' },
  ]);
  // buildTranscript must emit the labels callerLinesOnly looks for
  assert(transcript.includes(`${CALLER_LABEL} `), 'transcript has Caller label');
  assert(transcript.includes(`${FRONT_DESK_LABEL} `), 'transcript has Front desk label');
  eq(callerLinesOnly(transcript), "I'd like a table Friday Four", 'only caller lines, front-desk excluded');
});

// ── Suite 11: assessCollection — post-call completeness check (deterministic) ────
// requiredFields are injected (the vertical schema) so the helper stays self-contained. These tests
// mirror the vertical schemas without importing them — the unit boundary is the helper itself.
console.log('\nSuite 11: assessCollection — required-field completeness');

function extractionWith(over: Partial<ExtractionResult>): ExtractionResult {
  return {
    summary: '', intent: 'appointment_request',
    caller_name: null, caller_phone: null,
    appointment: null, service_request: null,
    next_action: '',
    ...over,
  };
}

test('appointment with name+date+time → nothing missing (restaurant-style)', () => {
  const a = assessCollection(
    extractionWith({
      caller_name: 'Eric',
      appointment: { should_create: true, requested_date: '2026-06-12', requested_time: '19:00', service: null, notes: null },
    }),
    ['name', 'date', 'time'],
  );
  eq(a.missingRequired.length, 0, 'no missing');
  eq(a.hasEnoughToAct, true, 'enough to act');
});

test('appointment missing time → time flagged, phone NOT flagged when not required', () => {
  const a = assessCollection(
    extractionWith({
      caller_name: 'Eric', caller_phone: null,
      appointment: { should_create: true, requested_date: '2026-06-12', requested_time: null, service: null, notes: null },
    }),
    ['name', 'date', 'time'],
  );
  eq(a.missingRequired.join(','), 'time', 'only time missing');
  eq(a.hasEnoughToAct, false, 'not enough');
});

test('service_request title satisfies the "service" requirement (auto/clinic-style)', () => {
  const a = assessCollection(
    extractionWith({
      intent: 'service_request', caller_name: 'Sam',
      service_request: { should_create: true, title: 'Brake repair', description: null, urgency: 'normal' },
    }),
    ['name', 'service'],
  );
  eq(a.missingRequired.length, 0, 'name+service present');
  eq(a.hasEnoughToAct, true, 'enough');
});

test('appointment.service also satisfies "service"; missing name flagged', () => {
  const a = assessCollection(
    extractionWith({
      caller_name: null,
      appointment: { should_create: true, requested_date: null, requested_time: null, service: 'Haircut', notes: null },
    }),
    ['name', 'service'],
  );
  eq(a.collected.join(','), 'service', 'service collected');
  eq(a.missingRequired.join(','), 'name', 'name missing');
});

test('empty requiredFields → always enough; duplicates de-duped', () => {
  eq(assessCollection(extractionWith({}), []).hasEnoughToAct, true, 'empty required');
  const a = assessCollection(extractionWith({ caller_name: 'A' }), ['name', 'name']);
  eq(a.collected.join(','), 'name', 'deduped collected');
  eq(a.missingRequired.length, 0, 'no missing');
});

// ── Results ───────────────────────────────────────────────────────────────────

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

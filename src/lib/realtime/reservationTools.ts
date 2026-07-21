// Shared Realtime function-tool schemas for the reservation flow — the SINGLE definition that BOTH
// the browser session (src/app/api/voice-session) and the phone bridge (server/twilio-bridge)
// register in their Realtime session, so the two transports expose an identical tool surface and
// cannot drift. Self-contained (NO imports) so the standalone bridge can load it by relative path,
// the same way it loads turnDetection.
//
// These are only the WIRE schemas the model calls. The behavior lives elsewhere:
//   • validation + readiness  → src/lib/call-pipeline/reservationDraft
//   • durable submit          → src/lib/call-pipeline/reservationPersist
//   • truthful wording        → the prompt (globalRules / promptBuilder) + the submit result contract
//
// Naming/semantics are the ones agreed with ChatGPT: draft-then-submit, never claim submission before
// a successful write, and NEVER say "confirmed" (staff confirm availability — there is no live
// availability source).

export const UPDATE_DRAFT_TOOL = 'update_reservation_draft';
export const SUBMIT_REQUEST_TOOL = 'submit_reservation_request';

export const RESERVATION_TOOLS = [
  {
    type: 'function',
    name: UPDATE_DRAFT_TOOL,
    description:
      'Record the reservation details you have understood from the caller so far. Call this whenever the ' +
      'caller gives OR corrects a detail, BEFORE moving on to the next one. The app validates each value and ' +
      'replies with which fields are still needed or unclear, so you can ask again in your own words. ' +
      'Recording details here does NOT book anything and tells the caller nothing.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Requested date as YYYY-MM-DD in the business timezone, if the caller gave one.' },
        time: { type: 'string', description: 'Requested time as 24-hour HH:MM, if the caller gave one.' },
        party_size: { type: 'integer', description: 'Number of people, if the caller gave one. Only record a clear number.' },
        name: { type: 'string', description: "The caller's name, if given." },
        phone: { type: 'string', description: 'A callback number, if given. Record exactly the digits the caller said.' },
        caller_confirmed: {
          type: 'boolean',
          description:
            'Set true ONLY after you have read the details back and the caller explicitly agreed. Any later ' +
            'change to a detail clears this automatically, so read back and re-confirm after a correction.',
        },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: SUBMIT_REQUEST_TOOL,
    description:
      'Submit the reservation REQUEST to the business. Call this ONLY after every required detail is valid AND ' +
      'the caller has confirmed a read-back. The app persists the request and returns whether it succeeded. Do ' +
      'NOT tell the caller it is submitted, captured, or held until this returns persisted:true. NEVER say the ' +
      'reservation is "confirmed" — staff confirm availability, not you — and never invent a callback timeframe.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const;

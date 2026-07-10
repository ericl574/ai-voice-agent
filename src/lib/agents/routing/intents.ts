// Shared caller-intent taxonomy + specialist routing map for the FrontDesk voice agent.
//
// This is the SINGLE source of truth for "which specialist handles which caller intent". It is pure
// data + pure functions (no imports) so it can be reused by the prompt composition
// (src/lib/agents/specialists), the post-call analyst (src/lib/call-pipeline/analyst.ts), and tests,
// and loaded by the deterministic QA runner.
//
// NOTE: this is caller BUSINESS intent (what the caller wants). It is deliberately DISTINCT from the
// turn-level `classifyCallerIntent` in src/lib/call-pipeline/intent.ts (backchannel vs substantive),
// which gates Layer-2 responses and is unrelated.

export type SpecialistId = 'router' | 'booking' | 'faq' | 'escalation';

export type CallerIntent =
  | 'booking' // new booking / appointment / reservation
  | 'reschedule'
  | 'cancel'
  | 'faq' // hours / location / services / pricing / policy / general business info
  | 'complaint'
  | 'escalation' // needs staff / emergency / sensitive / clearly outside policy / unclear
  | 'general' // greeting / small talk / simple thing the reception agent answers directly
  | 'unknown';

export const CALLER_INTENTS: readonly CallerIntent[] = [
  'booking',
  'reschedule',
  'cancel',
  'faq',
  'complaint',
  'escalation',
  'general',
  'unknown',
];

// Which specialist owns each intent. Everything the caller wants maps to exactly one specialist;
// anything unrouted stays with the reception/router agent (safe default — never a dead end).
export const INTENT_ROUTING: Record<CallerIntent, SpecialistId> = {
  booking: 'booking',
  reschedule: 'booking',
  cancel: 'booking',
  faq: 'faq',
  complaint: 'escalation',
  escalation: 'escalation',
  general: 'router',
  unknown: 'router',
};

// Resolve the specialist for an intent. Tolerant of unknown/invalid input → router (never throws).
export function routeIntent(intent: CallerIntent | string | null | undefined): SpecialistId {
  if (!intent) return 'router';
  return (INTENT_ROUTING as Record<string, SpecialistId>)[intent] ?? 'router';
}

export interface SpecialistMeta {
  id: SpecialistId;
  label: string;
  handles: CallerIntent[];
  // Server-side functions this specialist's CAPTURED outcome ultimately triggers. For the pilot these
  // run POST-CALL (the agent never fakes them in natural language) — see docs/agent-specialists.md.
  // This field documents the tool boundary; it is not called at runtime by this module.
  serverFunctions: string[];
}

export const SPECIALISTS: Record<SpecialistId, SpecialistMeta> = {
  router: {
    id: 'router',
    label: 'Reception / Router',
    handles: ['general', 'unknown'],
    serverFunctions: [],
  },
  booking: {
    id: 'booking',
    label: 'Booking / Reservation',
    handles: ['booking', 'reschedule', 'cancel'],
    // Appointment/service-request rows are created by runPostCallExtraction (postCallCore).
    serverFunctions: ['runPostCallExtraction:appointment'],
  },
  faq: {
    id: 'faq',
    label: 'Business Knowledge / FAQ',
    handles: ['faq'],
    // Answers come from the business profile + knowledge base injected into the prompt server-side.
    serverFunctions: ['knowledgeBase:profileContext'],
  },
  escalation: {
    id: 'escalation',
    label: 'Escalation / Human Follow-up',
    handles: ['complaint', 'escalation'],
    // A concise staff message + staff-action flag; a service_request row via runPostCallExtraction.
    serverFunctions: ['runPostCallExtraction:service_request', 'staffNote'],
  },
};

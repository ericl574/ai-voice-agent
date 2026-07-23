# FrontDesk — Specialist Voice-Agent Architecture

How the live phone agent is organized as a **router + specialists + post-call analyst**, while the
caller experiences **one smooth front desk**. This is the modular architecture; native OpenAI Agents
SDK handoffs are a documented later migration (see the last section).

> **UPDATE (2026-07-23): the specialist *prompt playbooks* were removed.** The live prompt was cut down
> to a short role + a handful of guardrails (see `docs/agent-behavior.md` and `promptBuilder.ts`). The
> model now classifies intent and adapts on its own, without an in-prompt router/booking/faq/escalation
> essay — the four `src/lib/agents/specialists/*` playbook modules and `renderSpecialistPlaybooks()` are
> **deleted**. **What remains** is the intent → specialist *registry* in
> `src/lib/agents/routing/intents.ts` (`routeIntent`, `SPECIALISTS`, `CALLER_INTENTS`), which is the
> **post-call analyst's** source of truth (dashboard analysis), **not** a prompt mechanism. Read the
> registry + analyst material below as current; treat the "specialist playbook" / prompt-composition
> parts as historical.

## Why modular (not native SDK handoffs, yet)

The live call is a **single OpenAI Realtime speech-to-speech session** (`gpt-realtime`) — raw Realtime
API, not the Agents SDK (the stack has no `@openai/agents` dependency; browser uses ephemeral
`client_secrets` + WebRTC, the phone bridge uses a raw `ws`). In one S2S session you cannot swap agents
mid-call without audible disruption. So "routing" happens **inside the one assembled prompt**: the model
silently classifies intent and follows the matching **specialist playbook**. This keeps the proven,
low-latency voice path intact and is the right shape for a first pilot. Native `RealtimeAgent` handoffs +
live tool-calling are the future upgrade, not required now.

## The specialists

| Specialist | When it's used (intents) | What it does | Server "tools" it drives | Module |
|---|---|---|---|---|
| **Reception / Router** | `general`, `unknown` (default; always first) | Greets, understands intent, answers simple things directly, silently switches into a specialist | — | `src/lib/agents/specialists/router.ts` |
| **Booking / Reservation** | `booking`, `reschedule`, `cancel` | Collects + validates name / service / date+time / phone / notes; rejects past/closed times; confirms details, never says "booked" | `runPostCallExtraction` → `appointments` row (post-call) | `specialists/booking.ts` |
| **Business Knowledge / FAQ** | `faq` | Answers hours/location/services/pricing/policy **only** from the injected profile + KB; offers a staff note when unknown | knowledge base (injected prompt context) | `specialists/faq.ts` |
| **Escalation / Human follow-up** | `complaint`, `escalation` | Complaints / emergencies / sensitive / out-of-policy; collects a concise staff message; marks staff-action | `runPostCallExtraction` → `service_requests` + staff note | `specialists/escalation.ts` |
| **Post-call Analyst** | (after the call) | Structured, staff-facing analysis for the dashboard — separate from the transcript | writes `calls.analysis` | `src/lib/call-pipeline/analyst.ts` |

Intent → specialist routing is the single source of truth in **`src/lib/agents/routing/intents.ts`**
(`routeIntent`, `SPECIALISTS`, `CALLER_INTENTS`) — pure + unit-tested. It is distinct from the turn-level
`classifyCallerIntent` (backchannel vs substantive) in `call-pipeline/intent.ts`.

## Voice behavior (caller experience)

One smooth assistant. The playbooks explicitly forbid announcing routing ("transfer", "another agent"),
enforce short phone-natural replies, one question at a time, no repeated questions, no talking over the
caller, and **default English unless the caller clearly continues in another language** (the language
policy lives in `GLOBAL_RULES` and is unchanged).

## Prompt composition (shared by browser + phone)

`renderSpecialistPlaybooks()` (`specialists/index.ts`) composes the four playbook modules into one
`SPECIALIST PLAYBOOKS` section. `buildSystemPrompt()` (`agents/core/promptBuilder.ts`) injects it
**additively** — `GLOBAL_RULES` (the proven safety base: no-invent, no-false-confirm, phone digits,
language, silence) is unchanged. Both the browser session (`/api/voice-session`) and the phone bridge
(`/api/twilio/session-config` → `server/twilio-bridge.ts`) build the prompt from the same
`buildSystemPrompt`, so **there is zero prompt duplication** and the two paths cannot drift.

## Tool boundary (pilot design)

DB actions go through **server functions, never faked in natural language**:
- Bookings / service requests → created by `runPostCallExtraction` (`postCallCore.ts`) after the call.
- Knowledge answers → from the profile + KB injected into the prompt server-side.
- The agent **confirms details and says staff will confirm** — it never claims a booking is done
  (enforced by `GLOBAL_RULES` no-false-confirm + the booking playbook).

The specialist must **ask** when required info is missing (booking playbook) rather than guess. Live
mid-call function-calling is intentionally **not** used for the pilot (latency/reliability on the S2S
path) — it's the migration below.

## Post-call Analyst pipeline

After a call is saved, `postCallCore.runPostCallExtraction`:
1. Runs the extraction model over `calls.transcript` (`callerLinesOnly` for intent).
2. Runs deterministic guards: `assessCollection` (completeness) + `isPastAppointment` (past-time).
3. Calls **`buildAnalystResult({ extraction, assessment, pastTime })`** → an `AnalystResult`:
   `caller_name`, `caller_phone`, `intent`, `requested_service`, `requested_time`, `booking_status`
   (`none | incomplete | captured` — never "confirmed"), `staff_action_required`, `confidence`
   (`high | medium | low`), `risk_flags[]` (e.g. `past_time`, `incomplete_booking`, `unresolved_question`,
   `urgent`, `complaint_or_escalation`, `no_callback_number`), and a short `staff_summary`.
4. Persists it to **`calls.analysis` (jsonb)** best-effort. **The verbatim transcript stays in
   `calls.transcript`; the analyst never rewrites it as verbatim** — summary and transcript are separate.

Requires migration `supabase/migrations/20260709000000_calls_analysis.sql` (additive; the write is
defensive, so it's a no-op until the column exists).

## Browser vs Twilio call path

Both build the identical specialist prompt (`buildSystemPrompt`) and share `runPostCallExtraction`. Only
the transport differs: **browser** = WebRTC + Layer-2 app-controlled responses (`dashboard/voice`);
**phone** = Twilio Media Streams ↔ raw OpenAI WS bridge with server auto-response + safety caps. Agent
business logic is fully separate from transport code.

## QA scenarios

Deterministic tests (run now, no key): routing (`routeIntent`, registry), analyst derivations
(`buildAnalystResult`), and specialist-playbook content/silent-routing — in `scripts/qa-units.ts`.

Conversation-level scenarios below need a live model — run via `npm run qa:agent-evals` (set
`OPENAI_API_KEY`) and/or manual test calls. Each should route to the noted specialist and obey the rule:

| # | Scenario | Expected |
|---|---|---|
| 1 | Simple FAQ ("what time do you open?") | FAQ; answers from KB; no booking; no invention |
| 2 | New booking, all details | Booking; reads back; "staff will confirm" (not "booked"); `booking_status=captured` |
| 3 | New booking, missing details | Booking; asks for the missing detail; `booking_status=incomplete` |
| 4 | Reschedule request | Booking; captures which booking + the change |
| 5 | Cancellation request | Booking; captures which booking to cancel |
| 6 | Question not in KB | FAQ; "I don't have that", offers a note; `unresolved_question=true` |
| 7 | Complaint / staff follow-up | Escalation; concise staff message; `staff_action_required=true` |
| 8 | Ambiguous request | Router asks ONE short clarifying question; never guesses |
| 9 | Noisy / interrupted caller | No response to noise; doesn't talk over; asks once, then waits |
| 10 | Chinese / mixed-language, one short phrase | Stays **English** on a short/ambiguous phrase; switches only on clear sustained non-English |

## Migration TODO → native SDK handoffs + live tools

When ready to move beyond the pilot:
1. Add `@openai/agents` and model each specialist as a `RealtimeAgent` with `handoff` edges (Router →
   Booking/FAQ/Escalation; specialists return to Router). Reuse these playbook strings as each agent's
   instructions — the routing map in `routing/intents.ts` already encodes the edges.
2. Register real **tools/function-calls** (`create_booking`, `lookup_knowledge`, `create_note`) so the
   specialist acts mid-call; wire tool-call handling into **both** transports (browser data channel +
   bridge WS) with async execution + error handling.
3. Keep the Post-call Analyst as-is (it's transport-independent).
This is a transport + orchestration change — deferred deliberately so the pilot stays simple and reliable.

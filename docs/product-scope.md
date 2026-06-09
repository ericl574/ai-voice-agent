# Product Scope & Positioning

Purpose: what FrontDesk is, who it's for, the language we use, and what we deliberately do **not**
build yet. Root rules live in `CLAUDE.md`; this is the detailed product reference.

## What FrontDesk is

A SaaS **virtual front desk / answering service** for local service businesses. It answers customer
calls naturally, uses the business's own knowledge, captures useful details, creates appointment /
service requests when relevant, and gives staff clear next actions on a dashboard.

Sell a **better front desk service**, not an "AI bot."

## Customer-facing language

**Prefer:** front desk, virtual front desk, answering service, call handling, receptionist,
customer calls, appointments, service requests, follow-up, staff dashboard, business knowledge,
"Try our service".

**Avoid overusing:** AI agent, chatbot, bot, simulator, automation tool.

**Never:** claim the assistant is a human. If a caller asks, say plainly it's an automated/AI
assistant (see `docs/agent-behavior.md`).

## Supported verticals

Restaurants are only the **first demo vertical**. Shared architecture, UI, schema, prompts, and copy
must stay **generalized** — do not hard-code restaurant-only concepts into shared code.

Supported `business_type` values:

```ts
restaurant | auto_repair | salon | clinic | tutoring | home_services | other
```

Vertical-specific judgment lives in `src/lib/agents/verticals/*`; restaurant-specific tables or
logic belong only in vertical-specific modules, never in shared code.

## Generalized database schema

Use generalized table names in shared schema:

```txt
businesses
business_members
business_knowledge
customers
calls
call_messages
appointments
service_requests
profiles
```

## Status language

Useful, honest statuses:

```txt
Needs confirmation
Needs callback
Quote requested
Appointment requested
Resolved
Escalated
Captured
Waiting for staff
Follow-up required
```

**Do not use "confirmed"** unless the system/business flow truly confirms it. Appointments captured
by the agent default to `pending` (staff confirms) — see false-confirmation rules in
`docs/agent-behavior.md`.

## What NOT to build yet

Do not add (without explicit Eric approval):

- Twilio / Retell / Vapi / any phone or voice **platform**
- SMS, real phone numbers, or real phone integration
- Billing, payments, or card collection
- A different model, provider, or voice platform

These are out of scope for the current MVP. The reservation-confirm SMS is a **stub** only.

# Product Scope & Positioning

Purpose: what FrontDesk is, who it's for, the language we use, and what we deliberately do **not**
build yet. Root rules live in `CLAUDE.md`; this is the detailed product reference.

## What FrontDesk is

A SaaS **after-hours / missed-call capture** service for local service businesses — a lightweight
answering service, **not** a full daytime workflow or staff replacement. **The merchant keeps their
existing public number**; their carrier/PBX conditionally forwards the calls they were already
missing to FrontDesk, which answers naturally, uses the business's own knowledge, captures the
caller's request and contact details, and saves the call. The owner's value arrives as **one clean
daily report**, not as another system to babysit.

Customer-facing promise: **FrontDesk answers calls the business was already missing, captures the
caller's request, and sends one clean daily report.**

Sell a **better way to stop missing calls**, not an “AI bot.”

## How a call reaches FrontDesk

FrontDesk does **not** replace or advertise a new number. It's ordinary conditional call forwarding:

1. A customer dials the **merchant's existing public number** (`businesses.phone`) — unchanged.
2. The merchant's carrier/PBX applies its forwarding rule: in hours, staff answer; **after hours**,
   the call is forwarded to a **hidden, per-business FrontDesk Twilio number** (`businesses.twilio_number`).
3. Twilio calls `/api/twilio/voice`; FrontDesk resolves the business from the **dialed `To`** (one
   dedicated number per business → reliable and carrier-independent, **no reliance on `ForwardedFrom`**),
   streams to the bridge, and the agent answers with that business's info.

**Pilot #1 is after-hours only**, set up **concierge** (Eric assists the merchant, configures the
FrontDesk/Twilio side, and runs a real forwarded-call acceptance test, verifying caller-ID
preservation per carrier). Full setup / testing / rollback: `docs/call-forwarding-setup.md`.

## Activation goal (target direction — mostly future)

The **direction** is a **five-minute activation**: enter the merchant's website + existing public
number → FrontDesk imports business info into a **reviewable draft** agent + knowledge base → the user
corrects gaps → FrontDesk prepares a hidden Twilio number, configures its webhook, and maps it → the
merchant enables forwarding on their line (a **guided** step FrontDesk can't do for them) → a real
test call confirms it's live. This is a **product direction, not a shipped flow** — pilot #1 stays
concierge. A vertical template is the **foundation**, not full personalization: the merchant-specific
agent = vertical foundation + website-derived facts + merchant-confirmed info + FrontDesk global rules.
Full stages, the website-to-agent model, the carrier boundary, and pilot-vs-scale phasing:
`docs/activation-flow.md`.

## Current MVP (the value loop)

1. The merchant forwards the calls they miss to FrontDesk (**pilot #1: after-hours only**; no-answer / busy are future).
2. FrontDesk answers, captures the caller's request, and the call is **saved**.
3. The owner receives **one daily report**.

- **Email report + CSV is the primary deliverable.** **SMS is an optional, short alert only** (e.g.
  "FrontDesk captured 6 after-hours calls. Report sent to your email.") — never required.
- The **dashboard is secondary**: settings, call history, report archive, basic config. The owner
  does not need to live in the dashboard.
- **Appointments / service requests are captured outcomes**, not a forced workflow and not the core
  adoption requirement. Capture the caller's intent; let staff follow up.
- Reporting setup, no-domain behavior, and the cron live in `docs/after-hours-report.md`.

## Customer-facing language

**Prefer:** after-hours, missed calls, calls you were already missing, answering service, call
capture, daily report, captured requests, follow-up, business knowledge, "Try our service".

**Avoid overusing:** AI agent, chatbot, bot, simulator, automation tool.

**Avoid implying:** that FrontDesk replaces your daytime staff / receptionist, runs your whole front
desk, or that SMS is required. The promise is **capturing the calls you were already missing** and
sending **one daily report** — not staffing your front desk.

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

**Current reporting MVP — maintained, not expanded:** Resend email report + CSV, and the optional
Twilio SMS report alert. Improve these within the missed-call reporting MVP; do not broaden their
scope without approval.

**Twilio inbound phone (approved path, not production-verified):** Twilio is the approved phone/SMS
provider path, but **real call forwarding requires a deployed/verified Twilio bridge** and is not
production-verified by default (`docs/twilio-setup.md`, `docs/deployment-checklist.md`). Do not promise
production phone service before manual verification; the default test surface is the browser voice
line.

**Billing (present, not the current focus):** Stripe billing **scaffolding** exists (test-mode
checkout / portal / webhook / status + plan display) but is **not enforced** (no feature gating) and
is **not part of the reporting MVP focus**. Setup lives in `docs/stripe-setup.md`; treat billing as
out of current scope.

Do not add (without explicit Eric approval):

- **Self-serve number purchasing, automatic Twilio-number purchasing + webhook auto-config, website
  import / crawling, carrier / PBX integrations, SIP / BYOC, number porting, or daytime-overflow /
  no-answer / busy forwarding** — all future (the target activation flow, `docs/activation-flow.md`).
  Pilot #1 is concierge-assigned hidden Twilio numbers + **after-hours forwarding only**. FrontDesk
  never ports, replaces, or advertises the merchant's public number.
- New phone/voice **platforms** (Retell / Vapi / etc.) or new production phone-number flows beyond
  the existing single-number Twilio path
- New messaging or reporting **channels** beyond the existing email/SMS report
- New or expanded payment / card-collection / billing flows
- A different model, provider, or voice platform

The reservation-confirm SMS (auto-confirm mode) is a **stub** only — distinct from the after-hours
report SMS alert, which is real.

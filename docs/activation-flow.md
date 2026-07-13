# Five-Minute Activation & Website-to-Agent — product direction

> **This doc is the FrontDesk "Level 2" definition** (operator-assisted ~5-minute activation, not
> self-serve). Readiness levels + current priority: `docs/launch-readiness.md`. Current target is
> **Level 1** (one real customer), so everything here remains **future direction**.

> **Status: product direction (mostly future), not current capability.** This doc records the
> **target** activation experience so the team builds toward one coherent goal. **Pilot #1 is
> concierge** (Eric runs the steps by hand — see `docs/first-customer-onboarding.md`). Nothing here
> describes a shipped self-serve flow. Where a stage is not built yet, it says so. This doc does **not**
> authorize building automatic Twilio-number purchasing, website crawling, or carrier integrations —
> each of those needs explicit approval (CLAUDE.md safety rule #16) before implementation.

## The authoritative product model (recap)

FrontDesk is an **after-hours / busy-line / missed-call answering service**. **The merchant keeps
their existing public phone number.** Customers keep calling the number they already know. FrontDesk
never issues, ports, or advertises a replacement public number.

The call path:

- **During business hours:** customer → merchant's existing public number → **merchant staff**.
- **When a forwarding condition is active** (after-hours / busy / no-answer): customer → merchant's
  existing public number → **carrier or PBX call forwarding** → **dedicated hidden FrontDesk Twilio
  number** → **merchant-specific FrontDesk agent**.

One dedicated hidden Twilio number is assigned per business. The inbound Twilio `To` number is matched
against `businesses.twilio_number` to identify the business (`matchBusinessIdByNumber`,
`src/lib/twilio/numberRouting.ts`) — reliable and carrier-independent, **no reliance on
`ForwardedFrom`**. Full forwarding setup, the real acceptance test, and rollback:
`docs/call-forwarding-setup.md`.

## The activation objective

Once a merchant agrees to use FrontDesk, the **target** is to make their service **live and testable
in ~5 minutes** whenever their carrier or phone system supports a simple forwarding workflow. The
experience should be simple enough to demonstrate live, in front of a merchant:

1. Enter the merchant's website URL and existing public business phone number.
2. FrontDesk imports available business information from the website.
3. FrontDesk creates a **draft** merchant-specific agent + knowledge base.
4. The user reviews / corrects uncertain and missing information.
5. FrontDesk prepares a dedicated hidden Twilio destination number.
6. FrontDesk configures the approved Twilio voice webhook and maps the number to the business.
7. FrontDesk shows concise instructions for forwarding the merchant's existing number.
8. The merchant calls their own existing public number from another phone.
9. FrontDesk detects the inbound test call and verifies the correct agent answered.
10. The UI confirms FrontDesk is live (or shows exactly what remains unresolved).

**The hard boundary:** knowing the merchant's phone number gives FrontDesk **no** permission or
technical access to change that number's carrier/PBX routing. FrontDesk automates only what is under
**FrontDesk + Twilio** control; enabling forwarding on the merchant's line stays a **guided step** the
merchant / operator / carrier performs (see "Technical boundary" below).

## The activation wizard (future) — five stages

### Stage 1 — Business
Minimal inputs: **website URL**, **existing public business phone number**, and **business name** only
if it can't be detected. Nothing else is required to start.

### Stage 2 — Agent draft (website → reviewable profile)
FrontDesk imports and **structures** relevant public business information into a **reviewable profile +
agent configuration** — not a large blank form. Fields it aims to populate: business identity,
category, location, hours, services, menu / service catalogue, pricing **where explicitly published**,
FAQs, booking rules, cancellation policies, contact info, service area, and important operational
limitations.

- Information that was **not found or is uncertain must be clearly marked.**
- The model **must not invent** business policies, prices, availability, medical advice, or any other
  merchant fact. (This is the same no-invention rule the live agent already enforces —
  `docs/agent-behavior.md`.)

### Stage 3 — Phone preparation (FrontDesk + Twilio side only)
An operator-facing (later customer-facing) **"Activate phone service"** control that can:

- locate or accept a suitable Twilio number;
- **purchase the number only after** the relevant authorization + billing safeguards exist;
- configure the approved voice webhook (`/api/twilio/voice`);
- map the number to the correct business (`businesses.twilio_number`);
- validate **uniqueness** (the partial unique index `businesses_twilio_number_key` already enforces
  one-number-per-business) and **E.164** formatting;
- verify inbound `To` routing can resolve the business;
- provide rollback information.

**Number purchasing must never be performed silently.** It is gated on explicit approval + billing
safeguards; until then, the operator provisions numbers manually in the Twilio console and maps them
with `npm run pilot:map` (`scripts/map-business-number.ts`).

### Stage 4 — Call forwarding (guided, not automatic)
The wizard asks for what it needs to give the **smallest precise** instruction set:

- line type: mobile / landline / VoIP / PBX;
- carrier or phone provider;
- device / portal: iPhone / Android / provider portal / business phone system;
- desired forwarding condition: always / after-hours / busy / unanswered / unreachable.

It then shows the minimal, carrier-appropriate forwarding steps. **Do not** claim all carriers share
the same codes, or that FrontDesk can modify the merchant's carrier account. Scheduling / after-hours
behavior initially rides on the merchant's **existing** carrier/PBX capability; richer scheduling is
later. Per-system codes and rollback already live in `docs/call-forwarding-setup.md`.

### Stage 5 — Live acceptance test
The UI instructs the merchant / operator to **call the merchant's original public number from a
different phone**. Where possible, FrontDesk verifies:

- the forwarded call reached Twilio;
- the inbound `To` resolved the **correct** business;
- the correct merchant-specific agent configuration loaded (no `USING FALLBACK INSTRUCTIONS`);
- the **original caller's** number was preserved through the forward (the per-carrier `From` risk in
  `docs/call-forwarding-setup.md`);
- the agent answered successfully;
- the call + transcript were saved;
- no fallback or routing error occurred.

Final state clearly shows **live** or **what's unresolved**. This is the same end-to-end check the
concierge acceptance test does today by hand (bridge logs + Call History) — the future work is
surfacing it as an automatic in-UI verification.

## Merchant-specific agent generation

A vertical template is a **starting foundation, not full personalization by itself.** The intended
configuration model:

```
  vertical foundation (src/lib/agents/verticals/*)
+ website-derived merchant facts        (Stage 2 import)
+ merchant-confirmed information         (Stage 2 review)
+ FrontDesk global safety & behavior     (GLOBAL_RULES)
= merchant-specific FrontDesk agent      (assembled by buildSystemPrompt)
```

Website import produces a **draft** — it never publishes unreviewed model output straight into the
production agent. The import flow:

1. accept a merchant URL;
2. inspect the relevant public pages;
3. extract **supported** facts into structured fields;
4. generate draft knowledge-base entries;
5. identify missing or conflicting information;
6. show sources / evidence where practical;
7. **require review** of important operational facts before publish;
8. publish the approved result into the merchant's agent configuration (profile + `business_knowledge`).

Every field must be distinguishable as one of: **directly found**, **inferred**, **missing**, or
**merchant-confirmed**. Missing policies or facts are **never fabricated** — the live agent then says
"I'll have the team follow up," exactly as today.

## Technical boundary (what FrontDesk cannot control)

- **Enabling call forwarding** on the merchant's carrier/PBX line — done by the merchant / operator /
  carrier, never by FrontDesk. Represent it as a **guided activation step**, never as universally
  automatic.
- **Whether a carrier preserves caller ID** (`From`) across a forward — varies per carrier; verified on
  the acceptance call (`docs/call-forwarding-setup.md`).
- **Whether conditional forwarding is even available** on the merchant's plan / device, and the exact
  feature codes — carrier-specific.

Future carrier / PBX integrations may automate more of this; **none are required for the first paying
pilot.**

## Pilot scope vs scale scope

### First paying pilot — may be concierge-assisted
- Operator creates or imports the business.
- Website information generates a reviewable draft (once the import exists; until then, manual KB).
- Operator reviews the agent configuration.
- Operator purchases / selects the hidden Twilio number (manually, in the Twilio console).
- FrontDesk safely configures + maps the number (`pilot:map`; webhook set in console).
- Merchant / operator enables call forwarding.
- Operator performs a **real forwarded acceptance call.**
- Problems are diagnosed and corrected by hand.

**Manual number mapping is the plan for pilots — not a launch blocker.** The one true pilot gate is a
passing **forwarded-call acceptance test** (`docs/launch-readiness.md`).

### Future self-serve & scale — NOT pilot blockers
- Fully customer-controlled Twilio purchasing.
- Automatic billing for number costs.
- Automatic number release / lifecycle management.
- Direct carrier-account integrations.
- PBX integrations.
- Universal forwarding-schedule management.
- Automatic carrier detection.
- Zero-operator onboarding.
- High-volume number-inventory management.

## What the repo supports today vs what must be built

**Supported today (verified in code):**
- Manual business creation (`/onboarding`) → `businesses` + `business_members`.
- Manual knowledge base (`/dashboard/knowledge`) and agent config (`/dashboard/settings`).
- Vertical foundation + business facts + KB + global rules assembled by `buildSystemPrompt()`
  (`src/lib/agents/core/promptBuilder.ts`) — identical for browser and phone.
- Inbound `To` → business routing (`matchBusinessIdByNumber`; `/api/twilio/voice`).
- Concierge number mapping (`npm run pilot:map`; unique index on `twilio_number`).
- Shared post-call save + extraction (`runPostCallExtraction`).

**Must be built for five-minute activation (each needs its own approval + design):**
- **Website import service** — fetch public pages → extract supported facts → draft profile + KB, with
  provenance tags. (No crawling code exists today.)
- **Provenance-tagged draft-review UI** (found / inferred / missing / confirmed).
- **Twilio number provisioning** — search / select / purchase available numbers via the Twilio API,
  gated on approval + billing. (No purchasing code exists today.)
- **Automatic voice-webhook configuration** on the provisioned number.
- **Authenticated auto-map action** (an API/UI wrapper around today's `pilot:map` logic).
- **Guided forwarding UI** (line/carrier/condition → minimal instructions).
- **Live acceptance-test detector** — watch for the inbound test call and verify To-resolution,
  business match, caller-ID preservation, save, and no fallback → show "live" / "unresolved".

## Proposed implementation sequence

**Phase A — First paying pilot (concierge; mostly done):**
finish the external gates in `docs/launch-readiness.md` — deploy app + bridge, keys on both, and one
real **forwarded-call acceptance test**. Optional quality-of-life: an operator-side mapping helper so
the concierge step never needs raw SQL (a bounded improvement to the existing `pilot:map` script).

**Phase B — Five-minute concierge activation (operator-driven):**
build, in roughly stage order — (1) website import → reviewable draft; (2) operator-run number
provisioning **with approval + billing safeguards** + auto-webhook + auto-map; (3) guided forwarding
UI; (4) live acceptance-test detector. Operator-assisted, not yet customer-self-serve.

**Phase C — Future full self-serve scale:**
customer-controlled purchasing, automatic number billing, number lifecycle/release, carrier/PBX
integrations, universal scheduling, carrier auto-detection, zero-operator onboarding, and number
inventory management. Gated on billing enforcement and explicit approval.

## Guardrails (non-negotiable)
- **No fabricated merchant facts.** Found / inferred / missing / confirmed stay distinguishable; the
  agent says "the team will follow up" for anything unknown.
- **No silent number purchasing.** Purchasing is gated on explicit approval + billing safeguards.
- **Forwarding is guided, never claimed as universally automatic.**
- **The merchant's public number is never replaced, ported, or advertised as new.**
- Website import creates a **draft**; a human approves before it reaches the production agent.

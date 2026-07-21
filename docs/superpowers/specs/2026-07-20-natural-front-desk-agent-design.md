# Design — Making the voice agent feel like a real front desk (demo-ready, one vertical)

Date: 2026-07-20
Status: Increment 1 implemented; Increment 2 designed, not yet built.

## Problem

The agent "feels cheap" — you can tell you're talking to a machine and it doesn't feel like it
respects you. Concretely, testing surfaced four symptoms: slow/laggy timing, robotic voice, shallow
answers ("staff will follow up" to everything), and a rigid, interrogation-like script.

## Diagnosis (grounded in the code, not the docs)

Every symptom traces to a deliberate design choice made to build a *cautious after-hours
lead-capture bot* — which is exactly why it feels like one:

- **Slow** — `turnDetection.ts`: `silence_duration_ms: 1000` (a full second before it replies) and
  `interrupt_response: false` (the caller literally cannot interrupt it).
- **Robotic** — `voice-session/route.ts`: the public demo left `voice_id` unset, so it used the flat
  server-default voice with no persona shaping.
- **Shallow** — the demo home-services business had **3 thin knowledge rows**; empty knowledge forces
  "staff will follow up" as the only possible answer.
- **Rigid** — `globalRules.ts` hard-codes CLASSIFY → COLLECT one-question-at-a-time → CONFIRM → CLOSE
  and a "DON'T RESOLVE, capture for staff" philosophy.

**Core insight:** the model (`gpt-realtime`) is the same class of model as a strong assistant — it is
not undertrained, it is *caged and starved*. The fix is to stop suppressing it (persona + latitude),
feed it real knowledge (competence = respect), and make it feel present (timing + voice), **not** to
train a model or build RAG.

## Decisions

- **Vertical / demo star:** home services — a believable Vancouver plumbing/heating shop
  ("Cascade Plumbing & Heating", receptionist persona "Riley").
- **Demo surface:** the browser "Try our service" demo first (WebRTC, best audio, no Railway bridge
  needed). The phone number follows; the turn/voice/knowledge work carries straight over.
- **Natural over noise-proof** for the demo.

## Non-goals (explicitly not now — YAGNI)

- No RAG / embeddings / vector DB. One business's full knowledge fits in the prompt; retrieval only
  earns its keep at hundreds of entries.
- No fine-tuning / model "training."
- No multi-agent runtime framework. (The `specialists/` files are prompt playbooks, and that's fine.)
- No changes to the phone bridge's turn-taking (its conservative VAD was locked after a real
  incident; barge-in on telephony is unverified).

## Increment 1 — Presence + competence (IMPLEMENTED)

1. **Interactive turn-taking, browser-only.** New `REALTIME_VAD_INTERACTIVE` in `turnDetection.ts`
   uses **semantic VAD** (`eagerness: 'medium'`, `interrupt_response: true`) so the model waits for a
   complete thought instead of a fixed silence timer — this removes mid-sentence cutoffs (a first pass
   at `silence_duration_ms: 500` on server VAD cut hesitant callers off; semantic VAD replaced it).
   Used by the browser session (`voice-session/route.ts`); the phone bridge keeps the conservative
   locked silence-timer `REALTIME_VAD` until verified on a real forwarded call.
2. **Real voice on the demo.** The demo business sets `voice_id: 'coral'`; `voice-session/route.ts`
   now applies the demo business's voice/speed (same clamp as the authenticated path).
3. **Deep, believable business.** `demoBusinesses.ts` `home_services` rewritten: persona (name +
   warm greeting), tone, staff-handoff rule, and ~28 knowledge entries with real price ranges,
   service area, arrival windows, warranty, and genuine emergency triage including "what to do while
   you wait" (shut off the main valve, gas-smell safety, leaking-heater steps).

4. **Restaurant demo deepened too** (after testing showed it couldn't answer "what do you have?"):
   `demoBusinesses.ts` `restaurant` now has a host persona ("Sofia"), a voice, and ~22 knowledge
   entries (menu, prices, dietary, reservations, hours, events). Same treatment as home services —
   proof the pattern generalizes per vertical.

Files: `src/lib/realtime/turnDetection.ts`, `src/app/api/voice-session/route.ts`,
`src/lib/agents/demoBusinesses.ts`, `scripts/qa-units.ts` (locked the new values + guarded the split).

## Increment 2 — Latitude + persona-in-prompt (DESIGNED, needs review before building)

The consequential, less-reversible change. Carefully loosen `globalRules.ts` from "capture, don't
resolve" toward "resolve what you safely can, capture the rest," add a real persona/character layer,
and add 3–4 worked example exchanges — while **keeping the hard safety rails** (never invent a
price/hours/availability not in the KB; never say "confirmed"). Because this changes behavior for
every vertical and every business (not just the demo), it gets its own reviewed step.

Candidate follow-ups: try the newer `marin`/`cedar` voices; evaluate `semantic_vad` for even more
natural endpointing.

## Risks

- Barge-in can occasionally false-trigger in a loud room — acceptable for a demo; threshold stays 0.7
  to reduce it. One-line revert if needed.
- Demo prices are realistic **placeholders**, not real quotes — fine for a demo; a real merchant sets
  real numbers.

## How to demo

Browser "Try our service" → pick Home Services → call. Try: "my water heater is leaking, how much to
replace it, and can you come tonight?" — the agent should quote a range, walk the safety step, and
capture the job, interruptibly and without a one-second lag.

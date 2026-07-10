# Proof-Asset Capture Guide — show a pilot what FrontDesk actually does today

**Purpose:** a step-by-step Eric can follow to capture **real** evidence (screenshots / a short screen
recording) that proves FrontDesk works, to show a first pilot customer. Everything here is grounded in
the current app — nothing staged.

**Ground rules (do not break these):**
- Capture **real** screens only — never mock or fake a screenshot.
- Never claim a capability the app doesn't have today. If something is missing, say so.
- Appointments/requests are captured **pending staff confirmation** — never shown as "confirmed."
- The assistant is **automated** — never present it as a human.
- Don't touch production secrets or external dashboards to make a screen look better.

---

## Two levels of proof — pick based on setup you have

| Level | What it proves | Setup needed | Time |
|-------|----------------|--------------|------|
| **A — Browser test call (recommended first)** | The full capture loop: a real spoken call → saved two-sided transcript → summary → captured appointment/service request, all in the dashboard. | Signed-in account with a business profile + `OPENAI_API_KEY` on the app. Chrome/Edge + mic. **No Twilio, no bridge.** | ~5–10 min |
| **B — Real inbound phone call** | The same loop, but triggered by dialing an actual phone number (most convincing for an owner). | Full `docs/pilot-go-live.md` setup (Twilio number, bridge on ngrok/Railway, env on both). | ~60–90 min first time |

Do **Level A first** — it is the fastest fully-real proof and exercises the identical save + extraction
code as the phone path (`runPostCallExtraction` in `src/lib/call-pipeline/postCallCore.ts` is shared by
both). Add Level B once the phone line is live.

> **Important honesty note:** the public landing **"Try Our Service"** widget and any dashboard page
> opened with `?demo=1` run a **demo that does NOT save** (demo isolation — `src/app/dashboard/voice/page.tsx`
> forces the not-saved state). Great for *hearing* the agent talk, useless as proof of saved data. For a
> proof asset you must be **signed in and NOT in demo mode** (plain `/dashboard/voice`, no `?demo=1`).

---

## Pre-flight (both levels)

1. **Sign in** and confirm you have a **business profile** (from onboarding): a name, timezone, and — this
   matters — **2–3 Knowledge Base entries** (`/dashboard/knowledge`), e.g. hours and a couple of FAQs.
   Without KB entries the "answers a question from your info" moment falls flat.
2. Confirm the app has `OPENAI_API_KEY` set (if the summary later says *"analysis pending"* with no caller
   name, the app is missing the key — see `docs/pilot-go-live.md` blocker #5).
3. Use **Chrome or Edge**, allow the **microphone**, quiet room, headphones (avoids echo).
4. Open the URL **without** `?demo=1`. Sanity check: the page shows a live **"Start call"** button, not a
   "sign in to place a test call" prompt (that prompt means you're in demo mode).

---

## LEVEL A — Browser test call (the main proof)

### A1. Place the call
Go to **Dashboard → "Test the call"** (`/dashboard/voice`) → **Start call**. Wait for the greeting, then
speak naturally. End with **End call**. The page will show status **"saved"** and run post-call analysis.

### A2. Exactly what to say (a script that produces rich proof)
Say these out loud, one at a time, pausing for the assistant to reply. This example is auto-repair; adapt
the service/details to your pilot's vertical. The goal is to hit **one KB question** + **one appointment
capture** so the transcript and the extracted record both look real.

> **You:** "Hi, what time do you open on Saturday?"
> *(proves it answers from your Knowledge Base — only works if you added hours)*
>
> **You:** "Okay. I'd like to book an oil change."
>
> **You:** "Tomorrow morning if you have it — around 9."
>
> **You:** "My name is Sarah Johnson, and my number is 604-555-0142."
>
> **You:** "That's all, thanks. Bye."

What to listen for (proves quality live): it greets in your business name, answers the hours question
**only from what you gave it**, collects the details one at a time, **reads the phone number back**, says
**staff will confirm** (it should NOT say "you're confirmed"), and closes once.

### A3. What to capture, in order (real screenshots / a short screen-record)

1. **The test-call screen right after ending** (`/dashboard/voice`) — status **"saved"** + the post-call
   **extraction result** panel (the captured appointment / service request). If an error banner shows
   (e.g. *"No caller speech was captured…"*), capture it too and note it — that's honest.
2. **Call History** (`/dashboard/calls`, "Call History") — the new call row; **tap it to expand** the
   transcript. Capture the expanded view: **Front desk on the left, Caller on the right**, the **Summary**,
   and the **"Follow-up"** pill if present. This is your headline screenshot.
3. **Appointments** (`/dashboard/reservations` — the nav says **"Appointments"** for non-restaurant
   verticals, "Reservations" for restaurants) — the captured appointment, shown **Pending**.
4. **Service requests** (`/dashboard/orders`) — only if the call was a service/quote request rather than an
   appointment. Skip if not applicable.
5. **Settings → After-hours report** (`/dashboard/settings`) — show the report configuration (report email,
   send hour, **Attach CSV**). **Be honest about the notice here** (see limitations): if you haven't set a
   sender domain, this card literally says *"production email delivery is not fully enabled."*

---

## LEVEL B — Real inbound phone call (optional, most convincing)

Only after `docs/pilot-go-live.md` is done (Twilio number mapped via `businesses.twilio_number`, bridge
running, env on both app + bridge). Then:

1. **Dial the pilot's Twilio number** from a phone and run the **same A2 script**.
2. Capture the **bridge log lines** (they prove the real call path end-to-end): `stream started` →
   `session-config loaded (business: …)` → `first assistant audio → caller` → `first caller transcript
   captured` → `call ended (<reason>) … M transcript turns` → `post-call → 200`. A short terminal
   screen-record of these is strong evidence.
3. Then capture the **same dashboard screens as A3** (Call History, Appointment, Settings).

⚠️ If the bridge logs `⚠️ USING FALLBACK INSTRUCTIONS`, the business identity/KB did not load — **do not
use that call as proof**; fix `TWILIO_BRIDGE_SECRET`/`FD_APP_URL` first.

---

## What evidence proves the app works (maps to the 5 things to show)

| Owner-facing claim | The real screen/artifact that proves it |
|---|---|
| 1. A real sample call happened | The `/dashboard/voice` "saved" state (Level A) **or** the bridge call-ended log (Level B) |
| 2. The transcript/call history is saved | **Call History** expanded row — two-sided transcript + Summary |
| 3. A reservation/service request was captured | **Appointments** page (pending) and/or **Service requests** page |
| 4. Staff-facing follow-up flow exists | The **"Follow-up" pill** + the Call History as the staff review surface; Settings → After-hours report as the delivery config |
| 5. "What the owner sees" story | The 60-second narrative below, told over screens 2–3 |

**Real today (safe to show):** the live spoken call, the saved two-sided transcript, the call summary, the
captured appointment/service request (pending), the Follow-up flag, and the report **configuration** + the
**CSV** the report is built from.

**Real but conditional:** the **morning report email itself** only sends once a Resend sender domain
(`NOTIFY_EMAIL_FROM`) is configured. Until then, email **skips safely** (by design) — so show the
**dashboard Call History** as "this is exactly what the morning email/CSV is built from," and optionally a
manually-triggered digest returning `{ ok, processed, sent, failed }`. Don't screenshot an email you
haven't actually received.

---

## What NOT to show yet

- The **landing "Try Our Service"** demo or any `?demo=1` screen **as if it saved data** — it doesn't.
- A **morning report email** if you haven't configured a sender domain (the Settings notice says it isn't
  fully enabled — respect that).
- Any **"confirmed"** appointment language — the product intentionally leaves captured items **pending
  staff confirmation**.
- **Billing / Stripe** screens — present in the code but not enforced; not part of the pilot.
- Claims of **replacing your receptionist / daytime staff**, or of handling **high call volume** — it's an
  after-hours/missed-call capture service on a single bridge process today.

---

## How to explain the limitations honestly (say this plainly)

- "It's an **automated** front desk — not a person. If a caller asks, it says so."
- "It **captures** the request and marks it **pending** — your staff confirm the actual booking. It never
  tells a caller something is confirmed."
- "It's built for the calls you're **already missing** — after hours, busy, no-answer — not to replace your
  daytime team."
- "It answers questions **only from the info you give it**; if it doesn't know, it says so and logs it for
  your team instead of guessing."
- "The **phone line** needs a short setup; the browser demo you just saw runs the exact same capture."
- "The **morning email report** turns on once we point it at your email domain; today the same information
  lives in your dashboard and a CSV."

---

## 60-second demo narrative (say this to a business owner, over screens 2–3)

> "Here's a call that came in after you'd closed. FrontDesk answered in your business's name, and you can
> see the whole conversation here — the front desk on the left, the caller on the right. The caller wanted
> to book an oil change for tomorrow morning; FrontDesk collected her name and number, read the number back
> to make sure it was right, and told her your team would confirm — it never promises a time it can't.
>
> That call is now a **captured appointment**, sitting in **Appointments** marked *pending*, waiting for
> your team to confirm — nothing fell through to voicemail. Up here is the one-line summary and a
> **follow-up** flag so whoever opens this in the morning knows exactly who to call back.
>
> That's the whole idea: the calls you were missing get answered, captured, and handed to you in one place —
> so you start the day knowing who to call, instead of wondering who you missed."

*(~55–60 seconds at a normal pace.)*

---

## Capture checklist

Copy this and tick as you go — note anything that didn't work rather than skipping it.

- [ ] **Call completed** — placed and ended a real call (Level A signed-in, or Level B phone). Not demo mode.
- [ ] **Transcript saved** — the call appears in Call History with a two-sided transcript.
- [ ] **Appointment/request captured** — shows in Appointments (or Service requests), status **Pending**.
- [ ] **Staff view checked** — Follow-up pill visible; Settings → After-hours report config reviewed.
- [ ] **Any error noted** — captured any banner/log verbatim (e.g. "analysis pending", "no caller speech",
      `USING FALLBACK INSTRUCTIONS`) — honesty > polish.
- [ ] **Screenshots/video captured** — screens 1–5 from A3 (and the bridge log for Level B).

---

*Grounded in the current app as of this pass. If any screen differs from what's described here, trust the
app and note the difference — do not stage it. Deeper setup: `docs/pilot-go-live.md`; known gaps:
`docs/full-codebase-audit.md`.*

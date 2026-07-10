# First Customer Onboarding — the concrete pilot path

How Eric takes one real business live on FrontDesk, start to finish. This is a **concierge** pilot:
Eric does the setup; the owner just provides info and starts getting captured calls. Companion docs:
`docs/deployment-checklist.md`, `docs/pilot-go-live.md`, `docs/proof-asset-capture-guide.md`,
`docs/supabase-rls-verification.md`.

## 0. Before the pilot (Eric, once)
- App deployed + bridge running + **RLS verified** (see deployment checklist — the hard gate).
- A Twilio Voice number available to dedicate to this business.
- `OPS_ALERT_SMS_TO` set so failures page you.
- Do one browser test call + one real phone acceptance call yourself first (don't debug live on a customer).

## 1. What the business owner provides
Collect these up front (a 15-minute call or a short form):
- Business name, timezone, city/region.
- **Hours** (and any exceptions).
- The **services / request types** they take by phone (e.g. oil change, brake job; or haircut, color).
- **5–10 FAQs** with answers (pricing guidance, "do you take walk-ins?", parking, insurance, etc.).
- Greeting preference + agent name (optional).
- How they want the **daily report** delivered (email address; SMS number optional).
- Which calls they'll **forward** to FrontDesk: after-hours only, or also busy/no-answer.

## 2. Configure the business profile (dashboard)
1. Create/onboard the business (`/onboarding`) — name, business type, timezone. Timezone matters for
   "today"/past-time handling and the report send hour.
2. **Settings → Service setup** — hours, walk-in policy, callback expectation, greeting/agent name.
3. **Settings → Front-desk behavior** — request types + details to collect (defaults are vertical-aware;
   trim to what this business actually does).

## 3. Load the Knowledge Base (`/dashboard/knowledge`)
- Add the owner's FAQs verbatim. **This is what makes the agent sound informed** — it answers **only**
  from here + the profile, and says "I'll have the team follow up" for anything it doesn't know (it does
  not guess). Thin KB = thin answers, so spend time here.

## 4. Connect the phone number
1. Twilio → the dedicated number → "A call comes in" → `https://<app>/api/twilio/voice` (POST).
2. Set `businesses.twilio_number` for this business to that number (E.164, e.g. `+16045550142`) so the
   inbound call resolves to the right business. (`docs/pilot-go-live.md` has the exact steps.)
3. Tell the owner how to **forward** their after-hours/busy/no-answer calls to it (their carrier's
   conditional call forwarding — this is the owner's phone setting, not something in the app).

## 5. Test the first call (before the owner relies on it)
- Dial the number, run a normal booking conversation + one KB question + a goodbye.
- Confirm in the dashboard: **Call History** shows the two-sided transcript + a real summary (not
  "analysis pending"); **Appointments/Service requests** shows the captured request as **Pending**.
- If summary says "analysis pending" → `OPENAI_API_KEY` is missing on the **app** (fix in Vercel env).
- If bridge logs `⚠️ USING FALLBACK INSTRUCTIONS` → session-config didn't load; fix `TWILIO_BRIDGE_SECRET`/
  `FD_APP_URL` before trusting any call.
- Capture a proof asset while you're here (`docs/proof-asset-capture-guide.md`).

## 6. Monitor the pilot (daily, ~5 min)
- Skim **Call History** each morning: did the calls get captured cleanly? Any garbled transcripts?
- Watch for **ops SMS alerts** (failed save/extraction/digest, low-quality call, fallback instructions).
- Confirm the owner is getting the **daily report** (or, if email domain isn't verified yet, walk them
  through Call History / the CSV and say email is coming once the domain is set).
- Ask the owner for one piece of feedback per day for the first week.

## 7. If the agent makes a mistake
- **Wrong/missing info** → it's almost always a KB gap. Add the correct answer to the Knowledge Base;
  it takes effect on the next call. Don't touch voice code for this.
- **Bad time/date or a false-sounding confirmation** → check the transcript; the product never says
  "confirmed" (staff confirm). Reassure the owner and, if needed, tighten the greeting/behavior settings.
- **Something structurally broken** (calls dropping, no capture) → **repoint/disable the Twilio number**
  to pause the line (rollback in the deployment checklist), fix, then re-enable. Never leave a broken
  agent answering a real customer's calls.

## Data deletion (support SOP — until an in-app flow exists)
The Privacy Policy promises deletion on request within 30 days. On an email request to the support inbox:
1. Confirm the requester owns the account (email matches the `business_members` owner).
2. In Supabase (service-role access), delete rows for that `business_id` in this order:
   `call_messages` → `calls` → `appointments` → `service_requests` → `business_knowledge` →
   `business_members` → `businesses`, then delete the auth user.
3. For a **single-call** deletion: delete just that `calls` row + its `call_messages` + any linked
   appointment/service request.
4. Reply confirming completion + date. **Do not** run destructive SQL beyond the specific `business_id`.

## Onboarding checklist
- [ ] Owner info collected (hours, services, FAQs, report destination, forwarding plan).
- [ ] Business profile + hours + behavior configured.
- [ ] Knowledge Base loaded (5–10 real FAQs).
- [ ] Twilio number webhook set + `businesses.twilio_number` mapped.
- [ ] Owner's call-forwarding set up on their line.
- [ ] Test call passes: transcript + real summary + captured request all show.
- [ ] Ops alerts wired (`OPS_ALERT_SMS_TO`).
- [ ] Daily report delivering (or dashboard/CSV interim + honest "email coming").
- [ ] Proof asset captured; owner shown the "what you'll see each morning" story.

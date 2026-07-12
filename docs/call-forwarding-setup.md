# Call Forwarding Setup, Testing & Rollback

**The model in one line:** the merchant **keeps their existing public phone number**. Customers keep
calling that same number. Their phone system **forwards only the calls they miss** — after-hours,
busy, or no-answer — to a **hidden FrontDesk destination number**. FrontDesk answers those forwarded
calls. **There is no new public number, and the FrontDesk number is never advertised.**

- The merchant's real, advertised number = `businesses.phone` — **FrontDesk never touches it.**
- The hidden forwarding destination = `businesses.twilio_number` — a Twilio number the merchant
  forwards to. Customers never dial it. Inbound routing identifies the business by the number the
  call was **forwarded to** (`params.To`), so it is reliable across carriers and does **not** depend
  on `ForwardedFrom`.

---

## Two forwarding modes (the merchant picks one or both)

1. **After-hours** — while closed, forward **all** calls to FrontDesk (a scheduled rule on a cloud
   PBX, or a manual "forward on" toggle at closing time).
2. **No-answer / busy** — forward a call **only** when staff don't pick up after N rings, or the line
   is busy. Captures missed calls during the day too. Requires the carrier/PBX to support
   **conditional** forwarding.

Business-hours calls that staff answer are **never** affected — forwarding is conditional.

---

## Merchant setup by phone-system type

> Feature codes vary by carrier and plan. Treat the codes below as the common defaults and **confirm
> with the carrier**. `<FD_NUMBER>` = the FrontDesk destination number the operator gives the merchant.

### Traditional landline (Bell / Telus / Rogers / most CA carriers)
- **Call Forward No Answer** and **Call Forward Busy** often must be **enabled by the carrier** first
  (one call to support, or the online account). Once enabled they usually set/cancel via codes such as:
  - Forward all: `*72` `<FD_NUMBER>` to set, `*73` to cancel (common North-American default).
  - Busy / no-answer variants are carrier-specific (e.g. `*90` / `*92` on some plans) — ask the carrier.
- Simplest reliable path for a pilot: **manual "forward all" at close** (`*72…`), **cancel at open**
  (`*73`).

### Mobile-run micro-business (GSM conditional forwarding codes — fairly standard)
- No-answer: `*61*<FD_NUMBER>#` (set) · `##61#` (cancel)
- Busy: `*67*<FD_NUMBER>#` · `##67#`
- Unreachable: `*62*<FD_NUMBER>#` · `##62#`
- All conditions at once: `**004*<FD_NUMBER>#` · `##004#`
- Forward everything (after-hours): `**21*<FD_NUMBER>#` · `##21#`

### Cloud PBX / VoIP (RingCentral, 8x8, Dialpad, GoTo, Ooma, etc.) — cleanest experience
1. Open the business's call-handling / **after-hours** (or **overflow**) rules.
2. Set **outside business hours → forward to an external number** = `<FD_NUMBER>`.
3. (Optional) Add a **no-answer / overflow** rule during hours → forward to `<FD_NUMBER>` after N rings.
4. Save. Most cloud PBXs let you schedule this so it flips automatically each day.

---

## Operator (Eric) setup — per pilot

1. Provision a dedicated Twilio number for the pilot **manually in the Twilio console** (do **not**
   auto-buy; do **not** present it to the merchant as their "new number").
2. Point that number's **Voice → "A call comes in"** webhook at
   `https://<app-domain>/api/twilio/voice` (HTTP POST).
3. Map it: `npm run pilot:map -- <business_id> <FD_NUMBER>` (writes `businesses.twilio_number`).
4. Confirm the business profile + knowledge base are set (greeting, hours, FAQs).
5. Give the merchant the `<FD_NUMBER>` **only as a forwarding destination**, with the setup steps above.

One deployment serves many pilots — each business is distinguished by its own `<FD_NUMBER>`.
**Never map two businesses to the same number** (the unique index prevents it) or routing by `To`
can't tell them apart.

---

## Acceptance test — real forwarded calls (run before trusting a pilot)

Do this end-to-end from a **separate** phone (not the business line):

- [ ] **Forwarding is active.** Merchant has set the chosen mode(s) to `<FD_NUMBER>`.
- [ ] **After-hours / no-answer path works.** Call the merchant's **real public number** under the
      forward condition (after close, or let it ring unanswered). The call should reach FrontDesk.
- [ ] **Correct business answers.** FrontDesk greets in **this** business's name/greeting (not the demo
      restaurant, not another pilot). Confirms `params.To → twilio_number` routing.
- [ ] **Bridge log is clean.** `session-config loaded (business: <name>)` — **not**
      `⚠️ USING FALLBACK INSTRUCTIONS`; ends with `post-call → 200`.
- [ ] **Call is saved.** It appears in Call History with a two-sided transcript and a real summary.
- [ ] **Caller ID check (the `From`-after-forward risk — see below).** In the saved call, confirm
      `customer_phone` is the **caller's** number, **not** the merchant's own forwarding line. Also
      confirm the agent, if offering a callback, reads back the **caller's** number.
- [ ] **Business-hours calls untouched.** With no-answer/busy mode, a promptly-answered call rings
      staff normally and does **not** hit FrontDesk.
- [ ] **Rollback works.** Merchant cancels forwarding (below) and a test call rings the business line
      again.

---

## The `From` / caller-ID-after-forward risk (verify per carrier)

FrontDesk uses the inbound `From` as the caller's number — it's offered back for callback
confirmation (`/api/twilio/session-config`) and saved as `customer_phone`
(`/api/twilio/post-call`). On **most** PSTN forwards the carrier preserves the **original caller's**
number in `From`. But **some carriers present the forwarding line (the merchant's own number)**
instead.

- **How to verify:** on the acceptance call, check the saved `customer_phone` and the bridge/app logs
  against the number you actually called **from**. If they match → caller ID survives the forward on
  this carrier (expected). If `customer_phone` is the **merchant's own number** → this carrier does
  not preserve it.
- **Blast radius if it's wrong:** low — the agent only asks the caller to **confirm** the number
  (it never invents digits), so a wrong `From` becomes a clarifying question, not a bad callback.
  The saved `customer_phone` would be wrong, though.
- **If verification shows it's unreliable on a target carrier:** add a guard that treats `From` as
  unknown when it equals the business's own `phone`/`twilio_number` (so the agent asks for the number
  instead of assuming it). Not implemented yet — deferred until a real forwarded call proves it's
  needed.

---

## Disable / rollback (safe, instant, merchant-controlled)

- **Merchant kill-switch (primary):** cancel call forwarding on their line — the cancel code for their
  system (e.g. `*73`, `##21#`, `##004#`) or toggling off the PBX rule. Calls **immediately** ring
  their own phone / voicemail again. FrontDesk never modified their number or normal handling, so
  there is nothing else to undo on their line.
- **FrontDesk side:** to stop answering as a business, unmap it
  (`npm run pilot:map -- <business_id>` shows current; clear `businesses.twilio_number` in Supabase)
  or repoint/release the Twilio number's webhook. But the real rollback lever is the merchant's
  forward toggle.
- **Safety:** because forwarding is conditional, turning it off can never strand an in-hours answered
  call — normal handling is always the default.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Forwarded call reaches a **generic/demo** front desk | `<FD_NUMBER>` not mapped to the business (`businesses.twilio_number`), or the webhook points at the wrong app. |
| Call drops immediately, Twilio shows **403** | `NEXT_PUBLIC_SITE_URL` ≠ the webhook origin (signature check). |
| `customer_phone` is the **merchant's** number | This carrier doesn't preserve caller ID on forward — see the `From` risk section. |
| Business-hours calls also hit FrontDesk | Merchant set **unconditional** forward instead of no-answer/busy — switch to conditional or after-hours-only. |

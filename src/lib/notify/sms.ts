// SMS sending via Twilio Programmable Messaging (REST API + fetch — no SDK, consistent with the
// hand-rolled inbound signature code). SERVER-ONLY: account SID/token never reach the browser.
// Never throws; returns a generic ok/reason. Provider error detail goes to server logs only.
//
// Env (server-only): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (the "from" number).

export function isSmsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      // Provider detail to logs only — never surfaced to staff.
      console.error(`[FD] delivery sms provider error (${res.status}):`, await res.text());
      return { ok: false, reason: `provider_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[FD] delivery sms send failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'exception' };
  }
}

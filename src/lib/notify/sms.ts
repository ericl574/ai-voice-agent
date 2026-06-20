// SMS sending via Twilio Programmable Messaging (REST API + fetch — no SDK, consistent with the
// hand-rolled inbound signature code). SERVER-ONLY: account SID/token never reach the browser.
// Never throws; returns a generic ok/reason. Provider error detail goes to server logs only.
//
// Env (server-only): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (the "from" number).
// Env values are trimmed before use — a stray space/newline from a pasted Vercel var would otherwise
// corrupt the Basic-auth header and surface as a Twilio 401.

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function isSmsConfigured(): boolean {
  return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_PHONE_NUMBER'));
}

/**
 * Best-effort E.164 normalization for US/Canada-style input. Twilio requires E.164 (e.g.
 * +17787985201); a bare 10-digit number like 7787985201 is rejected with a 400 (code 21211).
 *   - keeps an existing leading '+'
 *   - 10 digits → +1XXXXXXXXXX
 *   - 11 digits starting with 1 → +1XXXXXXXXXX
 * Anything else is returned digits-only with a leading '+', so Twilio can still give a clear error.
 */
export function toE164(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hadPlus) return digits ? `+${digits}` : '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

// Masked, value-free config diagnostics for the signed-in SMS test. Booleans ONLY — never a SID,
// token, or number value. Lets the owner self-diagnose a 401 (wrong/whitespaced/mis-formatted creds)
// without any secret leaving the server.
export interface SmsConfigDiagnostics {
  accountSidPresent: boolean;
  accountSidPrefixOk: boolean;    // a real Account SID starts with "AC"
  accountSidWhitespace: boolean;  // stray surrounding whitespace in the env var
  authTokenPresent: boolean;
  authTokenWhitespace: boolean;
  fromPresent: boolean;
  fromLooksE164: boolean;
}

export function smsConfigDiagnostics(): SmsConfigDiagnostics {
  const sidRaw = process.env.TWILIO_ACCOUNT_SID ?? '';
  const tokenRaw = process.env.TWILIO_AUTH_TOKEN ?? '';
  const fromRaw = process.env.TWILIO_PHONE_NUMBER ?? '';
  const sid = sidRaw.trim();
  const from = fromRaw.trim();
  return {
    accountSidPresent: !!sid,
    accountSidPrefixOk: sid.startsWith('AC'),
    accountSidWhitespace: sidRaw !== sid,
    authTokenPresent: !!tokenRaw.trim(),
    authTokenWhitespace: tokenRaw !== tokenRaw.trim(),
    fromPresent: !!from,
    fromLooksE164: /^\+[1-9]\d{7,14}$/.test(from),
  };
}

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const from = env('TWILIO_PHONE_NUMBER');
  if (!sid || !token || !from) return { ok: false, reason: 'not_configured' };

  const toNormalized = toE164(to);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toNormalized, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      // Provider detail (incl. Twilio error code — 20003 auth / 21211 bad number / 21608 unverified)
      // → server logs only; never surfaced to staff.
      console.error(`[FD] delivery sms provider error (${res.status}):`, await res.text());
      return { ok: false, reason: `provider_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[FD] delivery sms send failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'exception' };
  }
}

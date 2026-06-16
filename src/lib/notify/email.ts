// Email sending via Resend (REST API + fetch — one Bearer key, one endpoint, no SDK).
// SERVER-ONLY: the API key never reaches the browser. Never throws; returns generic ok/reason.
// Provider error detail goes to server logs only.
//
// Env (server-only): RESEND_API_KEY, NOTIFY_EMAIL_FROM (verified sender, e.g.
// "FrontDesk <alerts@yourdomain>").

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_FROM);
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM;
  if (!key || !from) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) {
      console.error(`[FD] delivery email provider error (${res.status}):`, await res.text());
      return { ok: false, reason: `provider_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[FD] delivery email send failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'exception' };
  }
}

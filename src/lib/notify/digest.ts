// After-hours daily digest — PURE composition (email summary + CSV + SMS alert).
//
// No imports on purpose so the deterministic QA runner can load it (same pattern as compose.ts).
// All network/env/DB work lives in the cron route and sms.ts/email.ts.

export interface DigestCall {
  callTimeIso: string; // calls.started_at or created_at (ISO)
  callerName: string | null;
  callerPhone: string | null;
  intent: string;
  preferredDate: string | null; // appointment.appointment_date, if captured
  preferredTime: string | null; // appointment.appointment_time, if captured
  summary: string;
  followUp: string | null; // calls.next_action
}

export interface DigestBusiness {
  name: string;
  timezone: string;
}

const INTENT_LABEL: Record<string, string> = {
  appointment_request: 'Appointment request',
  service_request: 'Service request',
  quote_request: 'Quote request',
  general_question: 'Question',
  complaint: 'Complaint',
  other: 'Call',
};

export function intentLabel(intent: string): string {
  return INTENT_LABEL[intent] ?? 'Call';
}

// Formats an ISO timestamp in the business timezone (e.g. "Jun 16, 7:42 PM"). Deterministic given
// inputs; falls back to the raw ISO if the timezone is invalid.
export function formatCallTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function csvCell(v: string | null | undefined): string {
  const s = (v ?? '').toString();
  // Quote when the cell contains a comma, quote, or newline; double internal quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Structured CSV of all captured calls — attached to the digest email for easy follow-up. */
export function buildCallsCsv(calls: DigestCall[], timezone: string): string {
  const header = [
    'Call time',
    'Caller name',
    'Caller phone',
    'Request type',
    'Preferred date',
    'Preferred time',
    'Summary',
    'Suggested follow-up',
  ];
  const rows = calls.map((c) =>
    [
      formatCallTime(c.callTimeIso, timezone),
      c.callerName ?? '',
      c.callerPhone ?? '',
      intentLabel(c.intent),
      c.preferredDate ?? '',
      c.preferredTime ?? '',
      c.summary ?? '',
      c.followUp ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...rows].join('\r\n');
}

/** One short SMS — only says the report was sent (no per-call noise). */
export function composeDigestSms(count: number): string {
  const noun = count === 1 ? 'call' : 'calls';
  return `FrontDesk captured ${count} after-hours ${noun}. Report sent to your email.`;
}

/** Readable daily email: total + a per-call summary, plus a link to Call History. */
export function composeDigestEmail(
  business: DigestBusiness,
  calls: DigestCall[],
  dashboardUrl: string,
): { subject: string; text: string; html: string } {
  const count = calls.length;
  const noun = count === 1 ? 'call' : 'calls';
  const subject = `FrontDesk after-hours report — ${count} ${noun}`;

  const intro = `While ${business.name} was closed or unavailable, FrontDesk captured ${count} ${noun} you would otherwise have missed. A CSV with all the details is attached.`;

  const blocks = calls.map((c, i) => {
    const when = formatCallTime(c.callTimeIso, business.timezone);
    const pref = [c.preferredDate, c.preferredTime].filter(Boolean).join(' ');
    const lines = [
      `${i + 1}. ${when} — ${intentLabel(c.intent)}`,
      `   Caller: ${c.callerName ?? '(not given)'}  |  Phone: ${c.callerPhone ?? '(not given)'}`,
      `   Summary: ${c.summary}`,
    ];
    if (pref) lines.push(`   Preferred: ${pref}`);
    if (c.followUp) lines.push(`   Suggested follow-up: ${c.followUp}`);
    return lines.join('\n');
  });

  const text = [
    intro,
    '',
    ...blocks.flatMap((b) => [b, '']),
    `Full call history: ${dashboardUrl}`,
    '',
    'You do not need to monitor a dashboard — this report covers everything captured.',
  ].join('\n');

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlBlocks = calls
    .map((c, i) => {
      const when = formatCallTime(c.callTimeIso, business.timezone);
      const pref = [c.preferredDate, c.preferredTime].filter(Boolean).join(' ');
      return (
        `<tr>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${i + 1}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(when)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(intentLabel(c.intent))}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(c.callerName ?? '—')}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(c.callerPhone ?? '—')}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(c.summary)}${pref ? `<br/><small>Preferred: ${esc(pref)}</small>` : ''}${c.followUp ? `<br/><small>Follow-up: ${esc(c.followUp)}</small>` : ''}</td>` +
        `</tr>`
      );
    })
    .join('');

  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#1d1d1f">` +
    `<p>${esc(intro)}</p>` +
    `<table style="border-collapse:collapse;font-size:13px"><thead><tr>` +
    ['#', 'Time', 'Type', 'Caller', 'Phone', 'Summary']
      .map((h) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd">${h}</th>`)
      .join('') +
    `</tr></thead><tbody>${htmlBlocks}</tbody></table>` +
    `<p style="margin-top:16px"><a href="${esc(dashboardUrl)}">Open full call history</a></p>` +
    `<p style="color:#86868b;font-size:12px">You don't need to monitor a dashboard — this report covers everything captured.</p>` +
    `</div>`;

  return { subject, text, html };
}

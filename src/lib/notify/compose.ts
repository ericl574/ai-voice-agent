// Call Delivery — PURE message composition + delivery-gating logic.
//
// This module has NO imports on purpose so the deterministic QA runner can load it directly
// (mirrors the vertical-profile pattern in scripts/qa-units.ts). All provider/network code and
// env reads live in sms.ts / email.ts / callDelivery.ts, never here.

// What the owner sees about one finished call. Vertical-neutral, provider-neutral.
export interface CallSummaryForDelivery {
  businessName: string;
  source: 'web' | 'phone';
  callerName: string | null;
  callerPhone: string | null;
  intent: string;
  summary: string;
  nextAction: string;
  appointment: { date: string | null; time: string | null; service: string | null } | null;
  serviceRequest: { title: string | null; urgency: string | null } | null;
  dashboardUrl: string; // absolute link to Call History
}

// Just the business fields delivery-gating needs (structurally compatible with AgentConfig).
export interface DeliveryBusiness {
  phone: string | null;
  email: string | null;
  agentConfig: {
    notify_sms?: boolean;
    notify_email?: boolean;
    notify_sms_to?: string;
    notify_email_to?: string;
  } | null;
}

export interface DeliveryPlan {
  sms: { send: boolean; to: string | null };
  email: { send: boolean; to: string | null };
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
};

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

/**
 * Decides whether to send each channel and to which destination. A channel sends only when the
 * owner enabled it AND a destination exists. Destination = the explicit override if set, else the
 * business's own phone/email. Pure: no env, no provider-configured check (that's done at send time).
 */
export function decideDelivery(b: DeliveryBusiness): DeliveryPlan {
  const cfg = b.agentConfig ?? {};
  const smsTo = clean(cfg.notify_sms_to) ?? clean(b.phone);
  const emailTo = clean(cfg.notify_email_to) ?? clean(b.email);
  return {
    sms: { send: cfg.notify_sms === true && !!smsTo, to: smsTo },
    email: { send: cfg.notify_email === true && !!emailTo, to: emailTo },
  };
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

/** Short SMS summary — kept compact (a few segments at most). */
export function composeCallSms(c: CallSummaryForDelivery): string {
  const who = c.callerName ?? 'Caller';
  const phone = c.callerPhone ? ` ${c.callerPhone}` : '';
  const parts: string[] = [`FrontDesk: new ${c.source === 'phone' ? 'phone ' : ''}call — ${who}${phone}.`];

  if (c.appointment && (c.appointment.date || c.appointment.time || c.appointment.service)) {
    const when = [c.appointment.date, c.appointment.time].filter(Boolean).join(' ');
    const svc = c.appointment.service ? c.appointment.service : 'appointment';
    parts.push(`Wants ${svc}${when ? ` ${when}` : ''} (pending).`);
  } else if (c.serviceRequest && c.serviceRequest.title) {
    const urgent = c.serviceRequest.urgency === 'urgent' ? ' [URGENT]' : '';
    parts.push(`Request: ${c.serviceRequest.title}${urgent}.`);
  } else {
    parts.push(truncate(c.summary, 140));
  }

  // Keep the whole thing within ~3 SMS segments.
  return truncate(parts.join(' '), 460);
}

/** Fuller email summary — subject + plain text (+ light HTML). */
export function composeCallEmail(c: CallSummaryForDelivery): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `New call for ${c.businessName} — ${intentLabel(c.intent)}`;

  const lines: string[] = [
    `New ${c.source === 'phone' ? 'phone ' : ''}call handled by your FrontDesk.`,
    '',
    `Caller: ${c.callerName ?? '(not given)'}`,
    `Phone: ${c.callerPhone ?? '(not given)'}`,
    `Type: ${intentLabel(c.intent)}`,
    '',
    `Summary: ${c.summary}`,
  ];

  if (c.appointment && (c.appointment.date || c.appointment.time || c.appointment.service)) {
    lines.push('', 'Appointment request (pending your confirmation):');
    if (c.appointment.service) lines.push(`  Service: ${c.appointment.service}`);
    if (c.appointment.date) lines.push(`  Date: ${c.appointment.date}`);
    if (c.appointment.time) lines.push(`  Time: ${c.appointment.time}`);
  } else if (c.serviceRequest && c.serviceRequest.title) {
    lines.push('', 'Service request (pending):');
    lines.push(`  ${c.serviceRequest.title}${c.serviceRequest.urgency === 'urgent' ? '  [URGENT]' : ''}`);
  }

  lines.push('', `Next step: ${c.nextAction}`, '', `Full details: ${c.dashboardUrl}`);

  const text = lines.join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#1d1d1f">` +
    text
      .split('\n')
      .map((l) =>
        l === ''
          ? '<br/>'
          : `<div>${esc(l).replace(/(https?:\/\/[^\s]+)/, '<a href="$1">$1</a>')}</div>`,
      )
      .join('') +
    `</div>`;

  return { subject, text, html };
}

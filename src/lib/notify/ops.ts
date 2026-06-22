// SERVER-ONLY operational alerts to the operator — distinct from customer-facing notifications.
// Sends one short SMS to OPS_ALERT_SMS_TO via the shared Twilio sender when something fails
// silently (a captured call that didn't save, a digest that failed). Design rules:
//   - No-op (logged) if OPS_ALERT_SMS_TO is unset or SMS isn't configured.
//   - Never throws; alerting must never break the flow it is watching.
//   - Per-event cooldown so one recurring failure cannot storm the operator's phone.
// The destination is the operator's own number (set as an env var), never a customer's.

import { sendSms, isSmsConfigured } from './sms.ts';

export const OPS_ALERT_COOLDOWN_MS = 5 * 60_000;
const lastSentAt = new Map<string, number>();

export interface OpsAlertInput {
  component: string;
  event: string;
  error?: unknown;
  context?: Record<string, string | number | boolean | null | undefined>;
  at?: Date;
}

export interface OpsAlertResult {
  attempted: boolean;
  sent: boolean;
  skippedReason?: 'missing_destination' | 'sms_not_configured' | 'cooldown' | 'send_failed' | 'exception';
}

function text(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

export function sanitizeSmsPart(value: unknown, max = 80): string {
  return text(value)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/AC[a-fA-F0-9]{20,}/g, '[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function opsAlertKey(input: Pick<OpsAlertInput, 'component' | 'event'>): string {
  return `${sanitizeSmsPart(input.component, 40)}:${sanitizeSmsPart(input.event, 50)}`;
}

// Operator SMS body, bounded so long error detail cannot blow past a short SMS.
export function buildOpsAlert(input: OpsAlertInput): string {
  const at = (input.at ?? new Date()).toISOString();
  const parts = [
    'FrontDesk ALERT',
    sanitizeSmsPart(input.component, 40),
    sanitizeSmsPart(input.event, 50),
    at,
  ];
  const error = sanitizeSmsPart(input.error, 90);
  if (error) parts.push(`err=${error}`);
  for (const [key, value] of Object.entries(input.context ?? {})) {
    if (value == null || value === '') continue;
    parts.push(`${sanitizeSmsPart(key, 24)}=${sanitizeSmsPart(value, 48)}`);
  }
  return parts.filter(Boolean).join(' | ').slice(0, 300);
}

// True when this event key hasn't alerted within the cooldown window. Pure given the map + clock.
export function dueForAlert(
  key: string,
  now: number,
  last: Map<string, number>,
  cooldownMs: number = OPS_ALERT_COOLDOWN_MS,
): boolean {
  const prev = last.get(key);
  return prev === undefined || now - prev >= cooldownMs;
}

export function markAlertSent(key: string, now: number, last: Map<string, number>): void {
  last.set(key, now);
}

export async function notifyOps(input: OpsAlertInput): Promise<OpsAlertResult> {
  try {
    const to = (process.env.OPS_ALERT_SMS_TO ?? '').trim();
    if (!to) {
      console.warn(`[FD] ops alert skipped (OPS_ALERT_SMS_TO unset): ${input.component}/${input.event}`);
      return { attempted: false, sent: false, skippedReason: 'missing_destination' };
    }
    if (!isSmsConfigured()) {
      console.warn(`[FD] ops alert skipped (Twilio not configured): ${input.component}/${input.event}`);
      return { attempted: false, sent: false, skippedReason: 'sms_not_configured' };
    }
    const now = Date.now();
    const key = opsAlertKey(input);
    if (!dueForAlert(key, now, lastSentAt)) {
      return { attempted: false, sent: false, skippedReason: 'cooldown' };
    }
    markAlertSent(key, now, lastSentAt);
    const r = await sendSms(to, buildOpsAlert(input));
    console.log(`[FD] ops alert "${key}" -> ${r.ok ? 'sent' : 'failed'}${r.reason ? ` (${r.reason})` : ''}`);
    return r.ok
      ? { attempted: true, sent: true }
      : { attempted: true, sent: false, skippedReason: 'send_failed' };
  } catch (err) {
    // Alerting must never throw into the watched path.
    console.error('[FD] ops alert threw (non-fatal):', err instanceof Error ? err.message : err);
    return { attempted: false, sent: false, skippedReason: 'exception' };
  }
}

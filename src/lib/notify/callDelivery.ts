// Call Delivery orchestrator — sends the post-call SMS + email to the business and logs every
// attempt. Called from the shared post-call core (src/lib/call-pipeline/postCallCore.ts) so both
// browser and Twilio phone calls deliver identically. SERVER-ONLY.
//
// Guarantees relied on by the caller:
//   • Never throws — the caller still wraps it, but each channel is independently caught here too.
//   • The save has already happened before this runs, so delivery can never affect it.
//   • Demo calls never reach the post-call core, so they never reach delivery.

import { SITE_URL } from '@/lib/site';
import type { ExtractionResult } from '@/lib/call-pipeline/extraction';
import type { AgentConfig } from '@/lib/supabase/businesses';
import {
  decideDelivery,
  composeCallSms,
  composeCallEmail,
  type CallSummaryForDelivery,
  type DeliveryBusiness,
} from './compose';
import { sendSms, isSmsConfigured } from './sms';
import { sendEmail, isEmailConfigured } from './email';

export interface DeliverInput {
  business: {
    name: string | null;
    phone: string | null;
    email: string | null;
    agentConfig: AgentConfig | null;
  };
  source: 'web' | 'phone';
  extraction: ExtractionResult;
}

export interface DeliveryOutcome {
  sms: 'sent' | 'failed' | 'skipped' | 'disabled';
  email: 'sent' | 'failed' | 'skipped' | 'disabled';
}

function toSummary(input: DeliverInput): CallSummaryForDelivery {
  const e = input.extraction;
  return {
    businessName: input.business.name ?? 'your business',
    source: input.source,
    callerName: e.caller_name ?? null,
    callerPhone: e.caller_phone ?? null,
    intent: e.intent,
    summary: e.summary,
    nextAction: e.next_action,
    appointment: e.appointment?.should_create
      ? {
          date: e.appointment.requested_date ?? null,
          time: e.appointment.requested_time ?? null,
          service: e.appointment.service ?? null,
        }
      : null,
    serviceRequest: e.service_request?.should_create
      ? { title: e.service_request.title ?? null, urgency: e.service_request.urgency ?? null }
      : null,
    dashboardUrl: `${SITE_URL.replace(/\/$/, '')}/dashboard/calls`,
  };
}

/**
 * Delivers the call result to the business by SMS and/or email per its settings. Each channel:
 *   disabled  — owner toggle off or no destination
 *   skipped   — owner enabled it, but this deployment has no provider env vars set
 *   sent/failed — a real attempt was made
 * Every outcome is logged. Returns the outcome; never throws.
 */
export async function deliverCallNotifications(input: DeliverInput): Promise<DeliveryOutcome> {
  const biz: DeliveryBusiness = {
    phone: input.business.phone,
    email: input.business.email,
    agentConfig: input.business.agentConfig,
  };
  const plan = decideDelivery(biz);
  const summary = toSummary(input);
  const outcome: DeliveryOutcome = { sms: 'disabled', email: 'disabled' };

  // ── SMS ──────────────────────────────────────────────────────────────────
  if (plan.sms.send && plan.sms.to) {
    if (!isSmsConfigured()) {
      outcome.sms = 'skipped';
      console.warn('[FD] delivery sms skipped — provider not configured (TWILIO_* env missing)');
    } else {
      const r = await sendSms(plan.sms.to, composeCallSms(summary));
      outcome.sms = r.ok ? 'sent' : 'failed';
      console.log(`[FD] delivery sms → ${outcome.sms}${r.reason ? ` (${r.reason})` : ''}`);
    }
  }

  // ── Email ────────────────────────────────────────────────────────────────
  if (plan.email.send && plan.email.to) {
    if (!isEmailConfigured()) {
      outcome.email = 'skipped';
      console.warn('[FD] delivery email skipped — provider not configured (RESEND_* env missing)');
    } else {
      const { subject, text, html } = composeCallEmail(summary);
      const r = await sendEmail(plan.email.to, subject, text, html);
      outcome.email = r.ok ? 'sent' : 'failed';
      console.log(`[FD] delivery email → ${outcome.email}${r.reason ? ` (${r.reason})` : ''}`);
    }
  }

  if (outcome.sms === 'disabled' && outcome.email === 'disabled') {
    console.log('[FD] delivery: no channels enabled for this business — nothing sent');
  }

  return outcome;
}

import type { AgentConfig, Business } from '@/lib/supabase/businesses';
import type { KnowledgeRow, VerticalProfile } from './types';
import { GLOBAL_RULES } from './globalRules';
import { getVertical } from '../verticals/registry';
import { todayInTimeZone, nowInTimeZone } from '@/lib/call-pipeline/time';

// Renders the selected vertical profile into a concise prompt section. Industry-specific
// terminology and examples live ONLY here (via the profile), never in GLOBAL_RULES.
function renderVerticalSection(profile: VerticalProfile): string {
  return `VERTICAL PROFILE — ${profile.label}:
${profile.description}
Common caller intents: ${profile.commonIntents.join(', ')}.
Terminology: ${profile.terminology}
Interpret these the way this business means them: ${profile.interpretationExamples.join('; ')}.
When collecting details: ${profile.collectionPriorities}
Do not assume: ${profile.forbiddenAssumptions.join('; ')}.
When the relevant info is missing: ${profile.fallbackWording}
Typical knowledge topics for this business: ${profile.knowledgeCategories.join(', ')}.`;
}

// Renders the OWNER-SELECTED configuration. The owner's saved arrays are the source of truth;
// when a list is empty/unset, fall back to the vertical's suggested defaults so the agent is
// always grounded. Tone combines preset tags + any free-form custom tone the owner typed.
function renderProfileConfigSection(
  profile: VerticalProfile,
  agentConfig: AgentConfig | null,
): string {
  // Defensive: also subtract any owner ×-deleted (hidden) chips. They can't normally reach the
  // saved selected array, but this guarantees a hidden chip never appears in the prompt.
  const notHidden = (hidden?: string[]) => (item: string) =>
    !(hidden ?? []).some((h) => h.toLowerCase() === item.toLowerCase());

  const requestTypes = (agentConfig?.main_request_types?.length
    ? agentConfig.main_request_types
    : profile.suggestedRequestTypes
  ).filter(notHidden(agentConfig?.hidden_request_types));
  const detailFields = (agentConfig?.details_to_collect?.length
    ? agentConfig.details_to_collect
    : profile.suggestedDetailFields
  ).filter(notHidden(agentConfig?.hidden_details_to_collect));
  const toneList = (agentConfig?.tone_tags ?? []).filter(notHidden(agentConfig?.hidden_tone_tags));
  const presetTone = toneList.length ? toneList.join(', ') : '';
  const customTone = agentConfig?.custom_tone?.trim() ?? '';
  const toneLine = [presetTone, customTone].filter(Boolean).join('; ') || agentConfig?.tone || 'friendly, calm';

  return `OWNER-SELECTED PROFILE CONFIG (source of truth — follow this over any vertical default):
Business type: ${profile.label}
Request types this front desk should handle:
${requestTypes.map((r) => `- ${r}`).join('\n')}
Details to collect when action is needed:
${detailFields.map((d) => `- ${d}`).join('\n')}
Tone: ${toneLine}

- Use the owner-selected request types and details above as the source of truth for what this front desk handles and asks for.
- If the caller asks for something outside these request types and not covered by the knowledge base, do not invent it — offer to note it for the team, or ask one short clarifying question.`;
}

// Builds the full system prompt for a live Realtime session:
//   core universal rules + vertical profile + business identity + agent settings + KB + owner notes.
// A null business (signed-out / missing profile) resolves to the generic vertical so the agent
// stays safe and low-inference rather than guessing an industry.
export function buildSystemPrompt(
  business: Business | null,
  agentConfig: AgentConfig | null,
  knowledge: KnowledgeRow[],
  // Used only when there is no business (e.g. the public landing "try our service" demo, where the
  // visitor picks a service type). Lets a signed-out session adopt a vertical-specific prompt
  // instead of always falling back to generic. Ignored when `business` is provided.
  verticalOverride?: string | null,
): string {
  const profile = getVertical(business?.business_type ?? verticalOverride);
  const verticalSection = renderVerticalSection(profile);
  const profileConfigSection = renderProfileConfigSection(profile, agentConfig);

  if (!business) {
    return `You are the front desk voice assistant for a service business.

${GLOBAL_RULES}

${verticalSection}

${profileConfigSection}`.trim();
  }

  const name = business.name;
  const hours = agentConfig?.business_hours || 'not specified — let the caller know staff can confirm';
  const walkin = agentConfig?.walk_in_allowed ?? false;
  const requiresConfirmation = agentConfig?.appointments_require_confirmation ?? true;
  const autoConfirm = agentConfig?.reservation_confirmation_mode === 'auto';
  const callbackExp = agentConfig?.callback_expectation || 'staff will follow up during business hours';
  const handoffRule = agentConfig?.staff_handoff_rule || 'Escalate urgent, angry, or complex calls to staff.';

  const knowledgeLines =
    knowledge.length > 0
      ? knowledge.map((k) => `- [${k.category}] ${k.question}: ${k.answer}`).join('\n')
      : '(none provided — do not invent answers; offer to have staff follow up)';

  const customSection = agentConfig?.custom_instructions?.trim()
    ? `\nCUSTOM INSTRUCTIONS:\n${agentConfig.custom_instructions}`
    : '';

  return `You are the front desk voice assistant for ${name}${business.business_type ? `, a ${business.business_type.replace('_', ' ')} business` : ''}.

${GLOBAL_RULES}

${verticalSection}

${profileConfigSection}

BUSINESS INFO:
Name: ${name}
${business.phone ? `Phone: ${business.phone}` : ''}
${business.city ? `Location: ${business.city}${business.region ? ', ' + business.region : ''}` : ''}
Timezone: ${business.timezone}
Today (business timezone): ${todayInTimeZone(business.timezone)}
Current local time (business timezone): ${nowInTimeZone(business.timezone)} (${business.timezone})
Hours: ${hours}
${walkin ? 'Walk-ins: Welcome.' : 'Appointments: Preferred. Walk-ins subject to availability.'}

CURRENT TIME — use the "Current local time" above as the present moment for this call:
- It is the current business-local time. Use it for "now", "today", and same-day checks. Never ask the caller what time or date it is — you already know.
- If the caller asks for a time earlier today than the current local time, tell them that time has already passed and offer a later time; do this BEFORE collecting party size, name, or phone.
- Still respect the business hours above (don't accept times when the business is closed).

APPOINTMENTS:
${autoConfirm
    ? 'After collecting the reservation details, tell the caller you will text them a link to confirm their reservation by adding a card on file, and that the reservation is held until they complete that step. NEVER ask for or collect credit card details on this call — the card is added securely through the texted link only.'
    : requiresConfirmation
      ? 'NEVER confirm appointments yourself. Always say staff will confirm and provide the callback expectation.'
      : 'You may acknowledge appointment requests.'}
Callback expectation: ${callbackExp}

ESCALATION:
${handoffRule}

KNOWLEDGE BASE (Layer 2 — Q&A):
${knowledgeLines}
${customSection}`.trim();
}

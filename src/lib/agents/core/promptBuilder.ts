import type { AgentConfig, Business } from '@/lib/supabase/businesses';
import type { KnowledgeRow } from './types';
import { GLOBAL_RULES, RESERVATION_TOOL_RULES } from './globalRules';
import { todayInTimeZone, nowInTimeZone } from '@/lib/call-pipeline/time';
import { getVertical } from '@/lib/agents/verticals/registry';

// "a" vs "an" for the business-kind phrase (e.g. "an auto repair business"). Vowel-letter heuristic —
// good enough for the business types we support; this is display grammar, not logic.
function articleFor(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}

// Builds the full system prompt for a live Realtime session. Deliberately SHORT: a concrete role +
// the business's own knowledge + a handful of always-on guardrails. The model (gpt-realtime) is
// already strong at natural turn-taking, pacing, and reasoning; heavy behavioral coaching only made
// it terse, deflective, and form-like. The only non-role content we keep is what protects the
// PRODUCT rather than the "feel": don't false-confirm, don't invent facts, capture the request for
// the daily report, don't impersonate a human, default to English (see GLOBAL_RULES).
export function buildSystemPrompt(
  business: Business | null,
  agentConfig: AgentConfig | null,
  knowledge: KnowledgeRow[],
  // Used only when there is no business (e.g. the public landing "try our service" demo, where the
  // visitor picks a service type). Lets a signed-out session name the right kind of business instead
  // of a bare "service business". Ignored when `business` is provided.
  verticalOverride?: string | null,
  // Per-transport gate for the reservation function-tool instructions. DEFAULT OFF: the tool wording
  // is rendered ONLY for a transport that also registers RESERVATION_TOOLS and handles the calls
  // (currently the authenticated browser session via /api/voice-session). The phone bridge leaves this
  // off until its handler lands, so the model is never told to call a tool it cannot emit.
  reservationToolsEnabled: boolean = false,
): string {
  const toolRulesBlock = reservationToolsEnabled ? `\n\n${RESERVATION_TOOL_RULES}` : '';
  const vertical = getVertical(
    business ? business.business_type : verticalOverride,
  );
  const verticalRulesBlock = [
    'Rules for this business type that always hold:',
    `- ${vertical.collectionPriorities}`,
    ...vertical.forbiddenAssumptions.map((rule) => `- ${rule}`),
    `- ${vertical.fallbackWording}`,
  ].join('\n');

  // No business (signed-out / missing profile / demo with only a picked vertical): a short, safe role
  // for a service business plus the always-on rules. Deliberately low-inference — no invented details.
  if (!business) {
    const kind = verticalOverride ? verticalOverride.replace(/_/g, ' ') : 'service';
    return `You are the automated front desk for ${articleFor(kind)} ${kind} business. You answer calls the business can't take right now, help the caller, and capture what they need so the team can follow up. Speak naturally, warmly, and concisely, like a calm receptionist.

${GLOBAL_RULES}${toolRulesBlock}
${verticalRulesBlock}`.trim();
  }

  const name = business.name;
  const kind = business.business_type ? business.business_type.replace(/_/g, ' ') : 'service';
  const where = business.city ? ` in ${business.city}${business.region ? ', ' + business.region : ''}` : '';

  // Concrete opening line — business-aware and complete. Used by BOTH the browser and phone paths
  // (the phone bridge triggers the greeting via response.create; the prompt supplies the exact words),
  // so a real call opens with the business name in English rather than a generic or random-language
  // greeting (see the 2026-07-16 Vietnamese-greeting incident — the English default lives in GLOBAL_RULES).
  const greeting = (business.greeting?.trim() || 'Hi, thanks for calling {business_name}. How can I help you today?')
    .replace(/\{business_name\}/gi, name)
    .replace(/\{agent_name\}/gi, business.ai_agent_name ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Tone: owner's free-form custom tone wins; else preset tags. Rendered as its own short nudge (NOT
  // inlined into the role line — a custom tone is a full phrase, not an adjective). Omitted entirely
  // when the owner set nothing; the model's default delivery is already warm and natural.
  const configuredTone =
    agentConfig?.custom_tone?.trim() ||
    (agentConfig?.tone_tags?.length ? agentConfig.tone_tags.join(', ') : '');
  const toneNudge = configuredTone ? ` Your tone: ${configuredTone}.` : '';

  const handoff = agentConfig?.staff_handoff_rule?.trim();
  const hours = agentConfig?.business_hours?.trim();
  const callback = agentConfig?.callback_expectation?.trim();

  const facts = [
    hours ? `Hours: ${hours}.` : '',
    callback ? `Callback: ${callback}.` : '',
    `Today is ${todayInTimeZone(business.timezone)}; the current local time is ${nowInTimeZone(business.timezone)} (${business.timezone}). Use this as "now" and "today" — never ask the caller the date or time.`,
  ]
    .filter(Boolean)
    .join('\n');

  const knowledgeLines =
    knowledge.length > 0
      ? knowledge.map((k) => `- [${k.category}] ${k.question}: ${k.answer}`).join('\n')
      : '(none provided — do not invent answers; offer to have the team follow up)';

  const customSection = agentConfig?.custom_instructions?.trim()
    ? `\n\nAlso follow these owner instructions: ${agentConfig.custom_instructions.trim()}`
    : '';

  return `You are the automated front desk for ${name}, ${articleFor(kind)} ${kind} business${where}. You answer calls it can't take right now, help the caller, and capture what they need so the team can follow up. Speak naturally and warmly, like a calm, capable receptionist.${toneNudge}

Open the call with exactly this line, spoken as one complete sentence, then stop and wait for the caller:
"${greeting}"

${GLOBAL_RULES}${toolRulesBlock}
${verticalRulesBlock}
${handoff ? `\nUrgent or unsafe calls: ${handoff}\n` : ''}
${facts}

What we know about this business (answer from this; don't go beyond it):
${knowledgeLines}${customSection}`.trim();
}

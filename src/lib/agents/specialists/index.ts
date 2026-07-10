// Specialist composition. The caller experiences ONE smooth front desk; these are internal modes the
// agent moves between silently. Composed here into a single additive prompt section consumed by
// buildSystemPrompt — so the browser and Twilio paths share identical specialist behavior.

import { ROUTER_PLAYBOOK } from './router';
import { BOOKING_PLAYBOOK } from './booking';
import { FAQ_PLAYBOOK } from './faq';
import { ESCALATION_PLAYBOOK } from './escalation';

export { ROUTER_PLAYBOOK, BOOKING_PLAYBOOK, FAQ_PLAYBOOK, ESCALATION_PLAYBOOK };

export function renderSpecialistPlaybooks(): string {
  return `SPECIALIST PLAYBOOKS — you are ONE front desk to the caller. These are internal modes you move between SILENTLY based on what the caller needs. Never mention them, never say you are transferring, and never say "another agent". Keep every reply short and phone-natural, ask one thing at a time, and never repeat a question the caller already answered.

${ROUTER_PLAYBOOK}

${BOOKING_PLAYBOOK}

${FAQ_PLAYBOOK}

${ESCALATION_PLAYBOOK}`;
}

import type { AgentConfig, Business } from '@/lib/supabase/businesses';
import type { KnowledgeRow } from './core/types';

// Static demo businesses for the public landing "Try our service" call. Each entry gives the agent
// a believable, service-appropriate identity so the live demo never leaks the visitor's real
// account and never mixes verticals (e.g. a clinic must not talk about takeout). Data only — the
// prompt is assembled by buildSystemPrompt using the matching vertical profile.

export interface DemoBusiness {
  business: Business;
  agentConfig: AgentConfig;
  knowledge: KnowledgeRow[];
}

// Fill the required Business fields with demo-safe values. `business_type` drives the vertical.
function makeBusiness(
  business_type: string,
  name: string,
  fields: Partial<Business>,
): Business {
  return {
    id: `demo-${business_type}`,
    name,
    business_type,
    phone: null,
    email: null,
    city: null,
    region: null,
    timezone: 'America/Vancouver',
    ai_agent_name: null,
    greeting: null,
    agent_config: null,
    created_by: 'demo',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...fields,
  };
}

function k(category: string, question: string, answer: string): KnowledgeRow {
  return { id: `${category}-${question}`.slice(0, 40), category, question, answer };
}

const DEMO: Record<string, DemoBusiness> = {
  restaurant: {
    business: makeBusiness('restaurant', 'Bella Notte Ristorante', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Tue–Sun 5:00pm–10:00pm, closed Mondays',
      callback_expectation: "you'll receive a callback within 2 hours to confirm",
    },
    knowledge: [
      k('Reservations', 'Do you take reservations?', 'Yes — for parties of any size, subject to staff confirmation.'),
      k('Menu', 'Do you have vegetarian options?', 'Yes, we have several vegetarian and gluten-free dishes.'),
      k('Takeout', 'Do you offer takeout?', 'Yes, takeout is available during opening hours.'),
    ],
  },
  auto_repair: {
    business: makeBusiness('auto_repair', 'Summit Auto Care', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Mon–Fri 8:00am–6:00pm, Sat 9:00am–2:00pm',
      callback_expectation: 'a service advisor will call you back within the hour',
    },
    knowledge: [
      k('Services', 'What services do you offer?', 'Oil changes, brakes, diagnostics, tires, and general repairs.'),
      k('Booking', 'Do I need an appointment?', 'Appointments are preferred; drop-offs are welcome subject to availability.'),
      k('Estimates', 'Can I get a quote?', 'We provide an estimate after a quick inspection — staff will follow up.'),
    ],
  },
  salon: {
    business: makeBusiness('salon', 'Luxe Hair & Spa', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Tue–Sat 9:00am–7:00pm',
      callback_expectation: "we'll text or call to confirm your appointment",
    },
    knowledge: [
      k('Services', 'What services do you offer?', 'Haircuts, color, styling, manicures, and facials.'),
      k('Booking', 'How do I book?', 'Let us know the service and a preferred time and the team will confirm.'),
      k('Stylists', 'Can I request a specific stylist?', 'Yes — name your preferred stylist and we will note it.'),
    ],
  },
  clinic: {
    business: makeBusiness('clinic', 'Lakeside Family Clinic', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Mon–Fri 8:30am–5:00pm',
      callback_expectation: 'a team member will follow up to confirm your visit',
    },
    knowledge: [
      k('Services', 'What do you offer?', 'Checkups, cleanings, and routine visits. We keep guidance general and non-diagnostic.'),
      k('Booking', 'How do I book a visit?', 'Share your name, reason for the visit, and a preferred time; staff will confirm.'),
      k('Insurance', 'Do you take my insurance?', 'Coverage is confirmed by our team — we will note your provider and follow up.'),
    ],
  },
  tutoring: {
    business: makeBusiness('tutoring', 'BrightPath Tutoring Center', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Mon–Fri 3:00pm–8:00pm, Sat 10:00am–3:00pm',
      callback_expectation: "we'll follow up to confirm a session time",
    },
    knowledge: [
      k('Subjects', 'What subjects do you tutor?', 'Math, sciences, English, and test prep for K–12 and college.'),
      k('Booking', 'How do sessions work?', 'Tell us the subject, level, and preferred time and the team will arrange it.'),
      k('Format', 'Do you offer online tutoring?', 'Yes — both in-person and online sessions are available.'),
    ],
  },
  home_services: {
    business: makeBusiness('home_services', 'HomePro Services', { city: 'Vancouver', region: 'BC' }),
    agentConfig: {
      business_hours: 'Mon–Sat 7:00am–7:00pm',
      callback_expectation: 'a technician or coordinator will call you back shortly',
    },
    knowledge: [
      k('Services', 'What services do you provide?', 'Plumbing, electrical, HVAC, and general home repairs.'),
      k('Booking', 'How do I schedule a visit?', 'Describe the issue and a preferred time; we will confirm a technician.'),
      k('Emergencies', 'Do you handle emergencies?', 'Urgent issues are flagged to staff for the fastest possible callback.'),
    ],
  },
};

// Returns the demo business for a vertical, or null for unknown/unsupported values (caller falls
// back to a generic vertical prompt).
export function getDemoBusiness(vertical: string | null | undefined): DemoBusiness | null {
  if (!vertical) return null;
  return DEMO[vertical] ?? null;
}

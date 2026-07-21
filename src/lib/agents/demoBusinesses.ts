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
    business: makeBusiness('restaurant', 'Bella Notte Ristorante', {
      city: 'Vancouver',
      region: 'BC',
      ai_agent_name: 'Sofia',
      greeting: 'Thanks for calling Bella Notte Ristorante, this is Sofia — how can I help you this evening?',
    }),
    agentConfig: {
      business_hours: 'Tue–Sun 5:00pm–10:00pm, closed Mondays',
      callback_expectation: 'the team will call you back within 2 hours to confirm your reservation',
      walk_in_allowed: true,
      tone_tags: ['friendly', 'warm', 'welcoming'],
      custom_tone: 'warm and gracious, like a friendly host who knows the menu by heart and loves helping guests choose',
      voice_id: 'coral',
      voice_speed: 1.0,
    },
    knowledge: [
      // Menu — the open "what do you have?" question must land well
      k('Menu', 'What kind of food do you serve or what is on the menu?', 'We are an Italian restaurant. To start, antipasti like bruschetta, calamari, and burrata; then house-made pastas such as spaghetti carbonara, lasagna, and mushroom risotto; wood-fired pizzas; and mains like chicken parmigiana, braised short rib, and pan-seared salmon. For dessert, tiramisu and gelato.'),
      k('Menu', 'How much are your dishes or entrees?', 'Pastas run about $22 to $28, pizzas $19 to $24, and mains $28 to $42. Antipasti are around $14 to $18.'),
      k('Menu', 'What do you recommend or what is popular?', 'Guests love the spaghetti carbonara, the braised short rib, and the burrata to start.'),
      k('Menu', 'Do you have a kids menu?', 'Yes, we have a kids menu with simple pasta and pizza.'),
      k('Menu', 'What is on the dessert menu?', 'Tiramisu, gelato, panna cotta, and a warm chocolate tortino.'),
      // Dietary
      k('Dietary', 'Do you have vegetarian or vegan options?', 'Yes — several vegetarian dishes like the mushroom risotto and margherita pizza, and we can make a number of dishes vegan; just let the server know.'),
      k('Dietary', 'Do you have gluten-free options?', 'Yes, we offer gluten-free pasta and several gluten-free mains.'),
      k('Dietary', 'Can you handle food allergies?', 'Yes, please tell us the allergy when you order and the kitchen will accommodate wherever possible.'),
      // Reservations
      k('Reservations', 'Do you take reservations?', 'Yes, for parties of any size. I can take your name, date, time, and party size, and the team confirms.'),
      k('Reservations', 'Can you seat a large group?', 'For parties of 8 or more we take it as a request and the manager confirms; a set menu may apply for larger groups.'),
      k('Reservations', 'Do you take walk-ins?', 'Yes, walk-ins are welcome, though on weekends a reservation is a good idea.'),
      k('Reservations', 'Can I request a special occasion setup?', 'Absolutely — mention a birthday or anniversary with your reservation and we can add a candle to a dessert.'),
      // Hours & Location
      k('Hours', 'What are your hours?', 'We are open Tuesday through Sunday, 5pm to 10pm, and closed Mondays.'),
      k('Location', 'Where are you located and is there parking?', 'We are in downtown Vancouver. There is metered street parking and a paid lot around the corner.'),
      k('Location', 'Are you wheelchair accessible?', 'Yes, the restaurant is fully wheelchair accessible.'),
      // Service options
      k('Takeout', 'Do you offer takeout or delivery?', 'Yes, takeout for pickup during opening hours, and delivery through the usual delivery apps.'),
      k('Dress Code', 'Is there a dress code?', 'Smart casual — there is no formal dress code.'),
      // Drinks & Payment
      k('Drinks', 'Do you have a wine list or bar?', 'Yes, a full Italian wine list plus cocktails and a small beer selection.'),
      k('Drinks', 'Do you allow corkage?', 'Yes, corkage is $25 per bottle.'),
      k('Specials', 'Do you have any specials or happy hour?', 'We have a daily aperitivo from 5 to 6pm with discounted small plates and wine.'),
      k('Payment', 'What payment do you accept?', 'All major credit cards, debit, and cash.'),
      // Private events
      k('Private Events', 'Can you host private events or parties?', 'Yes, we host private events and can seat up to 40 guests in our back room. The events team will follow up to plan the details.'),
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
  // The flagship demo business — deliberately deep. This is what "a well-configured FrontDesk"
  // sounds like: a real persona, real price ranges, real service area, and genuine emergency triage
  // (including "what to do while you wait"). Owners hear competence, not a form. Prices are realistic
  // demo values for a Vancouver plumbing/heating shop, not a real quote.
  home_services: {
    business: makeBusiness('home_services', 'Cascade Plumbing & Heating', {
      city: 'Vancouver',
      region: 'BC',
      ai_agent_name: 'Riley',
      greeting: 'Thanks for calling Cascade Plumbing and Heating, this is Riley — what can I help you with today?',
    }),
    agentConfig: {
      business_hours: 'Mon–Sat 7:00am–7:00pm; 24/7 emergency line outside those hours',
      callback_expectation: 'the team will call you right back to lock in the visit and the exact arrival window',
      staff_handoff_rule: 'If someone smells gas, has active flooding, or is in any unsafe situation, tell them how to get safe first, then get it to the on-call technician immediately as an emergency.',
      walk_in_allowed: false,
      tone_tags: ['friendly', 'reassuring', 'professional'],
      custom_tone: 'warm, calm, and genuinely helpful — like a seasoned dispatcher who has seen every plumbing disaster and instantly puts the caller at ease',
      voice_id: 'coral',
      voice_speed: 1.0,
    },
    knowledge: [
      // Services
      k('Services', 'What services do you offer?', 'We do residential plumbing and heating — leak and pipe repair, drain cleaning, water heater repair and replacement, faucets, toilets and fixtures, sump pumps, plus furnace and boiler repair, tune-ups, and replacement. We do not do new construction or septic systems.'),
      k('Services', 'Do you handle clogged or slow drains?', 'Yes — we snake and hydro-jet kitchen, bathroom, and main lines. A basic drain snake starts around $150, and a main-line hydro-jet is usually $350 to $600 depending on access.'),
      k('Services', 'Can you replace a water heater?', 'Yes. A standard 40 to 50 gallon tank runs about $1,400 to $2,200 installed, and a tankless unit is $3,500 to $5,500 depending on the model and venting. A straight tank swap can often be done same day or next day.'),
      k('Services', 'Do you service tankless water heaters?', 'Yes — repair, descaling, and replacement for the main brands like Navien, Rinnai, and Noritz.'),
      k('Services', 'Do you do furnace or heating repair?', 'Yes, gas and electric furnaces and boilers — repair, tune-ups, and full replacement. There is a $120 diagnostic fee that we credit toward the repair if you go ahead.'),
      k('Services', 'Do you install toilets, faucets, or fixtures?', 'Yes, whether you have already bought the fixture or want us to supply it. A standard toilet install is about $250 to $400 plus the fixture.'),
      k('Services', 'Do you do gas line work?', 'Basic gas hookups for water heaters and furnaces, yes. A full gas-line run we would assess on site, and some require a permit — the team will walk you through it.'),
      // Pricing Policy
      k('Pricing Policy', 'Is there a fee for an estimate?', 'For repairs there is a $120 diagnostic and service-call fee, and we credit it toward the work if you go ahead. Quotes for a replacement, like a new water heater or furnace, are free.'),
      k('Pricing Policy', 'How much is a service call?', 'Our standard service call is $120 and it is credited to the repair. An after-hours emergency call-out is $180.'),
      k('Pricing Policy', 'Do your quotes include parts?', 'Quotes cover labor, and parts are itemized and approved with you before we start — we never do work you have not okayed.'),
      k('Pricing Policy', 'Do you offer financing?', 'Yes, on larger jobs like a water heater or furnace replacement — zero percent for 12 months on approved credit through our financing partner.'),
      k('Pricing Policy', 'What payment methods do you take?', 'Credit and debit, e-transfer, and cash. Payment is due when the work is done, and financing is available on the bigger jobs.'),
      // Service Area
      k('Service Area', 'What areas do you serve?', 'Vancouver, Burnaby, Richmond, North and West Vancouver, and New Westminster. We can sometimes reach Coquitlam or Surrey — the team would confirm timing for those.'),
      k('Service Area', 'Is there a trip charge outside Vancouver?', 'Within our core area there is no trip charge. Out at the edges, like Coquitlam or Surrey, there may be a small trip fee and the team will confirm it.'),
      // Booking
      k('Booking', 'How soon can you come out?', 'For non-urgent work we are usually booking within one to two business days, and urgent issues we try to reach the same day. I can take your details and the team will confirm the exact window.'),
      k('Booking', 'What are your arrival windows?', 'We book a morning window, 8 to 12, or an afternoon window, 12 to 5, and the technician calls about 30 minutes before they arrive.'),
      k('Booking', 'Can I book an exact time?', 'I can note your preferred window, and the team pins down the exact time when they call you back to confirm.'),
      k('Booking', 'Do I need to be home for the visit?', 'Yes, someone 18 or older needs to be there to give access and approve the work.'),
      // Emergency Policy
      k('Emergency Policy', 'Do you handle emergencies or after-hours calls?', 'Yes, 24/7 for true emergencies — burst pipes, major leaks, flooding, sewage backups, and no heat in winter. The after-hours emergency call-out is $180 plus parts and labor.'),
      k('Emergency Policy', 'What counts as an emergency?', 'Active flooding, a burst or gushing pipe, sewage backing up, no heat in freezing weather, or a gas smell. For a gas smell, get out and call 911 or the gas utility first.'),
      k('Emergency Policy', 'A pipe burst and water is flooding, what do I do right now?', 'Shut off your main water valve if you safely can — it is usually where the water line enters the house, near the street-side wall, the garage, or the basement; turn it clockwise to close it. Then I will get an emergency technician routed to you right away.'),
      k('Emergency Policy', 'I smell gas, what should I do?', 'Please leave the house now, do not touch any light switches, and once you are outside call 911 or the FortisBC emergency line. When you are safe, call us back and we will help with the repair.'),
      k('Emergency Policy', 'My water heater is leaking, what should I do?', 'Close the cold water valve on top of the tank, and if it is gas turn the control knob to off, or flip the breaker if it is electric. Then we will get someone out to you.'),
      k('Emergency Policy', 'It is winter and I have no heat, can you help today?', 'Yes, no heat in cold weather is a priority for us, especially with kids or seniors in the home. I will take your details and get you flagged for the soonest possible visit.'),
      // Warranty
      k('Warranty', 'Do you warranty your work?', 'Yes — one year on our labor, and we honor the manufacturer warranty on the parts and equipment we install, which is often 6 to 12 years on water heaters.'),
      k('Warranty', 'Are you licensed and insured?', 'Yes, we are fully licensed and insured, and WorkSafe BC covered.'),
      // Hours
      k('Hours', 'What are your hours?', 'Our office hours are Monday to Saturday, 7am to 7pm, and we run a 24/7 emergency line outside of those hours.'),
      k('Hours', 'Are you open on weekends?', 'Saturdays yes, 7 to 7. Sundays we are emergency-only.'),
    ],
  },
};

// Returns the demo business for a vertical, or null for unknown/unsupported values (caller falls
// back to a generic vertical prompt).
export function getDemoBusiness(vertical: string | null | undefined): DemoBusiness | null {
  if (!vertical) return null;
  return DEMO[vertical] ?? null;
}

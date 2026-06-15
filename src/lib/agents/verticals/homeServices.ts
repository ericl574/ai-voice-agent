import type { VerticalProfile } from '../core/types';

export const homeServicesProfile: VerticalProfile = {
  id: 'home_services',
  label: 'Home Services',
  description: 'A home services business (plumbing, electrical, HVAC, handyman, etc.) booking repairs, installations, and quotes.',
  commonIntents: [
    'repair', 'installation', 'quote', 'emergency issue',
    'scheduling', 'service area',
  ],
  terminology: 'Talk about jobs, repairs, installations, and visits to the customer\'s location. A "booking" means a scheduled service visit.',
  knowledgeCategories: ['Services', 'Service Area', 'Booking', 'Emergency Policy', 'Pricing Policy', 'Hours', 'Warranty'],
  interpretationExamples: [
    '"sink leaking", "need installation", "repair", "no hot water", "outlet not working" = a service request',
    'A described problem at a location = the job; an urgent/flooding/no-power situation = a possible emergency',
  ],
  collectionPriorities: 'Collect the issue/job, the service location (and confirm it is in the service area), preferred time, name, and phone. Flag emergencies for staff.',
  requiredFields: ['name', 'service'],
  optionalFields: ['phone', 'date', 'time'],
  forbiddenAssumptions: [
    'Do not quote prices or costs unless they are provided in the knowledge base',
    'Do not promise same-day service or specific arrival windows unless provided',
  ],
  fallbackWording: 'For pricing, availability, or whether a location is in the service area, say the team will confirm.',
  suggestedRequestTypes: ['Repair requests', 'Installation requests', 'Estimate / quote', 'Emergency service', 'Scheduling', 'Service area questions'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Service address', 'Preferred date', 'Preferred time', 'Issue description', 'Urgency'],
};

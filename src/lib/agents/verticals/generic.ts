import type { VerticalProfile } from '../core/types';

// Fallback profile for businesses without a clear vertical (business_type = 'other'
// or any unknown/legacy value). Deliberately low-inference: when the service context
// is unclear, ASK rather than guess.
export const genericProfile: VerticalProfile = {
  id: 'generic',
  label: 'Other / General service business',
  description: 'A general service business. The specific industry is not known, so do not over-infer.',
  commonIntents: ['general question', 'appointment or visit request', 'service request', 'callback request'],
  terminology: 'Use neutral, professional language. Do not assume industry-specific terms.',
  knowledgeCategories: ['General Services', 'Hours', 'Pricing Policy', 'Booking', 'Location', 'FAQ', 'Escalation'],
  interpretationExamples: [
    'If the caller names a specific service this business clearly offers (per the knowledge base), treat it as the reason',
    'If the caller wants to "come in", "stop by", or "book a time", treat it as an appointment/visit request',
  ],
  collectionPriorities: 'Collect what the caller needs, then name and phone. Confirm reason/date/time when it is an appointment.',
  requiredFields: ['name'],
  optionalFields: ['phone', 'date', 'time', 'service'],
  forbiddenAssumptions: [
    'Do not assume what services or products this business offers unless stated in the business info or knowledge base',
    'Do not assume this is a restaurant, salon, clinic, or any specific vertical',
  ],
  fallbackWording:
    'If the service context is unclear, ask one short clarifying question about what the caller needs or what the business can help with — do not guess the industry.',
  suggestedRequestTypes: ['Appointments', 'Service requests', 'General inquiries', 'Callback requests'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Preferred date', 'Preferred time', 'Reason / service needed', 'Notes'],
  profileSetupHint: 'Pick a specific business type for sharper suggestions — or customize the lists below for your business.',
};

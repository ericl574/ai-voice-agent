import type { VerticalProfile } from '../core/types';

export const autoRepairProfile: VerticalProfile = {
  id: 'auto_repair',
  label: 'Auto Repair Shop',
  description: 'An auto repair / service shop booking repairs, diagnostics, and maintenance.',
  commonIntents: [
    'service appointment', 'repair estimate request', 'brake issue', 'oil change',
    'inspection', 'tire service', 'strange noise', 'emergency breakdown',
  ],
  terminology: 'Talk about vehicles, repairs, diagnostics, and service appointments. A "booking" means a service appointment.',
  knowledgeCategories: ['Services', 'Diagnostics', 'Pricing Policy', 'Booking', 'Vehicle Info Needed', 'Hours', 'Location', 'Warranty'],
  interpretationExamples: [
    '"my brakes", "oil change", "my car is making noise", "engine light", "inspection" = an auto service request/appointment',
    'A described symptom (noise, leak, warning light) = the reason for the service',
  ],
  collectionPriorities: 'Collect the service/issue, then vehicle make, model, and year, preferred date/time, name, and phone.',
  forbiddenAssumptions: [
    'Do not diagnose the problem with certainty — describe it as something the technician will inspect',
    'Do not quote repair prices or costs unless they are provided in the knowledge base',
  ],
  fallbackWording: 'For diagnosis or pricing not in the knowledge base, say a technician will assess it and the team will follow up.',
  suggestedRequestTypes: ['Service appointments', 'Diagnostic requests', 'Estimate requests', 'Brake service', 'Oil change', 'Tire service', 'Emergency / breakdown', 'Warranty / parts questions'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Preferred date', 'Preferred time', 'Vehicle make/model/year', 'Issue description', 'Urgency'],
};

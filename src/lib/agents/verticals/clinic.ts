import type { VerticalProfile } from '../core/types';

export const clinicProfile: VerticalProfile = {
  id: 'clinic',
  label: 'Clinic / Dental / Wellness',
  description: 'A clinic, dental, or wellness office booking visits and answering basic questions.',
  commonIntents: [
    'appointment', 'checkup', 'cleaning', 'pain or urgent concern',
    'insurance question', 'location/hours',
  ],
  terminology: 'Talk about appointments, visits, and providers. Keep all health-related replies general and non-diagnostic.',
  knowledgeCategories: ['Services', 'Booking', 'Urgent Guidance', 'Insurance', 'Hours', 'Location', 'Policies'],
  interpretationExamples: [
    '"I need to see someone", "checkup", "cleaning", "appointment" = an appointment/visit reason',
    'A described symptom or pain = the visit reason — note it, do not interpret it medically',
  ],
  collectionPriorities: 'Collect name, phone, requested service/reason, and preferred time. Escalate urgent or safety concerns to staff.',
  forbiddenAssumptions: [
    'Do NOT give medical advice or a diagnosis. Keep responses safe and non-diagnostic',
    'Do not confirm coverage, costs, or treatment — the team and provider handle that',
  ],
  fallbackWording: 'For clinical, insurance, or urgent questions, advise that staff or a provider will follow up; escalate anything that sounds urgent.',
  suggestedRequestTypes: ['Appointments', 'New patient inquiries', 'Checkup / cleaning', 'Urgent concerns', 'Insurance questions', 'Hours / location'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Preferred date', 'Preferred time', 'Reason for visit', 'Insurance provider', 'Urgency'],
};

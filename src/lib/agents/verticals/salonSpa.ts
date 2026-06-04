import type { VerticalProfile } from '../core/types';

export const salonSpaProfile: VerticalProfile = {
  id: 'salon',
  label: 'Salon / Barber / Spa',
  description: 'A salon, barber, or spa booking beauty and wellness service appointments.',
  commonIntents: [
    'haircut', 'color', 'nails', 'massage', 'facial',
    'stylist request', 'appointment', 'pricing', 'cancellation',
  ],
  terminology: 'Talk about services, stylists/technicians, and appointments. A "booking" means a service appointment.',
  knowledgeCategories: ['Services', 'Pricing', 'Staff', 'Booking', 'Cancellation Policy', 'Hours', 'Location'],
  interpretationExamples: [
    '"I need a haircut", "nails", "massage", "color", "a trim" = a service appointment',
    'A named stylist or technician = a preferred staff request for the appointment',
  ],
  collectionPriorities: 'Collect the desired service, preferred date/time, name, phone, and optional preferred staff member.',
  forbiddenAssumptions: [
    'Do not invent prices or service durations',
    'Do not promise a specific stylist or time slot is available',
  ],
  fallbackWording: 'For pricing or stylist availability not in the knowledge base, say the team will confirm.',
  suggestedRequestTypes: ['Service bookings', 'Pricing inquiries', 'Staff preference', 'Cancellation / reschedule', 'Consultation requests', 'Hours / location'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Preferred date', 'Preferred time', 'Desired service', 'Preferred staff member', 'Notes'],
};

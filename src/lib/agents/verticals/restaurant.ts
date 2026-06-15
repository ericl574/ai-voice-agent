import type { VerticalProfile } from '../core/types';

export const restaurantProfile: VerticalProfile = {
  id: 'restaurant',
  label: 'Restaurant / Cafe / Bar',
  description: 'A food and dining business taking reservations, takeout, and guest questions.',
  commonIntents: [
    'table reservation', 'menu question', 'hours', 'dietary options',
    'takeout', 'large party', 'event booking', 'location/parking',
  ],
  terminology: 'Talk about tables, reservations, party size, seating, and the menu. A "booking" means a table reservation.',
  knowledgeCategories: ['Menu', 'Hours', 'Reservations', 'Dietary Options', 'Takeout', 'Location', 'Parking', 'Events'],
  interpretationExamples: [
    '"I want to eat", "dinner", "lunch", "a table", "book a table", "come in to eat" = a dining/table reservation',
    'A party size ("for four", "two people") = number of guests for the reservation',
  ],
  collectionPriorities: 'For a reservation, collect: date, time, party size, name, and phone. Treat the reservation reason as dining unless the caller says otherwise.',
  requiredFields: ['name', 'date', 'time'],
  optionalFields: ['phone', 'service'],
  forbiddenAssumptions: [
    'Do not invent menu items, dishes, prices, or ingredients',
    'Do not promise specific wait times or table availability',
  ],
  fallbackWording: 'For menu, availability, or dietary specifics not in the knowledge base, say you will note it for the team to confirm.',
  suggestedRequestTypes: ['Reservations', 'Menu questions', 'Takeout / orders', 'Dietary options', 'Large parties / events', 'Hours / location'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Preferred date', 'Preferred time', 'Party size', 'Reservation notes'],
};

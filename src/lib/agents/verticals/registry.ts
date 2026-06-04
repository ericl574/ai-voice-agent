import type { VerticalId, VerticalProfile } from '../core/types';
import { genericProfile } from './generic';
import { restaurantProfile } from './restaurant';
import { autoRepairProfile } from './autoRepair';
import { salonSpaProfile } from './salonSpa';
import { clinicProfile } from './clinic';
import { tutoringProfile } from './tutoring';
import { homeServicesProfile } from './homeServices';

// Registry of all vertical profiles, keyed by VerticalId. Adding a new vertical = add a
// profile file + one entry here (+ one BUSINESS_TYPE_OPTIONS row).
export const VERTICALS: Record<VerticalId, VerticalProfile> = {
  generic: genericProfile,
  restaurant: restaurantProfile,
  auto_repair: autoRepairProfile,
  salon: salonSpaProfile,
  clinic: clinicProfile,
  tutoring: tutoringProfile,
  home_services: homeServicesProfile,
};

// Resolve a stored businesses.business_type into a vertical profile.
// 'other', null/undefined, and any unknown or legacy value all fall back to the generic
// profile — so existing businesses never break and the agent stays safe.
export function getVertical(businessType: string | null | undefined): VerticalProfile {
  if (!businessType) return genericProfile;
  const key = businessType as VerticalId;
  return VERTICALS[key] ?? genericProfile;
}

// Single source of truth for the business-type dropdowns in onboarding / settings / KB UI.
// (Wired into the frontend in the next pass; defined here now so there is one canonical list.)
// 'other' is a selectable type that resolves to the generic vertical via getVertical().
export const BUSINESS_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant / Cafe / Bar' },
  { value: 'auto_repair', label: 'Auto Repair Shop' },
  { value: 'salon', label: 'Salon / Barber / Spa' },
  { value: 'clinic', label: 'Clinic / Dental / Wellness' },
  { value: 'tutoring', label: 'Tutoring / Education' },
  { value: 'home_services', label: 'Home Services' },
  { value: 'other', label: 'Other' },
];

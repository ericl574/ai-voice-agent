// Single source of truth for customer-facing site identity (brand, support, legal identity).
// Customer-facing brand is "FrontDesk" — no "AI" in the name (see docs/product-scope.md).
//
// PLACEHOLDERS: the two TODO(Eric) values below MUST be replaced before the first pilot customer.

export const SITE_NAME = 'FrontDesk';
export const SITE_TAGLINE = 'A virtual front desk for service businesses';
export const SITE_DESCRIPTION =
  'FrontDesk answers the calls you miss after hours, captures who called and what they need, and sends you one clear report every morning.';

// TODO(Eric): replace with the real support inbox before the pilot.
export const SUPPORT_EMAIL = 'support@frontdesk.example';

// TODO(Eric): replace with the legal operator identity before the pilot.
export const OPERATOR_NAME = '[Operator name]';
export const OPERATOR_JURISDICTION = 'British Columbia, Canada';

// Absolute origin for metadata (OG/sitemap). Set NEXT_PUBLIC_SITE_URL on Vercel.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const LEGAL_LAST_UPDATED = 'June 10, 2026';

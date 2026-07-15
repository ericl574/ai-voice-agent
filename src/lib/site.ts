// Single source of truth for customer-facing site identity (brand, support, legal identity).
// Customer-facing brand is "FrontDesk" — no "AI" in the name (see docs/product-scope.md).

export const SITE_NAME = 'FrontDesk';
export const SITE_TAGLINE = 'A virtual front desk for service businesses';
export const SITE_DESCRIPTION =
  'FrontDesk answers the calls you miss after hours, captures who called and what they need, and sends you one clear report every morning.';

// Support inbox: shown publicly (privacy/terms/contact) and the destination for /contact pilot
// requests. A personal Gmail is intentional for the supervised first pilot; upgrade to a domain
// support address before broader public launch (see docs/deployment-checklist.md).
export const SUPPORT_EMAIL = 'ericliu2364@gmail.com';

// Legal operator identity shown on /privacy and /terms. Sole operator (individual) for the first
// pilot — intentional; revisit if/when a company or trade name is registered.
export const OPERATOR_NAME = 'Siran Liu';
export const OPERATOR_JURISDICTION = 'British Columbia, Canada';

// Absolute origin for metadata (OG/sitemap). Set NEXT_PUBLIC_SITE_URL on Vercel.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const LEGAL_LAST_UPDATED = 'July 14, 2026';

import type { Metadata } from 'next';

// The page is a client component; this server layout supplies its tab title.
export const metadata: Metadata = { title: 'Business setup' };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

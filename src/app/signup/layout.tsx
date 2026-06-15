import type { Metadata } from 'next';

// The page is a client component; this server layout supplies its tab title.
export const metadata: Metadata = { title: 'Create account' };

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}

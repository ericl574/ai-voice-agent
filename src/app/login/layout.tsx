import type { Metadata } from 'next';

// The page is a client component; this server layout supplies its tab title
// (root template renders it as "Sign in · FrontDesk").
export const metadata: Metadata = { title: 'Sign in' };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

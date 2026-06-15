import type { Metadata } from 'next';

// The pages under /reset-password are client components; this server layout supplies the title.
export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';

// Shared chrome for the public legal/contact pages: light theme, simple header, footer links.
export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900">{SITE_NAME}</span>
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
            ← Home
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
          {updated && <p className="text-sm text-gray-400 mb-10">Last updated: {updated}</p>}
          <div className="space-y-8 text-[15px] leading-relaxed text-gray-700">{children}</div>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} {SITE_NAME}</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-gray-600">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-600">Terms</Link>
            <Link href="/contact" className="hover:text-gray-600">Contact</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

// Section heading used by the legal pages.
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

import Link from 'next/link';
import { MOCK_RESTAURANT } from '@/lib/mock-data';

export default function DemoBanner({ isSignedIn = false }: { isSignedIn?: boolean }) {
  return (
    <div
      className="h-11 px-6 flex items-center justify-between flex-shrink-0"
      style={{
        backgroundColor: 'var(--paper-dim)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="fd-eyebrow"
          style={{ color: 'var(--accent)' }}
        >
          Demo
        </span>
        <span style={{ color: 'var(--hairline-strong)' }}>·</span>
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>
          {MOCK_RESTAURANT.name}
        </span>
        <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--ink-muted)' }}>
          sample data — not your account
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-[12px] font-medium transition-colors flex items-center gap-1"
          style={{ color: 'var(--ink-soft)' }}
        >
          ← Home
        </Link>
        {isSignedIn ? (
          <a href="/dashboard" className="fd-btn fd-btn-primary text-[12px] px-3 py-1.5">
            My dashboard →
          </a>
        ) : (
          <>
            <Link href="/login" className="fd-btn fd-btn-quiet text-[12px] px-3 py-1.5">
              Sign in
            </Link>
            <Link href="/signup" className="fd-btn fd-btn-primary text-[12px] px-3 py-1.5">
              Create account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

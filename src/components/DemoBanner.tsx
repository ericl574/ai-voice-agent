import Link from 'next/link';

export default function DemoBanner() {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 flex items-center justify-between flex-shrink-0">
      <span className="text-xs text-amber-800">
        Demo mode — you&apos;re viewing mock data.{' '}
        <span className="hidden sm:inline">Sign in to save real business data.</span>
      </span>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          href="/login"
          className="text-xs font-semibold text-amber-700 hover:text-amber-900 transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded transition-colors"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}

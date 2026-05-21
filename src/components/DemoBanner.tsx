import Link from 'next/link';
import { MOCK_RESTAURANT } from '@/lib/mock-data';

export default function DemoBanner({ isSignedIn = false }: { isSignedIn?: boolean }) {
  return (
    <div className="bg-amber-50 border-b border-amber-100 px-5 h-12 flex items-center justify-between flex-shrink-0">

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center bg-orange-50 border border-orange-200 text-orange-600 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
          View Demo
        </span>
        <span className="text-sm font-medium text-gray-700">{MOCK_RESTAURANT.name}</span>
        <span className="text-xs text-gray-400 hidden sm:inline">— sample data</span>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors flex items-center gap-1 px-2"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Home
        </Link>
        <Link
          href={isSignedIn ? '/dashboard' : '/login'}
          className="text-sm font-semibold bg-black hover:bg-orange-600 text-white px-4 py-1 rounded-lg transition-colors"
        >
          Sign in →
        </Link>
      </div>

    </div>
  );
}

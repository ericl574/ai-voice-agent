import Link from 'next/link';
import { MOCK_RESTAURANT } from '@/lib/mock-data';

export default function DemoBanner() {
  return (
    <div className="bg-white border-b border-gray-100 px-5 h-12 flex items-center justify-between flex-shrink-0">

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center bg-orange-50 border border-orange-200 text-orange-600 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
          View Demo
        </span>
        <span className="text-sm font-medium text-gray-700">{MOCK_RESTAURANT.name}</span>
        <span className="text-xs text-gray-400 hidden sm:inline">— sample data</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Search</span>
          <kbd className="text-[10px] bg-white border border-gray-200 rounded px-1 font-medium">⌘K</kbd>
        </div>
        <Link
          href="/login"
          className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors px-2"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-lg transition-colors"
        >
          Create account
        </Link>
      </div>

    </div>
  );
}

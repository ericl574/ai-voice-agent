import Link from 'next/link';
import { MOCK_RESTAURANT } from '@/lib/mock-data';

export default function DemoBanner() {
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
          href="/login"
          className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors px-2"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="text-sm font-semibold bg-black hover:bg-orange-600 text-white px-4 py-1 rounded-lg transition-colors"
        >
          Create account
        </Link>
      </div>

    </div>
  );
}

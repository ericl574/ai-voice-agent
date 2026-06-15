import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 text-center">
      <div className="flex items-center gap-2 mb-8">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>
        <span className="font-semibold text-gray-900">{SITE_NAME}</span>
      </div>

      <p className="text-sm font-semibold text-orange-600 uppercase tracking-widest mb-3">404</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Page not found</h1>
      <p className="text-gray-500 max-w-sm mb-8">
        That page doesn&rsquo;t exist or may have moved. The front desk, however, is still here.
      </p>

      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/"
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          Go home
        </Link>
        <Link
          href="/dashboard"
          className="border border-gray-200 hover:border-gray-300 bg-white text-gray-700 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          Open dashboard
        </Link>
        <Link
          href="/contact"
          className="border border-gray-200 hover:border-gray-300 bg-white text-gray-700 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          Contact support
        </Link>
      </div>
    </div>
  );
}

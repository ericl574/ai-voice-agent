import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Pricing',
  description: `Simple monthly plans for the ${SITE_NAME} virtual front desk.`,
};

// NOTE: the dollar amounts below are DISPLAY placeholders — set the real amounts on the Stripe
// prices (STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO) and keep this page in sync.
const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '$49',
    blurb: 'After-hours call capture + the daily morning report, for one location.',
    cta: 'Start a pilot',
    highlight: false,
    features: [
      'Calls answered around the clock',
      'Call summaries and full transcripts',
      'Appointment & service request capture',
      'Business knowledge base',
      'Staff dashboard for one business',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$99',
    blurb: 'For busier teams that want more hands-on help.',
    cta: 'Start a pilot',
    highlight: true,
    features: [
      'Everything in Starter',
      'Guided setup and knowledge-base tuning',
      'Priority support',
      'Early access to new features (including phone-line service as it rolls out)',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900">{SITE_NAME}</span>
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/login" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
              Sign in
            </Link>
            <Link
              href="/dashboard?demo=1"
              className="text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              View Demo
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
              Simple monthly pricing
            </h1>
            <p className="text-gray-500 max-w-xl mx-auto">
              FrontDesk answers the calls you miss after hours, captures who called and what they
              need, and sends you one report every morning. We&apos;re onboarding pilot businesses
              now — we set it up with you, and you&apos;re billed once it&apos;s live and capturing
              your calls.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-2xl border p-7 flex flex-col ${
                  plan.highlight ? 'border-orange-300 shadow-md' : 'border-gray-200 shadow-sm'
                }`}
              >
                {plan.highlight && (
                  <span className="self-start text-[11px] font-bold uppercase tracking-widest text-orange-600 bg-orange-50 border border-orange-100 rounded-full px-3 py-1 mb-4">
                    Most popular
                  </span>
                )}
                <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
                <p className="text-sm text-gray-500 mt-1 mb-4">{plan.blurb}</p>
                <p className="mb-6">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-sm text-gray-400"> / month</span>
                </p>
                <ul className="space-y-2.5 text-sm text-gray-600 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5 items-start">
                      <svg className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Link
                    href="/contact"
                    className={
                      plan.highlight
                        ? 'block w-full text-center bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors'
                        : 'block w-full text-center border border-gray-300 hover:border-gray-400 bg-white text-gray-900 font-semibold px-6 py-3 rounded-lg text-sm transition-colors'
                    }
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-gray-400 mt-10 max-w-md mx-auto">
            No card needed to start a pilot — we set it up with you first, and you can cancel anytime.
            Questions about plans or the pilot?{' '}
            <Link href="/contact" className="text-gray-500 hover:underline">Contact us</Link>.
          </p>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
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

import Link from 'next/link';

const VERTICALS = [
  'Restaurants', 'Auto Repair', 'Salons & Spas', 'Clinics', 'Tutoring', 'Home Services',
];

const FEATURES = [
  {
    icon: (
      <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
    title: 'Answers Every Call',
    description:
      'Your AI assistant picks up 24/7 so no call goes to voicemail. Common questions answered instantly.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    title: 'Collects Requests',
    description:
      'Appointment and service request details are logged automatically and routed to staff for confirmation.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Full Call Dashboard',
    description:
      'Review call history, manage requests, and update your knowledge base — all from one place.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900">FrontDesk AI</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
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
      </header>

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-24 text-center">
          <span className="inline-block bg-orange-100 text-orange-700 text-xs font-semibold px-3 py-1 rounded-full mb-6 uppercase tracking-wide">
            AI Voice Agents for Service Businesses
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-6">
            Never Miss a Customer
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-4">
            FrontDesk AI answers every call, logs appointment and service requests, and keeps your
            staff in control — without missing a beat.
          </p>
          <p className="text-sm text-gray-400 max-w-xl mx-auto mb-10">
            Built for{' '}
            {VERTICALS.map((v, i) => (
              <span key={v}>
                <span className="text-gray-500">{v}</span>
                {i < VERTICALS.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              View Demo Dashboard
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/dashboard/simulator"
              className="inline-flex items-center justify-center gap-2 border border-gray-200 hover:border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              Try Call Simulator
            </Link>
          </div>
        </section>

        <section className="bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-12">
              Everything your business needs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center mb-4">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Ready to stop missing calls?
          </h2>
          <p className="text-gray-500 mb-8">Explore the demo — no sign-up required.</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
          >
            Open Dashboard
          </Link>
        </section>
      </main>

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-xs text-gray-400">
          FrontDesk AI — MVP Demo. Mock data only.
        </div>
      </footer>
    </div>
  );
}

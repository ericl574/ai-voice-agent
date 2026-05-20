import Link from 'next/link';

// ── Feature cards ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: '24/7 Call Answering',
    description:
      'The AI picks up calls any time — after hours, during peak periods, and on weekends. Reduce missed calls and voicemail pileups.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
  {
    title: 'Appointment Capture',
    description:
      'Callers can request appointments, reservations, repairs, or consultations. Details are logged and routed to staff for confirmation.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: 'Service Request Logging',
    description:
      'Quote requests, follow-ups, and customer needs are organized in one place and ready for your team to review.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    title: 'Business Knowledge Base',
    description:
      'Give the AI your hours, services, pricing guidance, and FAQs. It answers common questions from your own information.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    title: 'Customizable AI Agent',
    description:
      "Set the agent's name, greeting, tone, and response rules. Configured for your business — not a one-size-fits-all template.",
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
  {
    title: 'Staff Follow-up Dashboard',
    description:
      'Call summaries, transcripts, pending appointments, and service requests — all in one place for your team.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
];

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    number: '01',
    title: 'Set up your business',
    description:
      'Add your business info, hours, services, FAQs, and agent instructions. The AI uses this to answer callers accurately.',
  },
  {
    number: '02',
    title: 'AI answers and collects',
    description:
      'The AI handles common questions, captures appointment requests, and logs service inquiries — any time of day.',
  },
  {
    number: '03',
    title: 'Your staff follows up',
    description:
      'Review call summaries, transcripts, and pending requests from the dashboard. Confirm what needs confirming.',
  },
];

// ── Business verticals ────────────────────────────────────────────────────────

const VERTICALS = [
  {
    label: 'Auto Repair',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: 'Salons & Spas',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
  {
    label: 'Clinics',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    label: 'Tutoring Centers',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    label: 'Home Services',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    label: 'Restaurants',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    label: 'Any Service Business',
    icon: (
      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
];

// ── Why businesses use it ─────────────────────────────────────────────────────

const BENEFITS = [
  {
    title: 'Stop missing calls',
    description:
      "Every unanswered call is a potential customer lost. FrontDesk AI picks up when you can't — after hours, during rushes, and on weekends.",
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
  {
    title: 'Free up your staff',
    description:
      'Repetitive questions and routine call handling pull your team away from the work that matters. The AI handles the predictable calls.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Capture more bookings',
    description:
      'Callers can request appointments and services any time — not just when someone is available to answer. Nothing falls through the cracks.',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: 'Keep follow-ups organized',
    description:
      "Pending requests, call history, and transcripts all stay in one dashboard — so your team knows exactly what needs attention.",
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="flex flex-col">

      {/* ── Cinematic hero — full viewport, video background ───────────────── */}
      <section className="relative min-h-screen flex flex-col bg-gray-950">

        {/* Video background — place file at public/videos/frontdesk-hero.mp4 */}
        {/* If the file is missing the browser silently shows the bg-gray-950 fallback */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src="/videos/frontdesk-hero.mp4" type="video/mp4" />
        </video>

        {/* Dark gradient overlay — ensures text is readable over any video content */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.70) 100%)',
          }}
        />

        {/* ── Nav — sits above the overlay ─────────────────────────────────── */}
        <header className="relative z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <span className="font-semibold text-white">FrontDesk AI</span>
            </div>
            <div className="flex items-center gap-5">
              <Link
                href="/login"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors"
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

        {/* ── Hero content — vertically centered in remaining space ─────────── */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-20">
          <div className="text-center max-w-3xl mx-auto">
            <span className="inline-block bg-white/10 border border-white/20 text-white/90 text-xs font-semibold px-4 py-1.5 rounded-full mb-8 uppercase tracking-widest">
              AI Front Desk for Service Businesses
            </span>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6">
              Never Miss a<br />Customer Call
            </h1>
            <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-12 leading-relaxed">
              FrontDesk AI answers calls, captures appointments and service requests, and keeps your
              team ready to follow up — 24/7.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
              >
                View Demo
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/dashboard/simulator"
                className="inline-flex items-center justify-center gap-2 border border-white/30 hover:border-white/60 bg-white/10 hover:bg-white/15 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors text-base backdrop-blur-sm"
              >
                Try Call Simulator
              </Link>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="relative z-10 flex justify-center pb-10 animate-bounce">
          <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

      </section>

      {/* ── Remaining content sections (light theme) ───────────────────────── */}
      <main>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section className="bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
                What FrontDesk AI handles
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                A complete AI front desk — from answering calls to organizing follow-ups for your team.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="bg-white rounded-xl p-6 shadow-sm border border-gray-100"
                >
                  <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center mb-4">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── See what happens after a call ────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
                See what happens after a customer calls
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Every call is answered, summarized, and organized — so nothing gets lost and your
                staff knows exactly what to follow up on.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

              {/* Left: call flow timeline */}
              <div>
                {/* Step 1 */}
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                    </div>
                    <div className="w-px flex-1 bg-orange-100 my-1" />
                  </div>
                  <div className="pb-8">
                    <p className="font-semibold text-gray-900 mb-1">Customer calls your business</p>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      FrontDesk AI picks up and greets them using your business name and custom greeting.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 rounded-full bg-orange-400 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <div className="w-px flex-1 bg-orange-100 my-1" />
                  </div>
                  <div className="pb-8">
                    <p className="font-semibold text-gray-900 mb-1">AI collects the details</p>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      The AI asks for their name, service needed, preferred time, and any other details you&apos;ve configured it to collect.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 rounded-full bg-orange-300 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <div className="w-px flex-1 bg-orange-100 my-1" />
                  </div>
                  <div className="pb-8">
                    <p className="font-semibold text-gray-900 mb-1">A request is logged automatically</p>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      FrontDesk AI creates a structured request — with caller info, intent, AI summary, and transcript — marked pending for staff review.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 mb-1">Staff reviews and confirms</p>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      Your team sees the full context in the dashboard and confirms, declines, or follows up — nothing gets lost.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right: mock appointment card */}
              <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100 shadow-sm">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">

                  {/* Card header */}
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Appointment Request</p>
                      <p className="text-xs text-gray-400 mt-0.5">Today at 9:14 AM · Auto Repair</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      Pending
                    </span>
                  </div>

                  <div className="px-5 py-4 space-y-4">

                    {/* Caller */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-orange-600 font-bold text-sm">SJ</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">Sarah Johnson</p>
                        <p className="text-xs text-gray-400">(555) 234-7890</p>
                      </div>
                    </div>

                    {/* Detail chips */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                        <p className="text-xs text-gray-400 mb-0.5">Service</p>
                        <p className="text-sm font-semibold text-gray-900">Oil Change</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                        <p className="text-xs text-gray-400 mb-0.5">Preferred Time</p>
                        <p className="text-sm font-semibold text-gray-900">Tomorrow, 9–10 AM</p>
                      </div>
                    </div>

                    {/* AI summary */}
                    <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-3">
                      <p className="text-xs font-semibold text-orange-600 mb-1.5">AI Summary</p>
                      <p className="text-xs text-gray-700 leading-relaxed">
                        Sarah called to schedule an oil change. She prefers tomorrow morning between
                        9 and 10 AM. Mentioned the vehicle is a 2018 Honda Civic.
                      </p>
                    </div>

                    {/* Transcript snippet */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Call Transcript
                      </p>
                      <div className="space-y-2">
                        <div className="flex gap-2.5 items-start">
                          <span className="text-xs font-bold text-orange-500 flex-shrink-0 mt-0.5 w-6">AI</span>
                          <p className="text-xs text-gray-600 leading-relaxed">
                            &ldquo;Hi, thanks for calling Valley Auto. How can I help you today?&rdquo;
                          </p>
                        </div>
                        <div className="flex gap-2.5 items-start">
                          <span className="text-xs font-bold text-gray-400 flex-shrink-0 mt-0.5 w-6">You</span>
                          <p className="text-xs text-gray-600 leading-relaxed">
                            &ldquo;Hi, I&apos;d like to book an oil change for tomorrow morning if possible.&rdquo;
                          </p>
                        </div>
                        <div className="flex gap-2.5 items-start">
                          <span className="text-xs font-bold text-orange-500 flex-shrink-0 mt-0.5 w-6">AI</span>
                          <p className="text-xs text-gray-600 leading-relaxed">
                            &ldquo;I&apos;ll log that for you. What time works best — 9 AM or 10 AM?&rdquo;
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons (visual only) */}
                    <div className="flex gap-2 pt-1 border-t border-gray-100">
                      <div className="flex-1 bg-green-50 text-green-700 text-xs font-semibold py-2 rounded-lg text-center cursor-default">
                        Confirm
                      </div>
                      <div className="flex-1 bg-gray-50 text-gray-500 text-xs font-semibold py-2 rounded-lg text-center cursor-default">
                        Decline
                      </div>
                    </div>

                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
                How it works
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Simple setup. We can help configure it. The AI handles the calls. Your staff handles what matters.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 lg:gap-12">
              {STEPS.map((step) => (
                <div key={step.number} className="flex flex-col">
                  <span className="text-5xl font-bold text-orange-100 leading-none mb-4 select-none">
                    {step.number}
                  </span>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 bg-white border border-orange-100 rounded-xl px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Not sure where to start?</p>
                <p className="text-sm text-gray-600 mt-0.5">
                  We can help configure the AI agent for your business — from the knowledge base to the greeting and response rules.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Verticals ────────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
              Built for service businesses
            </h2>
            <p className="text-gray-500 mb-10 max-w-xl mx-auto">
              FrontDesk AI works for any business that takes appointment calls or handles customer inquiries by phone.
            </p>
            <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
              {VERTICALS.map((v) => (
                <div
                  key={v.label}
                  className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm"
                >
                  {v.icon}
                  <span className="text-sm font-medium text-gray-700">{v.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Benefits ─────────────────────────────────────────────────────── */}
        <section className="bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
                Why businesses use it
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto">
                The front desk is where customers form their first impression. FrontDesk AI helps you make it a good one.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="flex gap-4 bg-white rounded-xl p-6 border border-gray-100 shadow-sm"
                >
                  <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    {b.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">{b.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{b.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="border-t border-gray-100 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
              Ready to see your AI front desk in action?
            </h2>
            <p className="text-gray-500 mb-8 max-w-lg mx-auto">
              Explore the demo dashboard or try the call simulator — no sign-up required.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
              >
                View Demo
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/dashboard/simulator"
                className="inline-flex items-center justify-center gap-2 border border-gray-200 hover:border-gray-300 bg-white text-gray-700 font-semibold px-8 py-3 rounded-lg transition-colors"
              >
                Try Call Simulator
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-6 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-xs text-gray-400">
          FrontDesk AI — AI voice agent for service businesses. Demo build.
        </div>
      </footer>

    </div>
  );
}

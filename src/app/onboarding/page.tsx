'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/agents/verticals/registry';

// Mirrors the Settings page list (Canada + US). Default comes from the browser's timezone.
const TIMEZONES = [
  'America/Vancouver',
  'America/Edmonton',
  'America/Regina',
  'America/Winnipeg',
  'America/Toronto',
  'America/Halifax',
  'America/St_Johns',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

// Browser-detected timezone, falling back to America/Vancouver (same approach as Settings).
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Vancouver';
  } catch {
    return 'America/Vancouver';
  }
}

const INPUT_CLASS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400';

function FormField({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
        {optional && <span className="ml-1.5 normal-case font-normal text-gray-400">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nameParam = searchParams.get('name') ?? '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: nameParam,
    businessType: 'other',
    phone: '',
    email: '',
    city: '',
    region: '',
    timezone: browserTimezone(),
    aiAgentName: 'Aria',
    greeting:
      "Thank you for calling {business_name}! I'm {agent_name}, your front desk assistant. How can I help you today?",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function createBusiness(data: typeof form) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error('You must be signed in to create a business.');

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({
        name: data.name.trim(),
        business_type: data.businessType || 'other',
        phone: data.phone || null,
        email: data.email || null,
        city: data.city || null,
        region: data.region || null,
        timezone: data.timezone,
        ai_agent_name: data.aiAgentName || null,
        greeting: data.greeting || null,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (bizError) throw new Error(bizError.message);

    const { error: memberError } = await supabase.from('business_members').insert({
      business_id: business.id,
      user_id: user.id,
      role: 'owner',
    });

    if (memberError) throw new Error(memberError.message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createBusiness(form);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupLater() {
    if (!form.name.trim()) {
      setError('Business name is required to continue.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await createBusiness(form);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Supabase is not configured — auth is unavailable.</p>
          <Link href="/dashboard" className="text-orange-600 font-medium hover:underline">
            Continue to demo dashboard →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">FrontDesk</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-2xl font-bold text-gray-900">Business setup</h1>
              <span className="text-xs text-gray-400 font-medium">Step 2 of 2</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Add details so your front desk can answer accurately.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Business information</h2>
              </div>
              <div className="p-5 space-y-4">
                <FormField label="Business type">
                  <select
                    value={form.businessType}
                    onChange={(e) => set('businessType', e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {BUSINESS_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    This tailors your front desk to your industry — terminology, common requests, and knowledge categories. Choose &ldquo;Other&rdquo; if none fit.
                  </p>
                </FormField>

                <FormField label="Business name">
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Sunrise Auto Repair"
                    className={INPUT_CLASS}
                  />
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Phone" optional>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="(555) 867-5309"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                  <FormField label="Business email" optional>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="hello@yourbusiness.com"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="City" optional>
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => set('city', e.target.value)}
                      placeholder="Springfield"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                  <FormField label="State / Region" optional>
                    <input
                      type="text"
                      value={form.region}
                      onChange={(e) => set('region', e.target.value)}
                      placeholder="IL"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>

                <FormField label="Timezone" optional>
                  <select
                    value={form.timezone}
                    onChange={(e) => set('timezone', e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {/* Keep the browser-detected zone selectable even when it's not in the preset list. */}
                    {(TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Front desk voice</h2>
              </div>
              <div className="p-5 space-y-4">
                <FormField label="Agent name" optional>
                  <input
                    type="text"
                    value={form.aiAgentName}
                    onChange={(e) => set('aiAgentName', e.target.value)}
                    placeholder="Aria"
                    className={INPUT_CLASS}
                  />
                </FormField>

                <FormField label="Greeting message" optional>
                  <textarea
                    rows={3}
                    value={form.greeting}
                    onChange={(e) => set('greeting', e.target.value)}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use {'{business_name}'} and {'{agent_name}'} as placeholders.
                  </p>
                </FormField>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {error}
              </p>
            )}

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-8 py-2.5 rounded-lg text-sm transition-colors"
              >
                {loading ? 'Saving…' : 'Save and continue'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleSetupLater}
                className="text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors disabled:opacity-50"
              >
                Set up later →
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingPageInner />
    </Suspense>
  );
}

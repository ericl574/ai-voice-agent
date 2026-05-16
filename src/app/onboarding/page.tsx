'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

const BUSINESS_TYPE_OPTIONS = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'auto_repair', label: 'Auto Repair Shop' },
  { value: 'salon', label: 'Salon / Spa' },
  { value: 'clinic', label: 'Clinic / Medical' },
  { value: 'tutoring', label: 'Tutoring / Education' },
  { value: 'home_services', label: 'Home Services' },
  { value: 'other', label: 'Other' },
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

const INPUT_CLASS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400';

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    businessType: 'restaurant',
    phone: '',
    email: '',
    city: '',
    region: '',
    timezone: 'America/Chicago',
    aiAgentName: 'Aria',
    greeting:
      "Thank you for calling {business_name}! I'm {agent_name}, your AI assistant. How can I help you today?",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('You must be signed in to create a business.');
        return;
      }

      const { data: business, error: bizError } = await supabase
        .from('businesses')
        .insert({
          name: form.name,
          business_type: form.businessType,
          phone: form.phone || null,
          email: form.email || null,
          city: form.city || null,
          region: form.region || null,
          timezone: form.timezone,
          ai_agent_name: form.aiAgentName || null,
          greeting: form.greeting || null,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (bizError) {
        setError(bizError.message);
        return;
      }

      const { error: memberError } = await supabase.from('business_members').insert({
        business_id: business.id,
        user_id: user.id,
        role: 'owner',
      });

      if (memberError) {
        setError(memberError.message);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">
            Supabase is not configured — auth is unavailable.
          </p>
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
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">FrontDesk AI</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Set up your business</h1>
            <p className="text-sm text-gray-500 mt-1">
              Tell us about your business so your AI assistant can answer calls correctly.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Business Information</h2>
              </div>
              <div className="p-5 space-y-4">
                <FormField label="Business Name" required>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Bella Notte Ristorante"
                    className={INPUT_CLASS}
                  />
                </FormField>

                <FormField label="Business Type" required>
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
                </FormField>

                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Phone">
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="(555) 867-5309"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                  <FormField label="Email">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="hello@yourbusiness.com"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField label="City">
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => set('city', e.target.value)}
                      placeholder="Springfield"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                  <FormField label="Region / Province">
                    <input
                      type="text"
                      value={form.region}
                      onChange={(e) => set('region', e.target.value)}
                      placeholder="IL"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>

                <FormField label="Timezone" required>
                  <select
                    value={form.timezone}
                    onChange={(e) => set('timezone', e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {TIMEZONES.map((tz) => (
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
                <h2 className="font-semibold text-gray-900">AI Assistant</h2>
              </div>
              <div className="p-5 space-y-4">
                <FormField label="AI Agent Name">
                  <input
                    type="text"
                    value={form.aiAgentName}
                    onChange={(e) => set('aiAgentName', e.target.value)}
                    placeholder="Aria"
                    className={INPUT_CLASS}
                  />
                </FormField>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                    Greeting Message
                  </label>
                  <textarea
                    rows={3}
                    value={form.greeting}
                    onChange={(e) => set('greeting', e.target.value)}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use {'{business_name}'} and {'{agent_name}'} as placeholders.
                  </p>
                </div>
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
                {loading ? 'Creating…' : 'Create Business'}
              </button>
              <Link
                href="/dashboard"
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Skip — use demo data
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

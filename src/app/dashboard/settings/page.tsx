'use client';

import { useState, useEffect } from 'react';
import { MOCK_RESTAURANT } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [business, setBusiness] = useState({ ...MOCK_RESTAURANT });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    getActiveBusiness(supabase).then((b) => {
      if (!b) return;
      setBusinessId(b.id);
      setBusiness((prev) => ({
        ...prev,
        name: b.name,
        phone: b.phone ?? prev.phone,
        email: b.email ?? prev.email,
        greetingMessage: b.greeting ?? prev.greetingMessage,
        timezone: b.timezone ?? prev.timezone,
      }));
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaving(true);

    try {
      if (businessId && isSupabaseConfigured) {
        const supabase = createClient();
        const { error } = await supabase
          .from('businesses')
          .update({
            name: business.name,
            phone: business.phone || null,
            email: business.email || null,
            greeting: business.greetingMessage || null,
            timezone: business.timezone,
          })
          .eq('id', businessId);

        if (error) {
          setSaveError(error.message);
          return;
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your business and AI assistant settings.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Business Information</h2>
          </div>
          <div className="p-5 space-y-4">
            <Field
              label="Business Name"
              value={business.name}
              onChange={(v) => setBusiness((r) => ({ ...r, name: v }))}
            />
            <Field
              label="Phone Number"
              value={business.phone}
              onChange={(v) => setBusiness((r) => ({ ...r, phone: v }))}
            />
            <Field
              label="Address"
              value={business.address}
              onChange={(v) => setBusiness((r) => ({ ...r, address: v }))}
            />
            <Field
              label="Email"
              value={business.email}
              type="email"
              onChange={(v) => setBusiness((r) => ({ ...r, email: v }))}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">AI Assistant</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                AI Voice
              </label>
              <select
                value={business.aiVoice}
                onChange={(e) => setBusiness((r) => ({ ...r, aiVoice: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option>Female – Warm</option>
                <option>Female – Professional</option>
                <option>Male – Warm</option>
                <option>Male – Professional</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Greeting Message
              </label>
              <textarea
                rows={3}
                value={business.greetingMessage}
                onChange={(e) => setBusiness((r) => ({ ...r, greetingMessage: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">Use {'{business_name}'} as a placeholder.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Staff Callback Window
              </label>
              <select
                value={business.callbackWindow}
                onChange={(e) => setBusiness((r) => ({ ...r, callbackWindow: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option>1 hour</option>
                <option>2 hours</option>
                <option>4 hours</option>
                <option>Next business day</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Told to callers when logging a reservation or service request.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Notifications</h2>
          </div>
          <div className="p-5 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={business.notifyEmail}
                onChange={(e) => setBusiness((r) => ({ ...r, notifyEmail: e.target.checked }))}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-sm text-gray-700">Email notifications for new requests</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={business.notifySms}
                onChange={(e) => setBusiness((r) => ({ ...r, notifySms: e.target.checked }))}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-sm text-gray-700">SMS notifications for new requests</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">
              {businessId ? 'Saved to your account!' : 'Settings saved!'}
            </span>
          )}
          {saveError && (
            <span className="text-sm text-red-600">{saveError}</span>
          )}
        </div>

        <p className="text-xs text-gray-400">
          {businessId
            ? 'Changes to name, phone, email, and greeting are saved to your account.'
            : 'Demo mode — settings are saved locally and reset on page refresh.'}
        </p>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
    </div>
  );
}

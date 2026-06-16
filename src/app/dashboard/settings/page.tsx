'use client';

import { useState, useEffect, useRef } from 'react';
import { MOCK_RESTAURANT } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { useDashboardMode } from '@/lib/dashboard-mode';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import BillingCard from '@/components/BillingCard';
import type { AgentConfig } from '@/lib/supabase/businesses';
import {
  ENABLED_VOICE_OPTIONS,
  getVoiceById,
  DEFAULT_VOICE_OPTION,
} from '@/lib/voice/voices';

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tone: 'friendly',
  staff_handoff_rule: 'Escalate urgent, angry, or complex calls to staff.',
  booking_rule: 'Never confirm appointments automatically. Mark as pending until staff confirms.',
  callback_expectation: 'Staff will follow up within 2 hours during business hours.',
  collect_name: true,
  collect_phone: true,
  collect_service: true,
  collect_notes: true,
};

const TIMEZONES = [
  'America/Vancouver',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Toronto',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];


function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Vancouver';
  } catch {
    return 'America/Vancouver';
  }
}

export default function SettingsPage() {
  const { isDemo } = useDashboardMode();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [business, setBusiness] = useState({ ...MOCK_RESTAURANT });

  // Agent configuration — persisted to businesses.ai_agent_name and businesses.agent_config
  const [agentName, setAgentName] = useState('');
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({ ...DEFAULT_AGENT_CONFIG });

  // Voice preview ("Test voice & speed") — previews the CURRENTLY selected (unsaved) voice + speed.
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Plays an audio URL with the selected speed. Resolves true if playback started, false on
  // load/play failure (so the caller can fall back). `revoke` revokes a blob URL when done.
  function playPreview(url: string, revoke: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.playbackRate = agentConfig.voice_speed ?? 1.0; // matches Realtime audio.output.speed
      previewAudioRef.current = audio;
      const cleanup = () => { if (revoke) URL.revokeObjectURL(url); };
      audio.onended = () => { setPreviewState('idle'); cleanup(); previewAudioRef.current = null; };
      audio.onerror = () => { cleanup(); resolve(false); };
      audio.play().then(() => { setPreviewState('playing'); resolve(true); }).catch(() => { cleanup(); resolve(false); });
    });
  }

  async function testVoice() {
    // Restart if already playing.
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewError('');
    const option = getVoiceById(agentConfig.voice_id) ?? DEFAULT_VOICE_OPTION;

    // 1. Pre-recorded clip — instant, no network.
    if (await playPreview(option.previewAudioUrl, false)) return;

    // 2. Fallback: synthesize live (slower) when the static clip isn't available.
    setPreviewState('loading');
    try {
      const res = await fetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: option.runtimeVoiceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Preview failed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (!(await playPreview(url, true))) {
        throw new Error('Could not play the preview audio.');
      }
    } catch (err) {
      setPreviewState('error');
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    // Demo mode never loads the real business — keep the mock profile and make saves a no-op
    // (businessId stays null, so handleSave skips the DB write).
    if (isDemo || !isSupabaseConfigured) return;
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
        // No saved timezone → default to the browser's timezone (else America/Vancouver).
        timezone: b.timezone || browserTimezone(),
      }));
      setAgentName(b.ai_agent_name ?? '');
      if (b.agent_config) {
        setAgentConfig((prev) => ({ ...prev, ...(b.agent_config as AgentConfig) }));
      }
    });
  }, [isDemo]);

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
            ai_agent_name: agentName || null,
            agent_config: agentConfig,
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
    <div className="w-full max-w-2xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your business and front desk settings.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        {/* ── Business Information ────────────────────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
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
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Business Timezone
              </label>
              <select
                value={business.timezone}
                onChange={(e) => setBusiness((r) => ({ ...r, timezone: e.target.value }))}
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {/* Include any saved value not already in the list, so it never silently changes. */}
                {(TIMEZONES.includes(business.timezone) ? TIMEZONES : [business.timezone, ...TIMEZONES]).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Used to interpret dates like today, tomorrow, Friday, and next week.
              </p>
            </div>
          </div>
        </div>

        {/* ── Front desk (greeting / voice) ─────────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">Front Desk Configuration</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Voice, greeting, and behavior — saved to your account and used by your front desk on every call.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                AI Voice
              </label>
              <select
                value={agentConfig.voice_id ?? ''}
                onChange={(e) =>
                  setAgentConfig((prev) => ({ ...prev, voice_id: e.target.value || undefined }))
                }
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">Default</option>
                {ENABLED_VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>{v.displayName}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Preset voices. &ldquo;Default&rdquo; uses the standard voice.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Speaking speed — {(agentConfig.voice_speed ?? 1.0).toFixed(2)}×
              </label>
              <input
                type="range"
                min={0.85}
                max={1.25}
                step={0.05}
                value={agentConfig.voice_speed ?? 1.0}
                onChange={(e) =>
                  setAgentConfig((prev) => ({ ...prev, voice_speed: parseFloat(e.target.value) }))
                }
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                <span>0.90 slower</span>
                <span>1.00 normal</span>
                <span>1.10 faster</span>
                <span>1.20 fast</span>
              </div>

              {/* Preview the selected voice + speed (uses current, unsaved values). */}
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={testVoice}
                  disabled={previewState === 'loading' || previewState === 'playing'}
                  className="fd-btn fd-btn-ghost"
                >
                  {previewState === 'loading'
                    ? 'Loading…'
                    : previewState === 'playing'
                      ? 'Playing…'
                      : '▶ Test voice & speed'}
                </button>
                {previewState === 'error' && (
                  <span className="text-xs" style={{ color: 'var(--danger)' }}>{previewError}</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Greeting Message
              </label>
              <textarea
                rows={3}
                value={business.greetingMessage}
                onChange={(e) => setBusiness((r) => ({ ...r, greetingMessage: e.target.value }))}
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                Use <code className="bg-gray-100 px-1 rounded">{'{business_name}'}</code> and{' '}
                <code className="bg-gray-100 px-1 rounded">{'{agent_name}'}</code> as placeholders.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Staff Callback Window
              </label>
              <select
                value={business.callbackWindow}
                onChange={(e) => setBusiness((r) => ({ ...r, callbackWindow: e.target.value }))}
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
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
            {/* Divider between voice/greeting and agent behavior */}
            <div className="border-t fd-hairline" />

            {/* Agent Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Agent Name
              </label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Ava"
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <p className="text-xs text-gray-400 mt-1">
                Name your AI front desk agent. Used in the agent greeting and voice calls.
              </p>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Tone
              </label>
              <select
                value={agentConfig.tone ?? 'friendly'}
                onChange={(e) => setAgentConfig((prev) => ({ ...prev, tone: e.target.value }))}
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="concise">Concise</option>
              </select>
            </div>

            {/* Callback Expectation */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Callback Expectation
              </label>
              <input
                type="text"
                value={agentConfig.callback_expectation ?? ''}
                onChange={(e) =>
                  setAgentConfig((prev) => ({ ...prev, callback_expectation: e.target.value }))
                }
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <p className="text-xs text-gray-400 mt-1">
                Told to callers after logging a request. Shown in the call summary.
              </p>
            </div>

            {/* Staff Handoff Rule */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Staff Handoff Rule
              </label>
              <textarea
                rows={2}
                value={agentConfig.staff_handoff_rule ?? ''}
                onChange={(e) =>
                  setAgentConfig((prev) => ({ ...prev, staff_handoff_rule: e.target.value }))
                }
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                When should the front desk hand off to your staff? e.g. Escalate urgent or angry callers.
              </p>
            </div>

            {/* Booking / Appointment Rule */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Booking / Appointment Rule
              </label>
              <textarea
                rows={2}
                value={agentConfig.booking_rule ?? ''}
                onChange={(e) =>
                  setAgentConfig((prev) => ({ ...prev, booking_rule: e.target.value }))
                }
                className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                e.g. Never confirm appointments automatically. Always mark as pending.
              </p>
            </div>

            {/* Information Collection */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Information to Collect from Callers
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                {(
                  [
                    { key: 'collect_name', label: 'Customer name' },
                    { key: 'collect_phone', label: 'Phone number' },
                    { key: 'collect_service', label: 'Service / date / time' },
                    { key: 'collect_notes', label: 'Notes / special requests' },
                  ] as { key: keyof AgentConfig; label: string }[]
                ).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(agentConfig[key] as boolean) ?? true}
                      onChange={(e) =>
                        setAgentConfig((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── Plan & billing (Stripe) ─────────────────────────── */}
        <BillingCard />

        {/* ── After-hours report ──────────────────────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">After-hours report</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              A daily summary of calls captured while your business was closed or unavailable — with a CSV report for easy follow-up. No need to monitor another dashboard.
            </p>
          </div>
          <div className="p-5 space-y-5">
            {/* Email digest */}
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentConfig.notify_email ?? false}
                  onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_email: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-sm text-gray-700">Email me a daily report (summary + CSV)</span>
              </label>
              {(agentConfig.notify_email ?? false) && (
                <input
                  type="email"
                  value={agentConfig.notify_email_to ?? ''}
                  onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_email_to: e.target.value }))}
                  placeholder={business.email ? `Default: ${business.email}` : 'you@yourbusiness.com'}
                  className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              )}
            </div>

            {/* SMS alert */}
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentConfig.notify_sms ?? false}
                  onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_sms: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-sm text-gray-700">Text me when the report is ready</span>
              </label>
              {(agentConfig.notify_sms ?? false) && (
                <input
                  type="tel"
                  value={agentConfig.notify_sms_to ?? ''}
                  onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_sms_to: e.target.value }))}
                  placeholder={business.phone ? `Default: ${business.phone}` : '+1 (555) 123-4567'}
                  className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              )}
            </div>

            {/* Send time */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Send the report at
              </label>
              <select
                value={agentConfig.digest_send_hour ?? 8}
                onChange={(e) => setAgentConfig((prev) => ({ ...prev, digest_send_hour: parseInt(e.target.value, 10) }))}
                className="w-full sm:w-48 border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`} (your timezone)
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-400">
              FrontDesk protects calls you were already missing. Leave a destination blank to use your business email/phone above. Demo calls are never included.
            </p>
          </div>
        </div>

        {/* ── Submit ──────────────────────────────────────────── */}
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
            ? 'Business info, greeting, agent name, and agent configuration are saved to your account.'
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
        className="w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
    </div>
  );
}

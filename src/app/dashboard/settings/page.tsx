'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
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

  // Whether the production email sender (NOTIFY_EMAIL_FROM) is configured, from /api/notify-status.
  // null = unknown (not loaded yet or probe failed) → we still show the no-domain notice, so we
  // never imply production email is ready while the sender domain is unconfirmed.
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  // "Send test SMS" — fires /api/notify-test-sms, which texts the SAVED SMS destination only.
  const [smsTest, setSmsTest] = useState<{ state: 'idle' | 'sending'; msg: string }>({ state: 'idle', msg: '' });

  // Collapsible sections — keep the page calm: advanced agent tuning and billing are hidden by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  async function sendTestSms() {
    setSmsTest({ state: 'sending', msg: '' });
    try {
      const res = await fetch('/api/notify-test-sms', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      const reasonText: Record<string, string> = {
        sms_not_configured: 'SMS isn’t enabled on the server yet (Twilio env not set).',
        no_destination: 'No SMS number saved — add one and save first.',
        no_business: 'No business found for your account.',
        rate_limited: 'Too many tests — wait a minute and retry.',
        unauthorized: 'Please sign in again.',
        provider_401: 'Twilio rejected the credentials (401). Check TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are the live pair from the same account, the account is active, and the From number belongs to that account.',
        provider_400: 'Twilio rejected the request (400) — usually the number format. Use E.164, e.g. +17787985201.',
        provider_404: 'Twilio couldn’t find the account (404) — check TWILIO_ACCOUNT_SID.',
      };
      // Masked diagnostics (booleans only, no secrets) → a short, value-free issue list.
      const diagIssues = (diag: Record<string, boolean> | undefined): string => {
        if (!diag) return '';
        const issues: string[] = [];
        if (diag.accountSidPresent === false) issues.push('Account SID missing');
        else if (diag.accountSidPrefixOk === false) issues.push('Account SID not in “AC…” format');
        if (diag.accountSidWhitespace) issues.push('Account SID has surrounding spaces');
        if (diag.authTokenPresent === false) issues.push('Auth token missing');
        if (diag.authTokenWhitespace) issues.push('Auth token has surrounding spaces');
        if (diag.fromPresent === false) issues.push('From number missing');
        else if (diag.fromLooksE164 === false) issues.push('From number not E.164 (+1…)');
        return issues.length ? ` Checks: ${issues.join('; ')}.` : '';
      };
      let msg: string;
      if (d.ok) {
        msg = `Test SMS sent to ${d.to ?? 'your number'}.`;
      } else {
        const base =
          reasonText[d.reason as string] ??
          (typeof d.reason === 'string' && d.reason.startsWith('provider_')
            ? `Twilio rejected the request (${d.reason}); see server logs for the Twilio error code.`
            : d.reason) ??
          `error ${res.status}`;
        msg = `Couldn’t send: ${base}${diagIssues(d.diag)}`;
      }
      setSmsTest({ state: 'idle', msg });
    } catch {
      setSmsTest({ state: 'idle', msg: 'Couldn’t send — network error.' });
    }
  }

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
    // Read-only capability probe — only booleans, no secrets. Drives the no-domain email notice.
    fetch('/api/notify-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEmailConfigured(d && typeof d.emailConfigured === 'boolean' ? d.emailConfigured : null))
      .catch(() => setEmailConfigured(null));
  }, []);

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

  const fieldLabel = 'block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5';
  const fieldInput =
    'w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400';

  return (
    <div className="w-full max-w-2xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set up your business and your daily after-hours report.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        {/* ── 1. Service setup ──────────────────────────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">Service setup</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Your business details. These default the report destination and the front desk greeting.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <Field label="Business name" value={business.name} onChange={(v) => setBusiness((r) => ({ ...r, name: v }))} />
            <Field label="Business phone" value={business.phone} onChange={(v) => setBusiness((r) => ({ ...r, phone: v }))} />
            <Field label="Business email" value={business.email} type="email" onChange={(v) => setBusiness((r) => ({ ...r, email: v }))} />
            <div>
              <label className={fieldLabel}>Business timezone</label>
              <select
                value={business.timezone}
                onChange={(e) => setBusiness((r) => ({ ...r, timezone: e.target.value }))}
                className={fieldInput}
              >
                {/* Include any saved value not already in the list, so it never silently changes. */}
                {(TIMEZONES.includes(business.timezone) ? TIMEZONES : [business.timezone, ...TIMEZONES]).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Used to interpret dates like today, tomorrow, Friday, and next week — and the report send time.
              </p>
            </div>
            <div>
              <label className={fieldLabel}>Business hours</label>
              <input
                type="text"
                value={agentConfig.business_hours ?? ''}
                onChange={(e) => setAgentConfig((prev) => ({ ...prev, business_hours: e.target.value }))}
                placeholder="e.g. Mon–Fri 9am–6pm, Sat 10am–4pm"
                className={fieldInput}
              />
              <p className="text-xs text-gray-400 mt-1">
                Optional. Helps the front desk answer “are you open?” and set callback expectations.
              </p>
            </div>
          </div>
        </div>

        {/* ── 2. After-hours report (the main card) ─────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">After-hours report</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Get one daily summary of calls FrontDesk captured while your team was unavailable.
              Email is the main report; SMS is an optional short alert.
            </p>
          </div>
          <div className="p-5 space-y-5">
            {/* No-domain notice — shown until the production email sender (NOTIFY_EMAIL_FROM) is
                confirmed configured. Unknown status also shows it, so we never imply email is ready. */}
            {emailConfigured !== true && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
                <p className="text-xs text-amber-800 leading-relaxed">
                  <span className="font-semibold">Email delivery is domain-gated.</span>{' '}
                  Until a sender domain is configured, reports can be generated and SMS alerts can be
                  tested, but production email delivery is not fully enabled.
                </p>
              </div>
            )}

            {/* Daily email report (primary) */}
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentConfig.notify_email ?? false}
                  onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_email: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-sm text-gray-700">Send daily report</span>
              </label>
              {(agentConfig.notify_email ?? false) && (
                <div className="pl-7 space-y-3">
                  <div>
                    <label className={fieldLabel}>Report email</label>
                    <input
                      type="email"
                      value={agentConfig.notify_email_to ?? ''}
                      onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_email_to: e.target.value }))}
                      placeholder={business.email ? `Default: ${business.email}` : 'you@yourbusiness.com'}
                      className={fieldInput}
                    />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agentConfig.attach_csv !== false}
                      onChange={(e) => setAgentConfig((prev) => ({ ...prev, attach_csv: e.target.checked }))}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-sm text-gray-700">Attach CSV</span>
                  </label>
                </div>
              )}
            </div>

            {/* Send time */}
            <div>
              <label className={fieldLabel}>Send report at</label>
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
              <p className="text-xs text-gray-400 mt-1">
                Your report is delivered once a day. The exact hour is approximate.
              </p>
            </div>

            {/* SMS alert (optional) */}
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
              <p className="text-xs text-gray-400">
                Optional. Use this only if you want a short text alert in addition to the email report.
              </p>
              {(agentConfig.notify_sms ?? false) && (
                <div className="pl-7 space-y-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      SMS alert number
                    </label>
                    <input
                      type="tel"
                      value={agentConfig.notify_sms_to ?? ''}
                      onChange={(e) => setAgentConfig((prev) => ({ ...prev, notify_sms_to: e.target.value }))}
                      placeholder={business.phone ? `Default: ${business.phone}` : '+1 (555) 123-4567'}
                      className={fieldInput}
                    />
                  </div>
                  {businessId && (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          type="button"
                          onClick={sendTestSms}
                          disabled={smsTest.state === 'sending'}
                          className="fd-btn fd-btn-ghost"
                        >
                          {smsTest.state === 'sending' ? 'Sending…' : 'Send test SMS'}
                        </button>
                        {smsTest.msg && <span className="text-xs text-gray-500">{smsTest.msg}</span>}
                      </div>
                      <p className="text-[11px] text-gray-400">
                        Texts your <strong>saved</strong> SMS number — save changes first if you just edited it.
                        On a Twilio trial, the number must be verified.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400">
              FrontDesk reports the calls you were already missing. Leave a destination blank to use
              your business email/phone above. Demo calls are never included.
            </p>
          </div>
        </div>

        {/* ── 3. Test FrontDesk ─────────────────────────────────── */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">Test FrontDesk</h2>
          </div>
          <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-gray-500">
              Make a test call and confirm it appears in Call History.
            </p>
            <Link href="/dashboard/voice" className="fd-btn fd-btn-ghost whitespace-nowrap self-start sm:self-auto">
              ▶ Test FrontDesk
            </Link>
          </div>
        </div>

        {/* ── 4. Front desk behavior (compact; advanced collapsed) ─ */}
        <div className="fd-card overflow-hidden">
          <div className="px-5 py-4 border-b fd-hairline">
            <h2 className="font-semibold text-gray-900">Front desk behavior</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              How your front desk sounds and what it captures. The defaults work well — fine-tune later.
            </p>
          </div>
          <div className="p-5 space-y-4">
            {/* Front desk name */}
            <div>
              <label className={fieldLabel}>Front desk name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Ava"
                className={fieldInput}
              />
              <p className="text-xs text-gray-400 mt-1">Used in the greeting and on calls.</p>
            </div>

            {/* Tone */}
            <div>
              <label className={fieldLabel}>Tone</label>
              <select
                value={agentConfig.tone ?? 'friendly'}
                onChange={(e) => setAgentConfig((prev) => ({ ...prev, tone: e.target.value }))}
                className={fieldInput}
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="concise">Concise</option>
              </select>
            </div>

            {/* What to collect */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                What to collect from callers
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

            {/* Advanced behavior — collapsed by default */}
            <div className="border-t fd-hairline pt-4">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                aria-expanded={advancedOpen}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                <span className="text-gray-400 w-3 inline-block">{advancedOpen ? '▾' : '▸'}</span>
                Advanced behavior
              </button>
              {!advancedOpen && (
                <p className="text-xs text-gray-400 mt-1 pl-5">
                  Voice &amp; speed, greeting, callback window, and staff / booking rules.
                </p>
              )}

              {advancedOpen && (
                <div className="mt-4 space-y-4">
                  {/* AI Voice */}
                  <div>
                    <label className={fieldLabel}>AI voice</label>
                    <select
                      value={agentConfig.voice_id ?? ''}
                      onChange={(e) =>
                        setAgentConfig((prev) => ({ ...prev, voice_id: e.target.value || undefined }))
                      }
                      className={fieldInput}
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

                  {/* Speaking speed + preview */}
                  <div>
                    <label className={fieldLabel}>
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

                  {/* Greeting */}
                  <div>
                    <label className={fieldLabel}>Greeting message</label>
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

                  {/* Staff Callback Window */}
                  <div>
                    <label className={fieldLabel}>Staff callback window</label>
                    <select
                      value={business.callbackWindow}
                      onChange={(e) => setBusiness((r) => ({ ...r, callbackWindow: e.target.value }))}
                      className={fieldInput}
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

                  {/* Callback Expectation */}
                  <div>
                    <label className={fieldLabel}>Callback expectation</label>
                    <input
                      type="text"
                      value={agentConfig.callback_expectation ?? ''}
                      onChange={(e) =>
                        setAgentConfig((prev) => ({ ...prev, callback_expectation: e.target.value }))
                      }
                      className={fieldInput}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Told to callers after logging a request. Shown in the call summary.
                    </p>
                  </div>

                  {/* Staff Handoff Rule */}
                  <div>
                    <label className={fieldLabel}>Staff handoff rule</label>
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
                    <label className={fieldLabel}>Booking / appointment rule</label>
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
                </div>
              )}
            </div>
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
            ? 'Business info, after-hours report, and front desk behavior are saved to your account.'
            : 'Demo mode — settings are saved locally and reset on page refresh.'}
        </p>

      </form>

      {/* ── Plan & billing — deprioritized: collapsed, below the fold, outside the form ── */}
      <div className="mt-8 pt-2">
        {billingOpen ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setBillingOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ▾ Hide plan &amp; billing
            </button>
            <BillingCard />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setBillingOpen(true)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ▸ Plan &amp; billing
          </button>
        )}
      </div>
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

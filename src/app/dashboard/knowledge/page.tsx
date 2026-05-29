'use client';

import { useState, useEffect } from 'react';
import {
  MOCK_KNOWLEDGE,
  MOCK_AGENT_CONFIG,
  MOCK_CUSTOM_INSTRUCTIONS,
  MOCK_RESTAURANT,
} from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import type { AgentConfig } from '@/lib/supabase/businesses';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeItem {
  id: string;
  business_id: string;
  category: string;
  question: string;
  answer: string;
  created_at: string;
}

interface Draft {
  category: string;
  question: string;
  answer: string;
}

type Tab = 'profile' | 'qa' | 'instructions';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_DRAFT: Draft = { category: '', question: '', answer: '' };

const INPUT_CLASS =
  'w-full border fd-hairline-strong rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400';

const LABEL_CLASS = 'block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5';

const BUSINESS_TYPE_OPTIONS = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'auto_repair', label: 'Auto Repair Shop' },
  { value: 'salon', label: 'Salon / Spa' },
  { value: 'clinic', label: 'Clinic / Medical' },
  { value: 'tutoring', label: 'Tutoring / Education' },
  { value: 'home_services', label: 'Home Services' },
  { value: 'other', label: 'Other' },
];

const TONE_TAGS = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'calm', label: 'Calm' },
  { value: 'direct', label: 'Direct' },
  { value: 'efficient', label: 'Efficient' },
  { value: 'professional', label: 'Professional' },
  { value: 'warm', label: 'Warm' },
];

const REQUEST_TYPES = [
  { value: 'appointments', label: 'Appointments' },
  { value: 'service_requests', label: 'Service requests' },
  { value: 'inquiries', label: 'General inquiries' },
  { value: 'orders', label: 'Orders / takeout' },
];

const COLLECT_FIELDS: { key: keyof AgentConfig; label: string }[] = [
  { key: 'collect_name', label: 'Caller name' },
  { key: 'collect_phone', label: 'Phone number' },
  { key: 'collect_service', label: 'Service / date / time' },
  { key: 'collect_notes', label: 'Notes / special requests' },
  { key: 'collect_urgency', label: 'Urgency level' },
];

const DEFAULT_CONFIG: AgentConfig = {
  tone: 'friendly',
  tone_tags: ['friendly', 'calm', 'direct', 'efficient'],
  business_hours: '',
  walk_in_allowed: false,
  appointments_require_confirmation: true,
  main_request_types: ['appointments', 'service_requests', 'inquiries'],
  staff_handoff_rule: 'Escalate urgent, angry, or complex calls to staff immediately.',
  booking_rule: 'Never confirm appointments automatically. Mark as pending until staff confirms.',
  callback_expectation: 'Staff will follow up within 2 hours during business hours.',
  collect_name: true,
  collect_phone: true,
  collect_service: true,
  collect_notes: true,
  collect_urgency: false,
  custom_instructions: '',
};

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Business profile' },
    { id: 'qa', label: 'Q&A' },
    { id: 'instructions', label: 'Custom instructions' },
  ];
  return (
    <div className="flex gap-1 border-b fd-hairline-strong mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.id
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Profile tab helpers ──────────────────────────────────────────────────────

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900 truncate">{value || '—'}</p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`flex-shrink-0 relative w-10 h-6 rounded-full transition-colors ${
          checked ? 'bg-orange-500' : 'bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </div>
  );
}

function CheckCard({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
        checked
          ? 'border-orange-200 bg-orange-50/50'
          : 'fd-hairline hover:fd-hairline-strong hover:bg-gray-50'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 accent-orange-500 flex-shrink-0"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// ─── Layer 1: Business Profile tab ───────────────────────────────────────────

function ProfileTab({
  config,
  businessName,
  businessType,
  businessPhone,
  businessCity,
  businessRegion,
  isDemo,
  businessId,
  onChange,
}: {
  config: AgentConfig;
  businessName: string;
  businessType: string;
  businessPhone: string;
  businessCity: string;
  businessRegion: string;
  isDemo: boolean;
  businessId: string;
  onChange: (c: AgentConfig) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Local state for editable identity fields
  const [localName, setLocalName] = useState(businessName);
  const [localType, setLocalType] = useState(businessType);
  const [localPhone, setLocalPhone] = useState(businessPhone);
  const [localCity, setLocalCity] = useState(businessCity);
  const [localRegion, setLocalRegion] = useState(businessRegion);

  function setField<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    onChange({ ...config, [key]: value });
    setIsDirty(true);
  }

  function toggleToneTag(tag: string) {
    const current = config.tone_tags ?? [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setField('tone_tags', next.length > 0 ? next : [tag]);
  }

  function toggleRequestType(type: string) {
    const current = config.main_request_types ?? [];
    setField(
      'main_request_types',
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from('businesses')
        .update({
          name: localName.trim(),
          business_type: localType,
          phone: localPhone.trim() || null,
          city: localCity.trim() || null,
          region: localRegion.trim() || null,
          agent_config: config,
        })
        .eq('id', businessId);
      if (err) { setError(err.message); return; }
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const toneTags = config.tone_tags ?? [];
  const requestTypes = config.main_request_types ?? [];

  return (
    <div className="space-y-4 max-w-2xl pb-20">

      {/* ── 1. Business identity ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Business identity</h2>
          <p className="text-xs text-gray-400 mt-0.5">Basic facts about your business. Used in every call.</p>
        </div>
        <div className="px-5 py-4">
          {isDemo ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoPair label="Business name" value={localName} />
              <InfoPair label="Business type" value={localType} />
              <InfoPair label="Phone" value={localPhone} />
              <InfoPair label="Location" value={[localCity, localRegion].filter(Boolean).join(', ')} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={LABEL_CLASS}>Business name</label>
                <input
                  type="text"
                  value={localName}
                  onChange={(e) => { setLocalName(e.target.value); setIsDirty(true); }}
                  placeholder="Your business name"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Business type</label>
                <select
                  value={localType}
                  onChange={(e) => { setLocalType(e.target.value); setIsDirty(true); }}
                  className={INPUT_CLASS}
                >
                  {BUSINESS_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Phone</label>
                <input
                  type="tel"
                  value={localPhone}
                  onChange={(e) => { setLocalPhone(e.target.value); setIsDirty(true); }}
                  placeholder="(555) 867-5309"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>City / service area</label>
                <input
                  type="text"
                  value={localCity}
                  onChange={(e) => { setLocalCity(e.target.value); setIsDirty(true); }}
                  placeholder="Springfield"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>State / region</label>
                <input
                  type="text"
                  value={localRegion}
                  onChange={(e) => { setLocalRegion(e.target.value); setIsDirty(true); }}
                  placeholder="IL"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Operating basics ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Operating basics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Tells callers when you&apos;re open and how you handle visits.</p>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div>
            <label className={LABEL_CLASS}>Business hours</label>
            <input
              type="text"
              value={config.business_hours ?? ''}
              onChange={(e) => setField('business_hours', e.target.value)}
              placeholder="e.g. Mon–Fri 9am–6pm, Sat 10am–4pm, Closed Sundays"
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-4">
            <ToggleRow
              label="Walk-ins welcome"
              description="If off, callers are told appointments are preferred."
              checked={config.walk_in_allowed ?? false}
              onChange={() => setField('walk_in_allowed', !(config.walk_in_allowed ?? false))}
            />
            <ToggleRow
              label="Staff must confirm appointments"
              description="Front desk never confirms bookings automatically — always marks as pending."
              checked={config.appointments_require_confirmation ?? true}
              onChange={() =>
                setField(
                  'appointments_require_confirmation',
                  !(config.appointments_require_confirmation ?? true),
                )
              }
            />
          </div>
        </div>
      </div>

      {/* ── 3. Front desk tone ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Front desk tone</h2>
          <p className="text-xs text-gray-400 mt-0.5">Select one or more styles that fit your business.</p>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {TONE_TAGS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleToneTag(value)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  toneTags.includes(value)
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-white fd-hairline-strong text-gray-600 hover:border-orange-300 hover:text-orange-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 4. Request types ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Request types</h2>
          <p className="text-xs text-gray-400 mt-0.5">What kinds of calls should your front desk handle?</p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {REQUEST_TYPES.map(({ value, label }) => (
            <CheckCard
              key={value}
              label={label}
              checked={requestTypes.includes(value)}
              onChange={() => toggleRequestType(value)}
            />
          ))}
        </div>
      </div>

      {/* ── 5. Details to collect when action is needed ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Details to collect when action is needed</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Only collected when the caller wants an appointment, callback, service request, or staff follow-up — not for general questions.
          </p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {COLLECT_FIELDS.map(({ key, label }) => (
            <CheckCard
              key={key}
              label={label}
              checked={(config[key] as boolean) ?? (key !== 'collect_urgency')}
              onChange={() => setField(key, !((config[key] as boolean) ?? (key !== 'collect_urgency')))}
            />
          ))}
        </div>
      </div>

      {/* ── 6. Response rules ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Response rules</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            How your front desk handles callbacks, escalations, and booking confirmation.
          </p>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div>
            <label className={LABEL_CLASS}>Callback expectation</label>
            <input
              type="text"
              value={config.callback_expectation ?? ''}
              onChange={(e) => setField('callback_expectation', e.target.value)}
              placeholder="e.g. Staff will follow up within 2 hours during business hours"
              className={INPUT_CLASS}
            />
            <p className="text-xs text-gray-400 mt-1.5">Told to callers after their request is logged.</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Escalation rule</label>
            <textarea
              rows={2}
              value={config.staff_handoff_rule ?? ''}
              onChange={(e) => setField('staff_handoff_rule', e.target.value)}
              placeholder="e.g. Escalate urgent, angry, or complex calls to staff immediately."
              className={`${INPUT_CLASS} resize-none`}
            />
            <p className="text-xs text-gray-400 mt-1.5">When should the front desk hand off to a human?</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Appointment / booking rule</label>
            <textarea
              rows={2}
              value={config.booking_rule ?? ''}
              onChange={(e) => setField('booking_rule', e.target.value)}
              placeholder="e.g. Never confirm appointments automatically. Always mark as pending."
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {isDemo && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
          <strong>Demo mode</strong> — sign in to save your business profile.
        </p>
      )}

      {!isDemo && (
        <div className="fixed bottom-0 left-64 right-0 bg-white border-t fd-hairline shadow-sm z-20">
          <div className="px-6 py-3 flex items-center gap-4">
            <span className="text-sm min-w-[120px]">
              {saved ? (
                <span className="text-green-600 font-medium">Saved!</span>
              ) : isDirty ? (
                <span className="text-gray-400">Unsaved changes</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="ml-auto bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Layer 2: Q&A tab ─────────────────────────────────────────────────────────

function QATab({
  initialItems,
  businessId,
  isDemo,
  loadError,
}: {
  initialItems: KnowledgeItem[];
  businessId: string;
  isDemo: boolean;
  loadError: string | null;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [opError, setOpError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const categories = [...new Set(items.map((e) => e.category))].sort();

  function startEdit(item: KnowledgeItem) {
    setIsAdding(false);
    setEditingId(item.id);
    setDraft({ category: item.category, question: item.question, answer: item.answer });
    setOpError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setOpError('');
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!draft.category.trim() || !draft.question.trim() || !draft.answer.trim()) {
      setOpError('All fields are required.');
      return;
    }
    setOpError('');
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('business_knowledge')
        .update({
          category: draft.category.trim(),
          question: draft.question.trim(),
          answer: draft.answer.trim(),
        })
        .eq('id', editingId)
        .eq('business_id', businessId);
      if (error) { setOpError(error.message); return; }
      setItems((prev) =>
        prev.map((item) =>
          item.id === editingId ? { ...item, ...draft } : item
        )
      );
      cancelEdit();
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    setOpError('');
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('business_knowledge')
        .delete()
        .eq('id', id)
        .eq('business_id', businessId);
      if (error) { setOpError(error.message); return; }
      setItems((prev) => prev.filter((item) => item.id !== id));
      cancelEdit();
    } finally {
      setSaving(false);
    }
  }

  function startAdd(suggestedCategory = '') {
    setEditingId(null);
    setIsAdding(true);
    setAddDraft({ ...EMPTY_DRAFT, category: suggestedCategory });
    setOpError('');
  }

  function cancelAdd() {
    setIsAdding(false);
    setAddDraft(EMPTY_DRAFT);
    setOpError('');
  }

  async function saveAdd() {
    if (!addDraft.category.trim() || !addDraft.question.trim() || !addDraft.answer.trim()) {
      setOpError('All fields are required.');
      return;
    }
    setOpError('');
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('business_knowledge')
        .insert({
          business_id: businessId,
          category: addDraft.category.trim(),
          question: addDraft.question.trim(),
          answer: addDraft.answer.trim(),
        })
        .select('*')
        .single();
      if (error) { setOpError(error.message); return; }
      setItems((prev) => [...prev, data as KnowledgeItem]);
      cancelAdd();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Add question/answer pairs your front desk can reference when callers ask specific questions.
        </p>
        {!isAdding && !isDemo && (
          <button
            onClick={() => startAdd()}
            className="flex-shrink-0 flex items-center gap-1.5 fd-btn fd-btn-accent text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add entry
          </button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load Q&A:</strong> {loadError}
        </div>
      )}
      {opError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {opError}
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <div className="mb-6 bg-white rounded-[6px] border border-orange-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-orange-50 border-b border-orange-200">
            <h3 className="font-semibold text-gray-900 text-sm">New entry</h3>
          </div>
          <div className="p-5 space-y-3">
            <input
              type="text"
              placeholder="Category (e.g. Hours, Pricing, Services)"
              value={addDraft.category}
              onChange={(e) => setAddDraft((d) => ({ ...d, category: e.target.value }))}
              className={INPUT_CLASS}
            />
            <input
              type="text"
              placeholder="Question"
              value={addDraft.question}
              onChange={(e) => setAddDraft((d) => ({ ...d, question: e.target.value }))}
              className={INPUT_CLASS}
            />
            <textarea
              rows={3}
              placeholder="Answer"
              value={addDraft.answer}
              onChange={(e) => setAddDraft((d) => ({ ...d, answer: e.target.value }))}
              className={`${INPUT_CLASS} resize-none`}
            />
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={saveAdd}
                disabled={saving}
                className="text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save entry'}
              </button>
              <button onClick={cancelAdd} className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !isAdding && !loadError && (
        <div className="fd-card px-6 py-12 text-center">
          <p className="text-gray-400 text-sm mb-3">No Q&A entries yet.</p>
          {!isDemo && (
            <button onClick={() => startAdd()} className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors">
              Add your first entry →
            </button>
          )}
        </div>
      )}

      {/* Entries grouped by category */}
      {categories.length > 0 && (
        <div className="space-y-6">
          {categories.map((category) => {
            const entries = items.filter((e) => e.category === category);
            return (
              <div key={category} className="fd-card overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b fd-hairline">
                  <h3 className="font-semibold text-gray-900 text-sm">{category}</h3>
                </div>
                <ul className="divide-y divide-[--hairline]">
                  {entries.map((entry) =>
                    editingId === entry.id ? (
                      <li key={entry.id} className="px-5 py-4 bg-orange-50/40">
                        <div className="space-y-3">
                          <input type="text" placeholder="Category" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} className={INPUT_CLASS} />
                          <input type="text" placeholder="Question" value={draft.question} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} className={INPUT_CLASS} />
                          <textarea rows={3} placeholder="Answer" value={draft.answer} onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))} className={`${INPUT_CLASS} resize-none`} />
                          <div className="flex items-center gap-3">
                            <button onClick={saveEdit} disabled={saving} className="text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors">{saving ? 'Saving…' : 'Save'}</button>
                            <button onClick={cancelEdit} className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                            <button onClick={() => deleteItem(entry.id)} disabled={saving} className="ml-auto text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-60 transition-colors">Delete</button>
                          </div>
                        </div>
                      </li>
                    ) : (
                      <li key={entry.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 mb-1">{entry.question}</p>
                            <p className="text-sm text-gray-500 leading-relaxed">{entry.answer}</p>
                          </div>
                          <button
                            onClick={isDemo ? undefined : () => startEdit(entry)}
                            disabled={isDemo}
                            className="flex-shrink-0 text-xs font-medium text-orange-600 hover:text-orange-700 px-2 py-1 border border-orange-200 rounded hover:bg-orange-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Edit
                          </button>
                        </div>
                      </li>
                    )
                  )}
                </ul>
                {!isDemo && (
                  <div className="px-5 py-3 border-t fd-hairline">
                    <button onClick={() => startAdd(category)} className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add entry to {category}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isDemo && (
        <div className="mt-6 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-700">
          <strong>Demo mode</strong> — sign in and set up your business to manage your own Q&A.
        </div>
      )}
    </div>
  );
}

// ─── Layer 3: Custom Instructions tab ────────────────────────────────────────

function InstructionsTab({
  config,
  isDemo,
  businessId,
  onChange,
}: {
  config: AgentConfig;
  isDemo: boolean;
  businessId: string;
  onChange: (c: AgentConfig) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from('businesses')
        .update({ agent_config: config })
        .eq('id', businessId);
      if (err) { setError(err.message); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-gray-500">
        Open-ended rules for situations that don&apos;t fit structured fields. The front desk follows these exactly.
      </p>

      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="font-semibold text-gray-900">Special rules</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            One rule per line. Plain language works best.
          </p>
        </div>
        <div className="p-5">
          <textarea
            rows={10}
            value={config.custom_instructions ?? ''}
            onChange={(e) => onChange({ ...config, custom_instructions: e.target.value })}
            placeholder={
              'Examples:\n' +
              '- If a caller asks about emergency service after hours, collect their address and mark the request urgent.\n' +
              '- Do not quote exact prices unless they are listed in Q&A.\n' +
              '- For frustrated callers, apologize first and offer a manager callback.'
            }
            className={`${INPUT_CLASS} resize-none font-mono text-xs leading-relaxed`}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
      )}

      {isDemo ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
          <strong>Demo mode</strong> — sign in to save custom instructions.
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save instructions'}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [tab, setTab] = useState<Tab>('profile');
  const [businessId, setBusinessId] = useState('');
  const [businessName, setBusinessName] = useState(isSupabaseConfigured ? '' : MOCK_RESTAURANT.name);
  const [businessType, setBusinessType] = useState<string>(isSupabaseConfigured ? 'restaurant' : MOCK_RESTAURANT.businessType);
  const [businessPhone, setBusinessPhone] = useState(isSupabaseConfigured ? '' : MOCK_RESTAURANT.phone);
  const [businessCity, setBusinessCity] = useState('');
  const [businessRegion, setBusinessRegion] = useState('');
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(
    isSupabaseConfigured
      ? DEFAULT_CONFIG
      : { ...DEFAULT_CONFIG, ...MOCK_AGENT_CONFIG, custom_instructions: MOCK_CUSTOM_INSTRUCTIONS }
  );
  const [items, setItems] = useState<KnowledgeItem[]>(
    isSupabaseConfigured ? [] : (MOCK_KNOWLEDGE as KnowledgeItem[])
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setMode('demo'); return; }

      const business = await getActiveBusiness(supabase);
      if (!business) { setMode('demo'); return; }

      setBusinessId(business.id);
      setBusinessName(business.name);
      setBusinessType(business.business_type);
      setBusinessPhone(business.phone ?? '');
      setBusinessCity(business.city ?? '');
      setBusinessRegion(business.region ?? '');

      const merged: AgentConfig = { ...DEFAULT_CONFIG, ...(business.agent_config as AgentConfig ?? {}) };
      setAgentConfig(merged);

      const { data, error } = await supabase
        .from('business_knowledge')
        .select('*')
        .eq('business_id', business.id)
        .order('category', { ascending: true });

      if (error) setLoadError(error.message);
      else setItems((data as KnowledgeItem[]) ?? []);

      setMode('real');
    }

    load();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="w-full max-w-3xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Business Setup</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  const isDemo = mode === 'demo';

  return (
    <div className="w-full max-w-4xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Business Setup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure how your front desk answers calls, what it knows, and any special rules.
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'profile' && (
        <ProfileTab
          config={agentConfig}
          businessName={businessName}
          businessType={businessType}
          businessPhone={businessPhone}
          businessCity={businessCity}
          businessRegion={businessRegion}
          isDemo={isDemo}
          businessId={businessId}
          onChange={setAgentConfig}
        />
      )}

      {tab === 'qa' && (
        <QATab
          initialItems={items}
          businessId={businessId}
          isDemo={isDemo}
          loadError={loadError}
        />
      )}

      {tab === 'instructions' && (
        <InstructionsTab
          config={agentConfig}
          isDemo={isDemo}
          businessId={businessId}
          onChange={setAgentConfig}
        />
      )}
    </div>
  );
}

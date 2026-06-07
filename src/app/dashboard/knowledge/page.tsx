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
import { BUSINESS_TYPE_OPTIONS, getVertical } from '@/lib/agents/verticals/registry';

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

// Universal tone suggestions (a vertical may override via profile.suggestedToneTags).
const TONE_TAGS = ['Friendly', 'Calm', 'Direct', 'Efficient', 'Professional', 'Warm'];

// Defaults intentionally OMIT main_request_types / details_to_collect so an unconfigured
// business falls back to its vertical's suggested defaults (shown in the chip editors) until
// the owner customizes and saves an explicit list.
const DEFAULT_CONFIG: AgentConfig = {
  tone: 'friendly',
  tone_tags: ['friendly', 'calm'],
  custom_tone: '',
  business_hours: '',
  walk_in_allowed: false,
  appointments_require_confirmation: true,
  staff_handoff_rule: 'Escalate urgent, angry, or complex calls to staff immediately.',
  booking_rule: 'Never confirm appointments automatically. Mark as pending until staff confirms.',
  callback_expectation: 'Staff will follow up during business hours.',
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

// Editable, vertical-aware chip list: selected chips (removable) + suggestion chips (click to
// add) + a free-text input. Suggestions are guidance only; the owner's list is what gets saved.
function ChipEditor({
  title,
  selected,
  suggestions,
  hidden,
  onAdd,
  onRemove,
  onDelete,
  onReset,
  resetLabel = 'Reset to defaults',
  placeholder = 'Add your own…',
  emptyText = 'None selected — add a suggestion below or type your own.',
}: {
  title?: string;
  selected: string[];
  suggestions: string[];
  hidden: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  onDelete: (value: string) => void;
  onReset?: () => void;
  resetLabel?: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const [input, setInput] = useState('');
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const has = (v: string) => selected.some((s) => eq(s, v));
  const isHidden = (v: string) => hidden.some((h) => eq(h, v));
  // Suggestion row = vertical defaults minus selected minus ×-deleted (hidden, persisted).
  const available = suggestions.filter((s) => !has(s) && !isHidden(s));

  function add(value: string) {
    const val = value.trim();
    setInput('');
    if (val && !has(val)) onAdd(val); // parent materializes selection + un-hides
  }

  return (
    <div className="space-y-3">
      {(title || onReset) && (
        <div className="flex items-center justify-between gap-3">
          {title ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</span>
          ) : <span />}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-orange-600 transition-colors"
            >
              ↺ {resetLabel}
            </button>
          )}
        </div>
      )}

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full text-sm font-medium bg-orange-500 text-white overflow-hidden"
            >
              {/* Chip body — DESELECT: returns the chip to the suggestions row (toggle). */}
              <button
                type="button"
                onClick={() => onRemove(item)}
                title="Click to deselect"
                className="pl-3 pr-1.5 py-1.5 leading-none hover:bg-orange-600 transition-colors"
              >
                {item}
              </button>
              {/* × — DELETE: removes + hides the chip (persisted). stopPropagation so it doesn't
                  also trigger the body deselect. Reset (or re-adding) brings it back. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                aria-label={`Delete ${item}`}
                className="pr-3 pl-0.5 py-1.5 text-orange-100 hover:text-white leading-none text-base hover:bg-orange-600 transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400">{emptyText}</p>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map((s) => (
            <span
              key={s}
              className="inline-flex items-center rounded-full text-sm font-medium border fd-hairline-strong text-gray-600 overflow-hidden"
            >
              {/* Body — SELECT: moves the chip into the selected list. */}
              <button
                type="button"
                onClick={() => onAdd(s)}
                title="Click to select"
                className="pl-3 pr-1.5 py-1.5 leading-none hover:text-orange-600 transition-colors"
              >
                {s}
              </button>
              {/* × — DELETE: hides this suggestion (persisted). stopPropagation so it doesn't select. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(s); }}
                aria-label={`Delete ${s}`}
                className="pr-3 pl-0.5 py-1.5 text-gray-400 hover:text-red-500 leading-none text-base transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input); } }}
          placeholder={placeholder}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => add(input)}
          className="flex-shrink-0 text-sm font-semibold bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
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

  // Update several agent_config keys in one onChange (avoids stale-config double setField).
  function patchConfig(patch: Partial<AgentConfig>) {
    onChange({ ...config, ...patch });
    setIsDirty(true);
  }

  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  // Shared handlers for a chip section: select (un-hides), deselect, delete (hide), reset.
  function chipHandlers(
    selectedKey: 'main_request_types' | 'details_to_collect' | 'tone_tags',
    hiddenKey: 'hidden_request_types' | 'hidden_details_to_collect' | 'hidden_tone_tags',
    current: string[],
    currentHidden: string[],
    defaults: string[],
  ) {
    return {
      onAdd: (v: string) =>
        patchConfig({
          [selectedKey]: [...current, v],
          [hiddenKey]: currentHidden.filter((h) => !eq(h, v)),
        }),
      onRemove: (v: string) => setField(selectedKey, current.filter((x) => !eq(x, v))),
      onDelete: (v: string) =>
        patchConfig({
          [selectedKey]: current.filter((x) => !eq(x, v)),
          [hiddenKey]: currentHidden.some((h) => eq(h, v)) ? currentHidden : [...currentHidden, v],
        }),
      onReset: () => patchConfig({ [selectedKey]: [...defaults], [hiddenKey]: [] }),
    };
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

  // Vertical drives the SUGGESTIONS; the owner's saved arrays are the source of truth.
  // When a list is unset, show the vertical's suggested defaults as the selected starting point
  // (the owner can remove any). The first add/remove materializes an explicit saved array.
  const vertical = getVertical(localType);
  const toneTags = config.tone_tags ?? [];
  const toneSuggestions = vertical.suggestedToneTags ?? TONE_TAGS;
  const requestTypes = config.main_request_types ?? vertical.suggestedRequestTypes;
  const detailFields = config.details_to_collect ?? vertical.suggestedDetailFields;
  const hiddenRequest = config.hidden_request_types ?? [];
  const hiddenDetails = config.hidden_details_to_collect ?? [];
  const hiddenTone = config.hidden_tone_tags ?? [];

  return (
    <div className="space-y-4 max-w-2xl pb-20">

      {/* ── 0. Business type — master control (drives all suggestions below) ── */}
      <div className="fd-card overflow-hidden ring-1 ring-orange-200">
        <div className="px-5 py-4 border-b fd-hairline bg-orange-50/60">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600 mb-1">Start here</p>
          <h2 className="text-base font-semibold text-gray-900">Choose your business type</h2>
          <p className="text-xs text-gray-500 mt-1">
            This sets the suggested request types, details, and tone below. You can still customize everything — your changes always take priority.
          </p>
        </div>
        <div className="px-5 py-4">
          {isDemo ? (
            <InfoPair label="Business type" value={localType} />
          ) : (
            <>
              <select
                value={localType}
                onChange={(e) => { setLocalType(e.target.value); setIsDirty(true); }}
                className={INPUT_CLASS}
              >
                {BUSINESS_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {vertical.profileSetupHint && (
                <p className="text-xs text-gray-400 mt-2">{vertical.profileSetupHint}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 1. Business identity ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Business identity</h2>
          <p className="text-xs text-gray-400 mt-0.5">Basic facts about your business. Used in every call.</p>
        </div>
        <div className="px-5 py-4">
          {isDemo ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <InfoPair label="Business name" value={localName} />
              <InfoPair label="Phone" value={localPhone} />
              <InfoPair label="Location" value={[localCity, localRegion].filter(Boolean).join(', ')} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <p className="text-xs text-gray-400 mt-0.5">Add or remove tone tags, or describe your own tone. Suggestions adapt to your business type.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <ChipEditor
            selected={toneTags}
            suggestions={toneSuggestions}
            hidden={hiddenTone}
            {...chipHandlers('tone_tags', 'hidden_tone_tags', toneTags, hiddenTone, toneSuggestions)}
            resetLabel="Reset tone tags"
            placeholder="Add a tone tag…"
            emptyText="No tone tags — add a suggestion below, type your own, or use just the free-form tone."
          />
          <div>
            <label className={LABEL_CLASS}>Custom tone (free-form)</label>
            <input
              type="text"
              value={config.custom_tone ?? ''}
              onChange={(e) => setField('custom_tone', e.target.value)}
              placeholder='e.g. "premium, calm, and concise"'
              className={INPUT_CLASS}
            />
            <p className="text-xs text-gray-400 mt-1">Optional — combined with the tags above to guide the voice. Not affected by &ldquo;Reset tone tags&rdquo;.</p>
          </div>
        </div>
      </div>

      {/* ── 4. Request types ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Request types</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            What kinds of calls should your front desk handle? Suggestions adapt to your business type — add or remove freely.
          </p>
        </div>
        <div className="px-5 py-4">
          <ChipEditor
            selected={requestTypes}
            suggestions={vertical.suggestedRequestTypes}
            hidden={hiddenRequest}
            {...chipHandlers('main_request_types', 'hidden_request_types', requestTypes, hiddenRequest, vertical.suggestedRequestTypes)}
            placeholder="Add a request type…"
            emptyText="No request types — add a suggestion below, type your own, or reset to defaults."
          />
        </div>
      </div>

      {/* ── 5. Details to collect when action is needed ── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-4 border-b fd-hairline">
          <h2 className="text-sm font-semibold text-gray-900">Details to collect when action is needed</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Collected only when the caller wants an appointment, callback, or service request — not for general questions. Add or remove to fit your business.
          </p>
        </div>
        <div className="px-5 py-4">
          <ChipEditor
            selected={detailFields}
            suggestions={vertical.suggestedDetailFields}
            hidden={hiddenDetails}
            {...chipHandlers('details_to_collect', 'hidden_details_to_collect', detailFields, hiddenDetails, vertical.suggestedDetailFields)}
            placeholder="Add a detail to collect…"
            emptyText="No details — add a suggestion below, type your own, or reset to defaults."
          />
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
        <div className="fixed bottom-0 left-0 lg:left-60 right-0 bg-white border-t fd-hairline shadow-sm z-20">
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
  businessType,
  isDemo,
  loadError,
}: {
  initialItems: KnowledgeItem[];
  businessId: string;
  businessType: string;
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

  // Vertical-specific guidance — suggested KB categories + example placeholder for this
  // business type. Suggestions only: the category field stays free text, existing rows unaffected.
  const vertical = getVertical(businessType);
  const suggestedCategories = vertical.knowledgeCategories;
  const categoryPlaceholder = `Category (e.g. ${suggestedCategories.slice(0, 3).join(', ')})`;

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

      {/* Vertical-specific suggested categories — guidance, not rigid. Click to start an entry. */}
      {!isDemo && (
        <div className="mb-5">
          <p className="text-xs text-gray-400 mb-2">
            Suggested categories for {vertical.label} — click one to add an entry, or use your own:
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestedCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => startAdd(cat)}
                className="px-3 py-1 rounded-full text-xs font-medium border fd-hairline-strong text-gray-600 hover:border-orange-300 hover:text-orange-600 transition-colors"
              >
                + {cat}
              </button>
            ))}
          </div>
        </div>
      )}

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
              placeholder={categoryPlaceholder}
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
          businessType={businessType}
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

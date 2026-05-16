'use client';

import { useState, useEffect } from 'react';
import { MOCK_KNOWLEDGE } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

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

const EMPTY_DRAFT: Draft = { category: '', question: '', answer: '' };

const INPUT_CLASS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400';

// ─── Demo mode (read-only, mock data) ────────────────────────────────────────

function DemoKnowledgePage() {
  const categories = [...new Set(MOCK_KNOWLEDGE.map((e) => e.category))];
  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
        <p className="text-sm text-gray-500 mt-1">
          The AI assistant uses this information to answer customer questions.
        </p>
      </div>

      <div className="space-y-6">
        {categories.map((category) => {
          const entries = MOCK_KNOWLEDGE.filter((e) => e.category === category);
          return (
            <div
              key={category}
              className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900 text-sm">{category}</h2>
              </div>
              <ul className="divide-y divide-gray-50">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 mb-1">{entry.question}</p>
                        <p className="text-sm text-gray-500 leading-relaxed">{entry.answer}</p>
                      </div>
                      <button
                        disabled
                        className="flex-shrink-0 text-xs font-medium text-gray-300 px-2 py-1 border border-gray-200 rounded cursor-not-allowed"
                      >
                        Edit
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-700">
        <strong>Demo mode</strong> — sign in and set up your business to manage your own knowledge
        base.
      </div>
    </div>
  );
}

// ─── Real mode (authenticated, live Supabase data) ────────────────────────────

function RealKnowledgePage({
  initialItems,
  businessId,
  loadError,
}: {
  initialItems: KnowledgeItem[];
  businessId: string;
  loadError: string | null;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [opError, setOpError] = useState('');
  const [saving, setSaving] = useState(false);

  const categories = [...new Set(items.map((e) => e.category))].sort();

  // ── Edit ──────────────────────────────────────────────────────────────────

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

      if (error) {
        setOpError(error.message);
        return;
      }

      setItems((prev) =>
        prev.map((item) =>
          item.id === editingId
            ? {
                ...item,
                category: draft.category.trim(),
                question: draft.question.trim(),
                answer: draft.answer.trim(),
              }
            : item
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

      if (error) {
        setOpError(error.message);
        return;
      }

      setItems((prev) => prev.filter((item) => item.id !== id));
      cancelEdit();
    } finally {
      setSaving(false);
    }
  }

  // ── Add ───────────────────────────────────────────────────────────────────

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

      if (error) {
        setOpError(error.message);
        return;
      }

      setItems((prev) => [...prev, data as KnowledgeItem]);
      cancelAdd();
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1">
            The AI assistant uses this information to answer customer questions.
          </p>
        </div>
        {!isAdding && (
          <button
            onClick={() => startAdd()}
            className="flex-shrink-0 flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Entry
          </button>
        )}
      </div>

      {/* Load error */}
      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <strong>Failed to load knowledge base:</strong> {loadError}
        </div>
      )}

      {/* Operation error */}
      {opError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {opError}
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <div className="mb-6 bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-orange-50 border-b border-orange-200">
            <h2 className="font-semibold text-gray-900 text-sm">New Entry</h2>
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
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
              <button
                onClick={cancelAdd}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !isAdding && !loadError && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <p className="text-gray-400 text-sm mb-3">No knowledge entries yet.</p>
          <button
            onClick={() => startAdd()}
            className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
          >
            Add your first entry →
          </button>
        </div>
      )}

      {/* Entries grouped by category */}
      {categories.length > 0 && (
        <div className="space-y-6">
          {categories.map((category) => {
            const entries = items.filter((e) => e.category === category);
            return (
              <div
                key={category}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 text-sm">{category}</h2>
                </div>
                <ul className="divide-y divide-gray-50">
                  {entries.map((entry) =>
                    editingId === entry.id ? (
                      /* ── Inline edit form ── */
                      <li key={entry.id} className="px-5 py-4 bg-orange-50/40">
                        <div className="space-y-3">
                          <input
                            type="text"
                            placeholder="Category"
                            value={draft.category}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, category: e.target.value }))
                            }
                            className={INPUT_CLASS}
                          />
                          <input
                            type="text"
                            placeholder="Question"
                            value={draft.question}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, question: e.target.value }))
                            }
                            className={INPUT_CLASS}
                          />
                          <textarea
                            rows={3}
                            placeholder="Answer"
                            value={draft.answer}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, answer: e.target.value }))
                            }
                            className={`${INPUT_CLASS} resize-none`}
                          />
                          <div className="flex items-center gap-3">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => deleteItem(entry.id)}
                              disabled={saving}
                              className="ml-auto text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-60 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    ) : (
                      /* ── Read view ── */
                      <li key={entry.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 mb-1">
                              {entry.question}
                            </p>
                            <p className="text-sm text-gray-500 leading-relaxed">{entry.answer}</p>
                          </div>
                          <button
                            onClick={() => startEdit(entry)}
                            className="flex-shrink-0 text-xs font-medium text-orange-600 hover:text-orange-700 px-2 py-1 border border-orange-200 rounded hover:bg-orange-50 transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      </li>
                    )
                  )}
                </ul>
                <div className="px-5 py-3 border-t border-gray-100">
                  <button
                    onClick={() => startAdd(category)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Add entry to {category}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        <strong>Tip:</strong> Keep answers concise and accurate. The AI will use these when
        answering caller questions.
      </div>
    </div>
  );
}

// ─── Root component — resolves mode, then renders the right sub-component ────

export default function KnowledgePage() {
  const [mode, setMode] = useState<'loading' | 'demo' | 'real'>(
    isSupabaseConfigured ? 'loading' : 'demo'
  );
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return; // already in demo mode

    async function load() {
      const supabase = createClient();

      // Fast cookie-based session check — avoids a network call for signed-out users
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setMode('demo');
        return;
      }

      const business = await getActiveBusiness(supabase);
      if (!business) {
        setMode('demo');
        return;
      }

      setBusinessId(business.id);

      const { data, error } = await supabase
        .from('business_knowledge')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: true });

      if (error) {
        setLoadError(error.message);
      } else {
        setItems((data as KnowledgeItem[]) ?? []);
      }
      setMode('real');
    }

    load();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Knowledge Base</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (mode === 'demo') {
    return <DemoKnowledgePage />;
  }

  return (
    <RealKnowledgePage
      initialItems={items}
      businessId={businessId}
      loadError={loadError}
    />
  );
}

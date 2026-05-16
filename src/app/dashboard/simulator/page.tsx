'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SIMULATOR_SCRIPT } from '@/lib/mock-data';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

type SimState = 'idle' | 'ringing' | 'active' | 'ended';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Caller details come from the simulator script / ringing screen
const SIM_CUSTOMER_NAME = 'John Walker';
const SIM_CUSTOMER_PHONE = '(555) 100-2000';

export default function SimulatorPage() {
  // ── Simulator state ───────────────────────────────────────────────────────
  const [simState, setSimState] = useState<SimState>('idle');
  const [visibleMessages, setVisibleMessages] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Auth / business state ─────────────────────────────────────────────────
  const [businessId, setBusinessId] = useState<string | null>(null);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [savedCallId, setSavedCallId] = useState<string | null>(null);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  // Resolve business on mount so it's ready when the call ends
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const business = await getActiveBusiness(supabase);
      if (business) setBusinessId(business.id);
    });
  }, []);

  useEffect(() => {
    if (simState === 'ringing') {
      const t = setTimeout(() => {
        setSimState('active');
      }, 2000);
      return () => clearTimeout(t);
    }

    if (simState === 'active') {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);

      let i = 0;
      const reveal = () => {
        if (i < SIMULATOR_SCRIPT.length) {
          setVisibleMessages(i + 1);
          i++;
          const delay = i < SIMULATOR_SCRIPT.length ? 1800 : 0;
          if (i < SIMULATOR_SCRIPT.length) {
            setTimeout(reveal, delay);
          } else {
            setTimeout(() => {
              setSimState('ended');
              if (intervalRef.current) clearInterval(intervalRef.current);
            }, 1200);
          }
        }
      };
      setTimeout(reveal, 400);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [simState]);

  // ── Actions ───────────────────────────────────────────────────────────────

  function reset() {
    setSimState('idle');
    setVisibleMessages(0);
    setElapsed(0);
    setSaveState('idle');
    setSaveError('');
    setSavedCallId(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  async function saveCall() {
    if (!businessId) return;
    // Prevent duplicate saves
    if (saveState === 'saving' || saveState === 'saved') return;

    setSaveState('saving');
    setSaveError('');

    const now = new Date();
    const startedAt = new Date(now.getTime() - elapsed * 1000);

    const transcriptText = SIMULATOR_SCRIPT.map(
      (msg) => `${msg.role === 'ai' ? 'AI' : 'Customer'}: ${msg.text}`
    ).join('\n');

    const supabase = createClient();

    // Insert the call row
    const { data: callRow, error: callError } = await supabase
      .from('calls')
      .insert({
        business_id: businessId,
        customer_name: SIM_CUSTOMER_NAME,
        customer_phone: SIM_CUSTOMER_PHONE,
        started_at: startedAt.toISOString(),
        ended_at: now.toISOString(),
        duration_seconds: elapsed,
        status: 'resolved',
        intent: 'other',
        summary:
          'Simulated call — reservation request for John Walker, party of 4, Saturday at 7:00 PM. Pending staff confirmation.',
        transcript: transcriptText,
        needs_staff_followup: false,
      })
      .select('id')
      .single();

    if (callError) {
      setSaveError(callError.message);
      setSaveState('error');
      return;
    }

    // Insert one call_message row per script turn
    const messageRows = SIMULATOR_SCRIPT.map((msg) => ({
      call_id: callRow.id,
      role: msg.role === 'ai' ? 'assistant' : 'customer',
      content: msg.text,
    }));

    const { error: msgError } = await supabase.from('call_messages').insert(messageRows);

    if (msgError) {
      // Call row was inserted; only transcript failed. Surface the error clearly.
      setSaveError(
        `Call was logged (id: ${callRow.id}) but transcript messages failed: ${msgError.message}`
      );
      setSavedCallId(callRow.id);
      setSaveState('error');
      return;
    }

    setSavedCallId(callRow.id);
    setSaveState('saved');
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call Simulator</h1>
        <p className="text-sm text-gray-500 mt-1">
          Watch the AI assistant handle a mock incoming call in real time.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* ── Status bar ── */}
        <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                simState === 'active'
                  ? 'bg-green-400 animate-pulse'
                  : simState === 'ringing'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300 text-sm font-medium">
              {simState === 'idle' && 'Ready'}
              {simState === 'ringing' && 'Incoming call…'}
              {simState === 'active' && 'Call in progress'}
              {simState === 'ended' && 'Call ended'}
            </span>
          </div>
          {(simState === 'active' || simState === 'ended') && (
            <span className="text-slate-400 text-xs font-mono">{formatTime(elapsed)}</span>
          )}
        </div>

        {/* ── Chat area ── */}
        <div className="p-5 min-h-64 max-h-96 overflow-y-auto space-y-3">
          {simState === 'idle' && (
            <div className="flex flex-col items-center justify-center h-48 gap-4 text-center">
              <div className="w-14 h-14 bg-orange-50 rounded-full flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-orange-500"
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
              <p className="text-sm text-gray-500">
                Press the button below to simulate an incoming call.
              </p>
            </div>
          )}

          {simState === 'ringing' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
              <div className="w-14 h-14 bg-yellow-50 rounded-full flex items-center justify-center animate-bounce">
                <svg
                  className="w-7 h-7 text-yellow-500"
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
              <p className="text-sm font-medium text-gray-700">
                Incoming call from {SIM_CUSTOMER_PHONE}
              </p>
              <p className="text-xs text-gray-400">AI assistant answering…</p>
            </div>
          )}

          {(simState === 'active' || simState === 'ended') &&
            SIMULATOR_SCRIPT.slice(0, visibleMessages).map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${msg.role === 'caller' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'ai' && (
                  <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      className="w-4 h-4 text-orange-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2"
                      />
                    </svg>
                  </div>
                )}
                <div
                  className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'ai'
                      ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                      : 'bg-orange-500 text-white rounded-tr-sm'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.role === 'caller' && (
                  <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      className="w-4 h-4 text-slate-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Call summary (shown when ended) ── */}
        {simState === 'ended' && (
          <div className="mx-5 mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">Call Summary</p>
            <p>
              Reservation request logged for <strong>John Walker</strong>, party of 4, Saturday May
              17th at 7:00 PM. Status: <strong>Pending staff confirmation.</strong> Staff will
              follow up within 2 hours.
            </p>
          </div>
        )}

        {/* ── Save panel (shown when ended, signed in) ── */}
        {simState === 'ended' && businessId && (
          <div className="mx-5 mb-5">
            {saveState === 'idle' && (
              <button
                onClick={saveCall}
                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                Save to Call History
              </button>
            )}

            {saveState === 'saving' && (
              <button
                disabled
                className="flex items-center gap-2 bg-slate-400 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-not-allowed"
              >
                Saving…
              </button>
            )}

            {saveState === 'saved' && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-800">Saved to Call History</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    This simulated call is now visible in your call log.
                  </p>
                </div>
                <Link
                  href="/dashboard/calls"
                  className="flex-shrink-0 text-xs font-semibold text-green-700 hover:text-green-900 underline ml-4"
                >
                  View History →
                </Link>
              </div>
            )}

            {saveState === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm font-medium text-red-800 mb-1">Save failed</p>
                <p className="text-xs text-red-700 mb-2">{saveError}</p>
                {!savedCallId && (
                  <button
                    onClick={() => setSaveState('idle')}
                    className="text-xs font-medium text-red-600 hover:text-red-800 underline"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Sign-in nudge (shown when ended, not signed in) ── */}
        {simState === 'ended' && !businessId && (
          <p className="mx-5 mb-5 text-xs text-gray-400">
            <Link href="/login" className="text-orange-600 hover:underline">
              Sign in
            </Link>{' '}
            to save this call to your call history.
          </p>
        )}

        {/* ── Bottom action buttons ── */}
        <div className="px-5 pb-5 flex gap-3">
          {simState === 'idle' && (
            <button
              onClick={() => setSimState('ringing')}
              className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              <svg
                className="w-4 h-4"
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
              Simulate Incoming Call
            </button>
          )}
          {(simState === 'active' || simState === 'ringing' || simState === 'ended') && (
            <button
              onClick={reset}
              className="flex items-center gap-2 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        <strong>Note:</strong> This is a simulated demo. No real calls are being made. Requests
        collected by the AI are always marked as{' '}
        <strong>pending staff confirmation</strong>.
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

type CallStatus =
  | 'idle'
  | 'requesting'   // mic permission prompt
  | 'connecting'   // WebRTC handshake in progress
  | 'connected'    // live call
  | 'stopping'     // tearing down
  | 'saving'       // writing to DB
  | 'saved'        // call record written
  | 'error';       // something failed

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const CONNECT_TIMEOUT_MS = 30_000;

// ── Readiness checklist row ────────────────────────────────────────────────

function ReadinessRow({
  label,
  state,
  okText,
  warnText,
  errorText,
  loadingText = 'Checking…',
}: {
  label: string;
  state: 'ok' | 'warn' | 'error' | 'loading';
  okText?: string;
  warnText?: string;
  errorText?: string;
  loadingText?: string;
}) {
  const icons = {
    ok: (
      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    warn: (
      <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
    error: (
      <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    loading: (
      <svg className="w-4 h-4 text-gray-300 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    ),
  };

  const text = { ok: okText, warn: warnText, error: errorText, loading: loadingText }[state] ?? '';
  const textColor = {
    ok: 'text-green-700',
    warn: 'text-amber-700',
    error: 'text-red-600',
    loading: 'text-gray-400',
  }[state];

  return (
    <div className="px-5 py-3 flex items-center gap-3">
      {icons[state]}
      <span className="text-xs font-medium text-gray-700 flex-1">{label}</span>
      <span className={`text-xs ${textColor} text-right leading-snug max-w-[55%]`}>{text}</span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function VoicePage() {
  // Config / auth
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [userSignedIn, setUserSignedIn] = useState<boolean | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);

  // Call state
  const [status, setStatus] = useState<CallStatus>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedCallId, setSavedCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  // Refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const startedAtRef = useRef<Date | null>(null);
  const statusRef = useRef<CallStatus>('idle');
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Keep refs in sync with state
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { startedAtRef.current = startedAt; }, [startedAt]);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Browser mic API support (sync, client-side only)
  useEffect(() => {
    setMicSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  // Check whether OPENAI_API_KEY is configured server-side
  useEffect(() => {
    fetch('/api/voice-session')
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
  }, []);

  // Check auth and active business
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUserSignedIn(false);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const signedIn = !!session;
      setUserSignedIn(signedIn);
      if (signedIn) {
        getActiveBusiness(supabase).then((b) => {
          if (b) setBusinessId(b.id);
        });
      }
    });
  }, []);

  // ── OpenAI Realtime event handler ────────────────────────────────────────

  function handleRealtimeEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === 'input_audio_buffer.speech_started') setIsSpeaking(true);
    if (type === 'input_audio_buffer.speech_stopped') setIsSpeaking(false);

    if (type === 'conversation.item.input_audio_transcription.completed') {
      setIsSpeaking(false);
      const itemId = event.item_id as string;
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text } : e))
          : [...prev, { id: itemId, role: 'user', text }]
      );
    }

    if (type === 'response.audio_transcript.delta') {
      const itemId = event.item_id as string;
      const delta = (event.delta as string) ?? '';
      if (!delta) return;
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text: e.text + delta } : e))
          : [...prev, { id: itemId, role: 'assistant', text: delta }]
      );
    }

    if (type === 'response.audio_transcript.done') {
      const itemId = event.item_id as string;
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text } : e))
          : [...prev, { id: itemId, role: 'assistant', text }]
      );
    }

    if (type === 'error') {
      const errObj = event.error as Record<string, unknown>;
      setErrorMsg(`OpenAI error: ${errObj?.message ?? JSON.stringify(errObj)}`);
      setStatus('error');
      cleanup();
    }
  }

  // ── Connection helpers ───────────────────────────────────────────────────

  function clearConnectTimeout() {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }

  function cleanup() {
    clearConnectTimeout();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    dcRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }

  // ── Call lifecycle ────────────────────────────────────────────────────────

  async function startCall() {
    setErrorMsg('');
    setTranscript([]);
    setSavedCallId(null);
    setStatus('requesting');

    // 1. Request microphone access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err: unknown) {
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setErrorMsg(
        denied
          ? "Microphone access was denied. To allow it: click the lock or camera icon in your browser's address bar, set Microphone to \"Allow\", then try again."
          : 'Could not access your microphone. Check your device settings and try again.'
      );
      setStatus('error');
      return;
    }

    setStatus('connecting');

    // 2. Connection watchdog — 30s timeout
    connectTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'connecting') {
        setErrorMsg('Connection timed out after 30 seconds. Check your internet connection and try again.');
        setStatus('error');
        cleanup();
      }
    }, CONNECT_TIMEOUT_MS);

    try {
      // 3. Fetch ephemeral token — API key never leaves the server
      const tokenRes = await fetch('/api/voice-session', { method: 'POST' });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: 'Server error' }));
        throw new Error(body.error ?? `Session request failed (${tokenRes.status})`);
      }
      const { clientSecret } = await tokenRes.json();
      if (!clientSecret) throw new Error('Server returned an empty session token. Check OPENAI_API_KEY.');

      // 4. WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Handle unexpected connection drops
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (
          (s === 'failed' || s === 'disconnected' || s === 'closed') &&
          statusRef.current === 'connected'
        ) {
          setErrorMsg('The connection was interrupted. The call has ended unexpectedly.');
          setStatus('error');
          cleanup();
        }
      };

      // Remote audio → hidden <audio> element
      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };

      // Local mic → peer connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Data channel for OpenAI Realtime events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        clearConnectTimeout();
        setStatus('connected');
        setStartedAt(new Date());
      };
      dc.onmessage = (e) => {
        try { handleRealtimeEvent(JSON.parse(e.data as string)); } catch {}
      };
      dc.onerror = () => {
        if (statusRef.current === 'connected' || statusRef.current === 'connecting') {
          setErrorMsg('Data channel error. The connection may have dropped.');
          setStatus('error');
          cleanup();
        }
      };

      // 6. SDP offer → OpenAI Realtime WebRTC endpoint
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        throw new Error(`WebRTC handshake failed: ${sdpRes.status} ${sdpRes.statusText}`);
      }

      // 7. Apply OpenAI's SDP answer
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err: unknown) {
      clearConnectTimeout();
      // Only surface error if not already cancelled by user
      if (statusRef.current !== 'idle') {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setStatus('error');
        cleanup();
      }
    }
  }

  async function stopCall() {
    setStatus('stopping');
    const entries = transcriptRef.current;
    const callStart = startedAtRef.current;
    cleanup();

    if (entries.length > 0 && businessId && isSupabaseConfigured) {
      await saveCall(entries, callStart);
    } else {
      setStatus('idle');
    }
  }

  function cancelConnecting() {
    setStatus('idle');
    setErrorMsg('');
    cleanup();
  }

  async function saveCall(entries: TranscriptEntry[], callStart: Date | null) {
    setStatus('saving');
    try {
      const supabase = createClient();
      const now = new Date();
      const durationSeconds = callStart
        ? Math.round((now.getTime() - callStart.getTime()) / 1000)
        : 0;

      const transcriptText = entries
        .map((e) => `${e.role === 'assistant' ? 'AI' : 'Customer'}: ${e.text}`)
        .join('\n');

      const summary = entries
        .slice(0, 3)
        .map((e) => e.text)
        .join(' ')
        .slice(0, 250);

      const { data: callRow, error: callError } = await supabase
        .from('calls')
        .insert({
          business_id: businessId,
          customer_name: 'Voice Agent Call',
          customer_phone: null,
          started_at: (callStart ?? now).toISOString(),
          ended_at: now.toISOString(),
          duration_seconds: durationSeconds,
          status: 'resolved',
          intent: 'other',
          summary,
          transcript: transcriptText,
          needs_staff_followup: false,
        })
        .select('id')
        .single();

      if (callError || !callRow) throw new Error(callError?.message ?? 'Failed to save call');

      const messageRows = entries.map((e, idx) => ({
        call_id: callRow.id,
        role: e.role === 'assistant' ? 'assistant' : 'customer',
        content: e.text,
        sequence: idx,
      }));

      if (messageRows.length > 0) {
        const { error: msgError } = await supabase.from('call_messages').insert(messageRows);
        if (msgError) {
          setErrorMsg(`Call saved, but transcript messages failed: ${msgError.message}`);
        }
      }

      setSavedCallId(callRow.id);
      setStatus('saved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Save failed: ${msg}`);
      setStatus('idle');
    }
  }

  function resetForNewCall() {
    setStatus('idle');
    setTranscript([]);
    setErrorMsg('');
    setSavedCallId(null);
    setStartedAt(null);
    setIsSpeaking(false);
  }

  // ── Derived UI flags ─────────────────────────────────────────────────────

  const isLive = status === 'connected';
  const isConnecting = status === 'requesting' || status === 'connecting';
  const isBusy = status === 'stopping' || status === 'saving';
  const canSave = !!businessId && isSupabaseConfigured;

  const statusLabel: Record<CallStatus, string> = {
    idle: 'Ready',
    requesting: 'Checking mic…',
    connecting: 'Connecting…',
    connected: 'Live',
    stopping: 'Ending call…',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Error',
  };

  const statusColor: Record<CallStatus, string> = {
    idle: 'bg-gray-100 text-gray-500',
    requesting: 'bg-amber-100 text-amber-700',
    connecting: 'bg-amber-100 text-amber-700',
    connected: 'bg-green-100 text-green-700',
    stopping: 'bg-amber-100 text-amber-700',
    saving: 'bg-amber-100 text-amber-700',
    saved: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl space-y-5">
      {/* Hidden audio element — AI voice plays here */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Voice Agent</h1>
        <p className="text-sm text-gray-500 mt-1">
          Talk directly with the AI front desk agent using your browser microphone.
        </p>
      </div>

      {/* ── Setup status checklist ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Setup Status</h2>
        </div>
        <div className="divide-y divide-gray-50">
          <ReadinessRow
            label="OpenAI API key"
            state={configured === null ? 'loading' : configured ? 'ok' : 'error'}
            okText="Configured"
            errorText="Not configured — see setup below"
          />
          <ReadinessRow
            label="Browser microphone"
            state={micSupported ? 'ok' : 'error'}
            okText="Supported"
            errorText="Not available — use Chrome, Edge, or Firefox"
          />
          <ReadinessRow
            label="Account"
            state={
              userSignedIn === null ? 'loading' :
              userSignedIn ? 'ok' : 'warn'
            }
            okText="Signed in"
            warnText="Demo mode — sign in to save calls"
          />
          <ReadinessRow
            label="Business profile"
            state={
              !isSupabaseConfigured ? 'warn' :
              userSignedIn === null ? 'loading' :
              businessId ? 'ok' : 'warn'
            }
            okText="Detected"
            warnText={userSignedIn ? 'Not found — complete onboarding first' : 'Not available in demo mode'}
          />
          <ReadinessRow
            label="Call recording"
            state={canSave ? 'ok' : 'warn'}
            okText="Calls will be saved to Call History"
            warnText="Not saving — sign in with a business account"
          />
        </div>
      </div>

      {/* ── Missing API key panel ───────────────────────────────────────── */}
      {configured === false && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <h2 className="font-semibold text-amber-900">Live voice not yet enabled</h2>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-700">
              The voice agent is built and ready. To activate live calls, add your OpenAI API key
              (Realtime API access required) to your environment and restart the dev server.
            </p>
            <div className="bg-gray-900 rounded-lg px-4 py-3 font-mono text-sm text-green-400 select-all">
              OPENAI_API_KEY=sk-…
            </div>
            <p className="text-xs text-gray-400">
              Add this to{' '}
              <code className="bg-gray-100 px-1 rounded">.env.local</code>
              {' '}— already in <code className="bg-gray-100 px-1 rounded">.gitignore</code> and safe from commits.
            </p>
            <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
              <p className="text-xs text-gray-500">
                Live QA pending — all other systems are ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Live call panel ─────────────────────────────────────────────── */}
      {configured === true && (
        <div className="space-y-4">
          {/* Controls card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Live Call</h2>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[status]}`}>
                {statusLabel[status]}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Speaking indicator — only when live */}
              {isLive && (
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      isSpeaking ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
                    }`}
                  />
                  <span className="text-xs text-gray-500">
                    {isSpeaking ? 'You are speaking…' : 'Listening for your voice…'}
                  </span>
                </div>
              )}

              {/* Inline state hints during connection */}
              {isConnecting && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  {status === 'requesting'
                    ? 'Requesting microphone access — please accept the browser prompt.'
                    : 'Connecting to OpenAI Realtime. This usually takes a few seconds…'}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                {(status === 'idle' || status === 'error' || status === 'saved') && (
                  <button
                    onClick={status === 'saved' ? resetForNewCall : startCall}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {status === 'saved' ? 'Start New Call' : 'Start Voice Call'}
                  </button>
                )}

                {/* Connecting: spinner + Cancel */}
                {isConnecting && (
                  <>
                    <button
                      disabled
                      className="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 cursor-not-allowed"
                    >
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {statusLabel[status]}
                    </button>
                    <button
                      onClick={cancelConnecting}
                      className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {/* Busy (stopping / saving) */}
                {isBusy && (
                  <button
                    disabled
                    className="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {statusLabel[status]}
                  </button>
                )}

                {/* End Call */}
                {isLive && (
                  <button
                    onClick={stopCall}
                    className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    End Call
                  </button>
                )}
              </div>

              {/* Error message */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-red-700 mb-1">Something went wrong</p>
                  <p className="text-xs text-red-600 leading-relaxed">{errorMsg}</p>
                </div>
              )}

              {/* Save outcome */}
              {status === 'saved' && savedCallId ? (
                <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-green-700 font-medium">Call transcript saved</span>
                  <Link
                    href="/dashboard/calls"
                    className="text-sm font-semibold text-green-700 hover:text-green-800 underline whitespace-nowrap"
                  >
                    View in Call History →
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  {canSave
                    ? 'Calls are automatically saved to your account when you end the session.'
                    : 'Calls are not saved in demo mode. Sign in with a business account to save transcripts.'}
                </p>
              )}
            </div>
          </div>

          {/* Transcript */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Transcript</h2>
              {transcript.length > 0 && (
                <span className="text-xs text-gray-400">{transcript.length} message{transcript.length !== 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="p-5 min-h-[240px] max-h-[480px] overflow-y-auto space-y-3">
              {transcript.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center gap-2">
                  <svg className="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p className="text-sm text-gray-400">
                    {isLive || isConnecting
                      ? 'Conversation will appear here as you speak…'
                      : 'Start a voice call to see the live transcript.'}
                  </p>
                </div>
              ) : (
                transcript.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                        entry.role === 'user'
                          ? 'bg-slate-700 text-white'
                          : 'bg-orange-50 border border-orange-100 text-gray-900'
                      }`}
                    >
                      <span className="block text-xs font-semibold mb-1 opacity-60">
                        {entry.role === 'user' ? 'You' : 'AI Agent'}
                      </span>
                      {entry.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* How it works */}
          <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              How it works
            </p>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>• Your browser connects directly to OpenAI Realtime via WebRTC</li>
              <li>• Your OpenAI API key stays on the server — it is never sent to your browser</li>
              <li>• Audio is streamed end-to-end; transcripts are generated by Whisper</li>
              <li>• Calls are saved to your account when you click End Call (if signed in)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

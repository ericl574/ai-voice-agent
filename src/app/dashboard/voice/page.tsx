'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';

type CallStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'stopping'
  | 'saving'
  | 'saved'
  | 'error';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export default function VoicePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [savedCallId, setSavedCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const startedAtRef = useRef<Date | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Keep refs in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    startedAtRef.current = startedAt;
  }, [startedAt]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Check if OPENAI_API_KEY is configured
  useEffect(() => {
    fetch('/api/voice-session')
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
  }, []);

  // Load business ID (for saving calls)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    getActiveBusiness(supabase).then((b) => {
      if (b) setBusinessId(b.id);
    });
  }, []);

  function handleRealtimeEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === 'input_audio_buffer.speech_started') {
      setIsSpeaking(true);
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      setIsSpeaking(false);
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      setIsSpeaking(false);
      const itemId = event.item_id as string;
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      setTranscript((prev) => {
        if (prev.find((e) => e.id === itemId)) {
          return prev.map((e) => (e.id === itemId ? { ...e, text } : e));
        }
        return [...prev, { id: itemId, role: 'user', text }];
      });
    }

    if (type === 'response.audio_transcript.delta') {
      const itemId = event.item_id as string;
      const delta = (event.delta as string) ?? '';
      if (!delta) return;
      setTranscript((prev) => {
        if (prev.find((e) => e.id === itemId)) {
          return prev.map((e) => (e.id === itemId ? { ...e, text: e.text + delta } : e));
        }
        return [...prev, { id: itemId, role: 'assistant', text: delta }];
      });
    }

    if (type === 'response.audio_transcript.done') {
      const itemId = event.item_id as string;
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      setTranscript((prev) => {
        if (prev.find((e) => e.id === itemId)) {
          return prev.map((e) => (e.id === itemId ? { ...e, text } : e));
        }
        return [...prev, { id: itemId, role: 'assistant', text }];
      });
    }

    if (type === 'error') {
      const errObj = event.error as Record<string, unknown>;
      setErrorMsg(`OpenAI error: ${errObj?.message ?? JSON.stringify(errObj)}`);
      setStatus('error');
      cleanup();
    }
  }

  function cleanup() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    dcRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }

  async function startCall() {
    setErrorMsg('');
    setTranscript([]);
    setSavedCallId(null);
    setStatus('requesting');

    // 1. Request microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setErrorMsg('Microphone access was denied. Please allow microphone access and try again.');
      setStatus('error');
      return;
    }

    setStatus('connecting');

    try {
      // 2. Get ephemeral token from our server (API key never leaves server)
      const tokenRes = await fetch('/api/voice-session', { method: 'POST' });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error ?? 'Failed to create voice session');
      }
      const { clientSecret } = await tokenRes.json();

      // 3. Create WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Play remote audio (AI voice output)
      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
        }
      };

      // Add local mic track
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Create data channel for OpenAI Realtime events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus('connected');
        setStartedAt(new Date());
      };
      dc.onmessage = (e) => {
        try {
          handleRealtimeEvent(JSON.parse(e.data as string));
        } catch {}
      };

      // 5. Create SDP offer and send to OpenAI Realtime
      // GA endpoint: POST /v1/realtime/calls — model is encoded in the ephemeral token, no ?model= param.
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

      // 6. Set remote description from OpenAI's answer
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus('error');
      cleanup();
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

  async function saveCall(entries: TranscriptEntry[], callStart: Date | null) {
    setStatus('saving');
    try {
      const supabase = createClient();
      const now = new Date();
      const durationSeconds = callStart ? Math.round((now.getTime() - callStart.getTime()) / 1000) : 0;

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
          setErrorMsg(`Call saved (id: ${callRow.id}) but messages failed: ${msgError.message}`);
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

  // ── Derived UI state ─────────────────────────────────────────────────────

  const isLive = status === 'connected';
  const isBusy =
    status === 'requesting' ||
    status === 'connecting' ||
    status === 'stopping' ||
    status === 'saving';

  const statusLabel: Record<CallStatus, string> = {
    idle: 'Ready',
    requesting: 'Requesting microphone…',
    connecting: 'Connecting to AI…',
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
    <div className="p-6 max-w-2xl">
      {/* Hidden audio element for AI voice playback */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Voice Agent Prototype</h1>
        <p className="text-sm text-gray-500 mt-1">
          Talk directly with the AI front desk agent using your microphone. Audio is processed via
          OpenAI Realtime API.
        </p>
      </div>

      {/* Setup message if OPENAI_API_KEY not configured */}
      {configured === null && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-sm text-gray-500">Checking configuration…</p>
        </div>
      )}

      {configured === false && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 bg-amber-50">
            <h2 className="font-semibold text-amber-900 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              OpenAI API Key Required
            </h2>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-700">
              The Voice Agent Prototype requires an OpenAI API key with access to the Realtime API.
              Add it to your environment and restart the dev server.
            </p>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <code className="text-sm text-green-400 font-mono">
                OPENAI_API_KEY=sk-…
              </code>
            </div>
            <p className="text-xs text-gray-400">
              Add this to <code className="bg-gray-100 px-1 rounded">.env.local</code> (already in{' '}
              <code className="bg-gray-100 px-1 rounded">.gitignore</code> — never commit it).
            </p>
          </div>
        </div>
      )}

      {configured === true && (
        <div className="space-y-4">
          {/* Status + Controls */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Live Call</h2>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[status]}`}>
                {statusLabel[status]}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Speaking indicator */}
              {isLive && (
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      isSpeaking ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
                    }`}
                  />
                  <span className="text-xs text-gray-500">
                    {isSpeaking ? 'You are speaking…' : 'Listening for your voice…'}
                  </span>
                </div>
              )}

              {/* Primary action button */}
              <div className="flex items-center gap-3">
                {(status === 'idle' || status === 'error' || status === 'saved') && (
                  <button
                    onClick={status === 'saved' ? resetForNewCall : startCall}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                    {status === 'saved' ? 'Start New Call' : 'Start Voice Call'}
                  </button>
                )}

                {isBusy && (
                  <button
                    disabled
                    className="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    {statusLabel[status]}
                  </button>
                )}

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

                {/* Save status messages */}
                {status === 'saved' && savedCallId && (
                  <span className="text-sm text-green-600 font-medium">
                    Call saved to{' '}
                    <Link href="/dashboard/calls" className="underline hover:text-green-700">
                      Call History
                    </Link>
                  </span>
                )}
                {status === 'saved' && !businessId && (
                  <span className="text-sm text-gray-500">
                    <Link href="/login" className="underline">
                      Sign in
                    </Link>{' '}
                    to save calls.
                  </span>
                )}
              </div>

              {/* Error message */}
              {errorMsg && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}

              <p className="text-xs text-gray-400">
                {businessId
                  ? 'Calls are automatically saved to your account when you end the session.'
                  : 'Sign in to save call transcripts to your account.'}
              </p>
            </div>
          </div>

          {/* Live Transcript */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Transcript</h2>
            </div>

            <div className="p-5 min-h-[240px] max-h-[480px] overflow-y-auto space-y-3">
              {transcript.length === 0 ? (
                <p className="text-sm text-gray-400 text-center pt-8">
                  {isLive || isBusy
                    ? 'Conversation will appear here as you speak…'
                    : 'Start a voice call to see the live transcript.'}
                </p>
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
              <li>• Your OpenAI API key stays on the server — it is never sent to the browser</li>
              <li>• Audio is streamed end-to-end; transcripts are generated by Whisper</li>
              <li>• Calls are saved to your account when you click End Call</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

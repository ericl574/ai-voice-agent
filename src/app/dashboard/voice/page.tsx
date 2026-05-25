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
  | 'saving'       // writing call record to DB
  | 'transcribing' // uploading caller audio + Whisper transcription
  | 'saved'        // call record + official transcript written
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

// ── Post-call extraction result ────────────────────────────────────────────

interface PostCallResult {
  appointmentCreated: boolean;
  serviceRequestCreated: boolean;
  summary: string;
  appointmentError?: string;
  serviceRequestError?: string;
}
type ExtractionState = null | 'running' | PostCallResult | 'error';

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
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState>(null);
  const [extractionErrorMsg, setExtractionErrorMsg] = useState<string | null>(null);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srRef = useRef<any>(null);
  const postCallGenRef = useRef(0);
  // True while a call is live — used by SR onend to decide whether to restart.
  // Separate from statusRef so SR can check it synchronously without stale closure issues.
  const callActiveRef = useRef(false);
  // Tracks when the Realtime assistant is generating audio — used to gate SR to prevent
  // assistant speech from being picked up by the mic and mis-attributed to the caller.
  const assistantActiveRef = useRef(false);
  const assistantCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Caller mic recording — MediaRecorder is the source of truth for post-call transcription.
  // Browser SpeechRecognition (srRef) is kept for live captions only, not for extraction.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  // Web Speech API support check (caller transcript fallback)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    setSpeechSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
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

    if (type === 'input_audio_buffer.speech_started') {
      setIsSpeaking(true);
      // OpenAI VAD confirmed user is speaking — immediately ungate SR.
      // Without this, the response.created for the assistant's reply (which fires after
      // the user speaks) would cancel the 1500ms cooldown and permanently block SR.
      if (assistantCooldownRef.current) {
        clearTimeout(assistantCooldownRef.current);
        assistantCooldownRef.current = null;
      }
      assistantActiveRef.current = false;
      console.log('[FD debug] SR UNGATED — input_audio_buffer.speech_started');
    }
    if (type === 'input_audio_buffer.speech_stopped') setIsSpeaking(false);

    // Gate SR before assistant audio plays — response.created fires before any delta events
    if (type === 'response.created') {
      assistantActiveRef.current = true;
      // DO NOT cancel assistantCooldownRef here — it is the user's speaking window
      // after the previous response. Cancelling it was the root cause of SR getting
      // permanently gated when the user speaks quickly after the greeting.
      console.log('[FD debug] SR gated — response.created');
    }

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
      // Mark assistant as active so SR stops accepting mic input (prevents echo attribution)
      assistantActiveRef.current = true;
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
      // Keep SR gated for 1.5s after assistant finishes — mic still picks up reverb/room echo
      if (assistantCooldownRef.current) clearTimeout(assistantCooldownRef.current);
      console.log('[FD debug] assistant done — cooldown started (1500ms)');
      assistantCooldownRef.current = setTimeout(() => {
        assistantActiveRef.current = false;
        assistantCooldownRef.current = null;
        console.log('[FD debug] cooldown ended — SR ungated');
      }, 1500);
      const itemId = event.item_id as string;
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text } : e))
          : [...prev, { id: itemId, role: 'assistant', text }]
      );
    }

    // Backup assistant transcript — fires when output item is complete
    // Fills in assistant text if delta stream didn't fire (e.g. audio-only items)
    if (type === 'response.output_item.done') {
      const item = event.item as Record<string, unknown> | undefined;
      const itemId = item?.id as string | undefined;
      const content = item?.content as Array<Record<string, unknown>> | undefined;
      if (itemId && content) {
        const audioContent = content.find((c) => c.type === 'audio');
        const backupText = ((audioContent?.transcript as string) ?? '').trim();
        if (backupText) {
          setTranscript((prev) => {
            const existing = prev.find((e) => e.id === itemId);
            // Only use backup if delta stream didn't already populate it
            if (existing?.text.trim()) return prev;
            return existing
              ? prev.map((e) => (e.id === itemId ? { ...e, text: backupText } : e))
              : [...prev, { id: itemId, role: 'assistant', text: backupText }];
          });
        }
      }
    }

    // Backup cooldown — fires after full response turn; covers audio-only responses with no transcript events
    if (type === 'response.done') {
      if (!assistantCooldownRef.current) {
        console.log('[FD debug] response.done — starting backup cooldown (no transcript cooldown active)');
        assistantCooldownRef.current = setTimeout(() => {
          assistantActiveRef.current = false;
          assistantCooldownRef.current = null;
          console.log('[FD debug] backup cooldown ended — SR ungated');
        }, 1500);
      }
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

  // ── Web Speech API — browser-side caller transcript fallback ─────────────
  // TODO: Replace with a working Realtime API transcription config once the correct
  // field name/shape for input_audio_transcription is accepted by the current
  // /v1/realtime/client_secrets or session.update flow. This fallback works only in
  // Chrome and Edge. Real phone calls require server-side audio transcription.
  function startSpeechRecognition() {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sr = new SpeechRec() as any;
    sr.continuous = true;
    sr.interimResults = false;
    sr.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sr.onresult = (event: any) => {
      // Suppress results while the assistant is speaking or in its echo cooldown period.
      // Without this, the mic picks up speaker output and labels it as caller speech.
      if (assistantActiveRef.current) {
        console.log('[FD debug] SR result suppressed — assistant active (echo guard)');
        return;
      }
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (!text) continue;
          console.log('[FD debug] SR caller text captured:', text);
          const id = `user-${Date.now()}-${i}`;
          setTranscript((prev) => [...prev, { id, role: 'user', text }]);
        }
      }
    };

    sr.onerror = (event: Event & { error?: string }) => {
      console.log('[FD debug] SR error:', event?.error ?? event);
    };

    sr.onend = () => {
      console.log('[FD debug] SR ended — callActive:', callActiveRef.current);
      if (!callActiveRef.current || srRef.current !== sr) {
        console.log('[FD debug] SR ended — not restarting (call stopped or SR replaced)');
        return;
      }
      // Chrome can throw InvalidStateError if sr.start() is called immediately in onend.
      // A short delay lets the browser fully release the SR instance before restarting.
      setTimeout(() => {
        if (!callActiveRef.current || srRef.current !== sr) return;
        try {
          sr.start();
          console.log('[FD debug] SR restarted (same instance)');
        } catch (err) {
          // Same-instance restart failed — create a fresh SR instance instead
          console.log('[FD debug] SR restart failed, creating new instance:', err);
          srRef.current = null;
          startSpeechRecognition();
        }
      }, 150);
    };

    try {
      sr.start();
      srRef.current = sr;
      console.log('[FD debug] SR started successfully; speechSupported=true');
    } catch (err) {
      console.log('[FD debug] SR start failed:', err);
    }
  }

  function stopSpeechRecognition() {
    if (srRef.current) {
      srRef.current.onend = null; // prevent auto-restart
      try { srRef.current.stop(); } catch {}
      srRef.current = null;
    }
  }

  // Stops MediaRecorder and returns a Blob of the recorded caller audio.
  // Must be called BEFORE stopping mic tracks so the final audio chunk is captured.
  async function stopMediaRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr) { resolve(null); return; }
      if (mr.state === 'inactive') {
        const blob = audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
          : null;
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(blob);
        return;
      }
      mr.onstop = () => {
        const blob = audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
          : null;
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(blob);
      };
      mr.onerror = () => {
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(null);
      };
      try {
        mr.stop(); // triggers ondataavailable with any remaining data, then onstop
      } catch {
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(null);
      }
    });
  }

  function cleanup() {
    callActiveRef.current = false;
    clearConnectTimeout();
    if (assistantCooldownRef.current) {
      clearTimeout(assistantCooldownRef.current);
      assistantCooldownRef.current = null;
    }
    assistantActiveRef.current = false;
    stopSpeechRecognition();
    // On error paths (connection drop etc.), force-stop MediaRecorder to release mic
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
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
      setErrorMsg(''); // session token received — clear any prior error

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
        setErrorMsg(''); // data channel open — clear any prior error
        callActiveRef.current = true;
        startSpeechRecognition(); // live captions only — NOT the source of truth for extraction
        // Record caller mic audio — source of truth for post-call Whisper transcription
        if (streamRef.current && typeof MediaRecorder !== 'undefined') {
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : '';
          try {
            const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
            mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            mr.start(1000); // emit a chunk every 1s for memory safety on long calls
            mediaRecorderRef.current = mr;
            console.log('[FD debug] MediaRecorder started, mimeType:', mr.mimeType);
          } catch (err) {
            console.warn('[FD debug] MediaRecorder failed to start:', err);
          }
        }
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
    callActiveRef.current = false;
    stopSpeechRecognition();
    // Collect caller audio BEFORE stopping mic tracks — keeps final chunk in recorder
    const callerAudioBlob = await stopMediaRecorder();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // Brief pause for in-flight Realtime assistant transcript events to arrive
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    const entries = transcriptRef.current;
    const callStart = startedAtRef.current;
    const assistantEntries = entries.filter((e) => e.role === 'assistant');

    console.log('[FD debug] stopCall — assistant entries:', assistantEntries.length);
    console.log('[FD debug] stopCall — caller audio blob size:', callerAudioBlob?.size ?? 0, 'bytes');

    cleanup();

    if (!businessId || !isSupabaseConfigured) {
      setStatus('idle');
      return;
    }

    // Preliminary transcript: assistant-only (caller added after Whisper transcription)
    const assistantTranscript = assistantEntries
      .map((e) => `Front desk: ${e.text}`)
      .join('\n');

    const callId = await saveCall(entries, assistantTranscript || '(no transcript captured)', callStart, 'transcribing');
    if (!callId) return;

    // Upload caller audio for official Whisper transcription
    if (callerAudioBlob && callerAudioBlob.size > 500) {
      await uploadAndTranscribe(callId, callerAudioBlob, assistantTranscript);
    } else {
      console.warn('[FD debug] stopCall — no caller audio (blob missing or empty)');
      setErrorMsg('No caller audio was recorded. Appointment extraction could not run. Ensure microphone access is granted and try Chrome or Edge.');
      setStatus('saved');
    }
  }

  async function uploadAndTranscribe(
    callId: string,
    audioBlob: Blob,
    assistantTranscript: string,
  ): Promise<void> {
    const gen = ++postCallGenRef.current;
    setExtraction('running');
    setExtractionErrorMsg(null);
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'caller-audio.webm');
      form.append('call_id', callId);
      form.append('business_id', businessId!);
      form.append('assistant_transcript', assistantTranscript);

      console.log('[FD debug] uploading caller audio —', audioBlob.size, 'bytes');
      const transRes = await fetch('/api/transcribe-call', { method: 'POST', body: form });
      const transData = await transRes.json();
      console.log('[FD debug] transcription result:', JSON.stringify(transData).substring(0, 400));

      if (!transRes.ok) throw new Error(transData.error ?? 'Transcription failed');
      if (gen !== postCallGenRef.current) return; // stale — user already reset

      const officialTranscript: string = transData.transcript ?? '';
      console.log('[FD debug] official transcript (first 400):', officialTranscript.substring(0, 400));

      setStatus('saved');
      runPostCall(callId, officialTranscript); // manages its own extraction state
    } catch (err: unknown) {
      if (gen !== postCallGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FD debug] transcription failed:', msg);
      setExtractionErrorMsg(msg);
      setExtraction('error');
      setErrorMsg(`Call saved, but caller transcription failed: ${msg}. Appointment extraction could not run.`);
      setStatus('saved');
    }
  }

  function cancelConnecting() {
    setStatus('idle');
    setErrorMsg('');
    cleanup();
  }

  async function saveCall(
    entries: TranscriptEntry[],
    transcriptText: string,
    callStart: Date | null,
    finalStatus: CallStatus = 'saved',
  ): Promise<string | null> {
    setStatus('saving');
    try {
      const supabase = createClient();
      const now = new Date();
      const durationSeconds = callStart
        ? Math.round((now.getTime() - callStart.getTime()) / 1000)
        : 0;

      const assistantEntries = entries.filter((e) => e.role === 'assistant');

      const { data: callRow, error: callError } = await supabase
        .from('calls')
        .insert({
          business_id: businessId,
          customer_name: 'Test call',
          customer_phone: null,
          started_at: (callStart ?? now).toISOString(),
          ended_at: now.toISOString(),
          duration_seconds: durationSeconds,
          status: 'resolved',
          intent: 'other',
          summary: assistantEntries.length > 0
            ? 'Call recorded — transcription pending.'
            : 'Test call — no transcript captured.',
          transcript: transcriptText,
          needs_staff_followup: false,
        })
        .select('id')
        .single();

      if (callError || !callRow) throw new Error(callError?.message ?? 'Failed to save call');

      // Save assistant turns immediately — caller message added after Whisper transcription
      if (assistantEntries.length > 0) {
        const messageRows = assistantEntries.map((e) => ({
          call_id: callRow.id,
          role: 'assistant',
          content: e.text,
        }));
        const { error: msgError } = await supabase.from('call_messages').insert(messageRows);
        if (msgError) {
          setErrorMsg(`Call saved, but assistant messages failed: ${msgError.message}`);
        }
      }

      setSavedCallId(callRow.id);
      setStatus(finalStatus);
      return callRow.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Save failed: ${msg}`);
      setStatus('idle');
      return null;
    }
  }

  async function runPostCall(callId: string, transcript: string) {
    const gen = ++postCallGenRef.current;
    setExtraction('running');
    setExtractionErrorMsg(null);
    try {
      const res = await fetch('/api/post-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId, business_id: businessId, transcript }),
      });
      const data = await res.json();
      console.log('[FD debug] post-call response — status:', res.status, '| data:', JSON.stringify(data).substring(0, 500));
      if (gen !== postCallGenRef.current) return;
      if (!res.ok) throw new Error(data.error ?? 'Post-call processing failed');
      setExtraction({
        appointmentCreated: !!data.appointmentCreated,
        serviceRequestCreated: !!data.serviceRequestCreated,
        summary: data.extraction?.summary ?? '',
        appointmentError: data.appointmentError,
        serviceRequestError: data.serviceRequestError,
      });
    } catch (err: unknown) {
      if (gen !== postCallGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setExtractionErrorMsg(msg);
      setExtraction('error');
    }
  }

  function resetForNewCall() {
    setStatus('idle');
    setTranscript([]);
    setErrorMsg('');
    setSavedCallId(null);
    setStartedAt(null);
    setIsSpeaking(false);
    setExtraction(null);
    setExtractionErrorMsg(null);
    postCallGenRef.current++; // invalidate any in-flight post-call response
  }

  // ── Derived UI flags ─────────────────────────────────────────────────────

  const isLive = status === 'connected';
  const isConnecting = status === 'requesting' || status === 'connecting';
  const isBusy = status === 'stopping' || status === 'saving' || status === 'transcribing';
  const canSave = !!businessId && isSupabaseConfigured;

  const statusLabel: Record<CallStatus, string> = {
    idle: 'Ready',
    requesting: 'Checking mic…',
    connecting: 'Connecting…',
    connected: 'Live',
    stopping: 'Ending call…',
    saving: 'Saving…',
    transcribing: 'Transcribing…',
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
    transcribing: 'bg-amber-100 text-amber-700',
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
        <h1 className="text-2xl font-bold text-gray-900">Test the call</h1>
        <p className="text-sm text-gray-500 mt-1">
          Test how your front desk handles a live browser call.
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

              {/* Transcribing status — shown while caller audio is being uploaded and processed */}
              {status === 'transcribing' && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <p className="text-xs text-amber-700">
                    Transcribing caller audio via Whisper — this usually takes a few seconds…
                  </p>
                </div>
              )}

              {/* Save outcome */}
              {status === 'saved' && savedCallId ? (
                <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-green-700 font-medium">Call saved</span>
                    <Link
                      href="/dashboard/calls"
                      className="text-sm font-semibold text-green-700 hover:text-green-800 underline whitespace-nowrap"
                    >
                      View in Call History →
                    </Link>
                  </div>
                  {extraction === 'running' && (
                    <p className="text-xs text-gray-400">Analyzing transcript…</p>
                  )}
                  {extraction === 'error' && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                      Transcript analysis failed{extractionErrorMsg ? `: ${extractionErrorMsg}` : ''}.
                    </p>
                  )}
                  {extraction !== null && typeof extraction === 'object' && (
                    <div className="space-y-1.5">
                      {extraction.appointmentCreated && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-green-600">Appointment request created</span>
                          <Link
                            href="/dashboard/reservations"
                            className="text-xs font-semibold text-green-700 hover:text-green-800 underline whitespace-nowrap"
                          >
                            View Appointments →
                          </Link>
                        </div>
                      )}
                      {extraction.appointmentError && (
                        <p className="text-xs text-red-600">
                          Appointment save failed: {extraction.appointmentError}
                        </p>
                      )}
                      {extraction.serviceRequestCreated && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-green-600">Service request created</span>
                          <Link
                            href="/dashboard/orders"
                            className="text-xs font-semibold text-green-700 hover:text-green-800 underline whitespace-nowrap"
                          >
                            View Service Requests →
                          </Link>
                        </div>
                      )}
                      {extraction.serviceRequestError && (
                        <p className="text-xs text-red-600">
                          Service request save failed: {extraction.serviceRequestError}
                        </p>
                      )}
                      {!extraction.appointmentCreated && !extraction.serviceRequestCreated &&
                       !extraction.appointmentError && !extraction.serviceRequestError &&
                       extraction.summary && (
                        <p className="text-xs text-gray-500 leading-relaxed">{extraction.summary}</p>
                      )}
                    </div>
                  )}
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
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-900">Transcript</h2>
              {speechSupported === false ? (
                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">
                  Caller transcript not supported in this browser
                </span>
              ) : transcript.length > 0 ? (
                <span className="text-xs text-gray-400">{transcript.length} message{transcript.length !== 1 ? 's' : ''}</span>
              ) : null}
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
                        {entry.role === 'user' ? 'Caller' : 'Front desk'}
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
              <li>• Assistant responses are transcribed from the Realtime audio stream</li>
              <li>• Your mic audio is recorded during the call and sent to Whisper after you hang up for official transcription</li>
              <li>• Live captions during the call are a preview only — the Whisper transcript is the official record used for appointments</li>
              <li>• Calls are saved to your account when you click End Call (if signed in)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

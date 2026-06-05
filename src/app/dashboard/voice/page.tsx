'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { looksLikePhone } from '@/lib/call-pipeline/extraction';

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

// Why a call ended — logged so the cause of any teardown is unambiguous.
type EndReason =
  | 'manual'
  | 'auto-end'
  | 'realtime-error'
  | 'peer-disconnect'
  | 'connect-error'
  | 'unknown';

const CONNECT_TIMEOUT_MS = 30_000;

// Delay between detecting a clear end-call cue and actually hanging up — long enough for the
// assistant to speak one short closing sentence first.
const AUTO_END_DELAY_MS = 4_000;

// True when the caller clearly signals the conversation is over. Conservative on purpose:
// a new question in the same utterance (or a "?") cancels the match, and "thank you"/"thanks"
// alone is NOT an end cue.
function looksLikeEndCall(raw: string): boolean {
  const text = raw.toLowerCase().trim();
  if (!text) return false;
  // A new substantive question in the same breath ("thank you, what are your hours?") → not an end.
  if (text.includes('?')) return false;
  if (/\b(what|when|where|how|why|who|which|hours|open|price|cost|available|do you|are you|can you|could you|would you)\b/.test(text)) {
    return false;
  }
  return /\b(bye bye|bye|goodbye|that'?s all|all good|nothing else|no,? that'?s it|end the call|hang up|you can hang up|i said goodbye|i'?m done|i am done|we'?re done|we are done)\b/.test(text);
}

// Dev-only: POST a copy of the recorded caller audio to a local route that writes it to
// project-root /audio-source for offline debugging. Best-effort — never blocks or breaks the
// call flow; failures are logged as warnings only.
async function saveAudioSourceForDebug(blob: Blob): Promise<void> {
  try {
    const form = new FormData();
    form.append('audio', blob, 'caller-audio.webm');
    const res = await fetch('/api/debug/save-audio-source', { method: 'POST', body: form });
    if (!res.ok) {
      console.warn('[FD debug] save-audio-source failed:', res.status);
      return;
    }
    const data = await res.json().catch(() => null);
    if (data?.path) console.log('[FD debug] caller audio source saved to:', data.path);
  } catch (err) {
    console.warn('[FD debug] save-audio-source error:', err);
  }
}

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
  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while a Realtime response is generating. Set on response.created, cleared on
  // response.done/cancelled/failed. Lets us treat the "active response in progress" error as
  // recoverable instead of fatal.
  const responseInProgressRef = useRef(false);
  // Why the call is ending — logged in stopCall/cleanup so failures are unambiguous.
  const endReasonRef = useRef<EndReason>('unknown');
  // Count of recoverable "active response in progress" errors this call — each one is a caller
  // barge-in the server rejected (a possible dropped turn). Logged as a summary at cleanup.
  const activeResponseErrorCountRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const postCallGenRef = useRef(0);
  // Caller mic recording — MediaRecorder is the source of truth for post-call transcription.
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

    // Catch-all diagnostic — every Realtime event type fires through here.
    // Lets us tell at a glance which events the connected model actually emits.
    if (type && !type.startsWith('input_audio_buffer.') && type !== 'response.audio.delta') {
      console.log('[FD debug] event:', type);
    }

    if (type === 'input_audio_buffer.speech_started') {
      console.log('[FD debug] VAD speech_started');
      setIsSpeaking(true);
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      console.log('[FD debug] VAD speech_stopped');
      setIsSpeaking(false);
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

      // Auto end-call: if the caller clearly signals they're done, schedule a graceful hang-up
      // after a short delay (lets the assistant speak its closing). Uses the same path as the
      // End-call button. A later non-closing caller turn cancels a pending hang-up.
      if (looksLikeEndCall(text)) {
        if (statusRef.current === 'connected' && !autoEndTimerRef.current) {
          console.log('[FD debug] end-call intent detected:', JSON.stringify(text));
          console.log('[FD debug] auto end-call scheduled in', AUTO_END_DELAY_MS, 'ms');
          autoEndTimerRef.current = setTimeout(() => {
            autoEndTimerRef.current = null;
            if (statusRef.current === 'connected') {
              console.log(`[FD debug] auto-end triggered by phrase: ${JSON.stringify(text)}`);
              stopCall('auto-end');
            }
          }, AUTO_END_DELAY_MS);
        }
      } else if (autoEndTimerRef.current) {
        console.log('[FD debug] auto end-call cancelled — caller continued');
        clearTimeout(autoEndTimerRef.current);
        autoEndTimerRef.current = null;
      }
    }

    // OpenAI Realtime emits assistant transcript events under two name patterns depending
    // on model/API version: the preview-era `response.audio_transcript.*` and the GA-era
    // `response.output_audio_transcript.*` (used by gpt-realtime-mini). Handle both so the
    // assistant turns are captured regardless of which one the connected model emits.
    if (
      type === 'response.audio_transcript.delta' ||
      type === 'response.output_audio_transcript.delta'
    ) {
      const itemId = event.item_id as string;
      const delta = (event.delta as string) ?? '';
      if (!delta) return;
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text: e.text + delta } : e))
          : [...prev, { id: itemId, role: 'assistant', text: delta }]
      );
    }

    if (
      type === 'response.audio_transcript.done' ||
      type === 'response.output_audio_transcript.done'
    ) {
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
    // Fills in assistant text if delta stream didn't fire (e.g. audio-only items).
    // Realtime GA renamed the audio content type from "audio" → "output_audio";
    // accept both so this backup works on preview AND GA models (e.g. gpt-realtime-mini).
    if (type === 'response.output_item.done') {
      const item = event.item as Record<string, unknown> | undefined;
      const itemId = item?.id as string | undefined;
      const content = item?.content as Array<Record<string, unknown>> | undefined;
      if (itemId && content) {
        const audioContent = content.find(
          (c) => c.type === 'audio' || c.type === 'output_audio',
        );
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

    // Authoritative catch — fires when ANY item joins the conversation history (user OR assistant).
    // The event payload always carries role + content, even when transcript-delta events don't fire
    // for this model. Captures both `conversation.item.added` (GA) and `conversation.item.created`
    // (preview-era). Extracts assistant text from any audio/text content variant.
    if (type === 'conversation.item.added' || type === 'conversation.item.created') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item) {
        const itemId = item.id as string | undefined;
        const role = item.role as string | undefined;
        const content = item.content as Array<Record<string, unknown>> | undefined;
        if (itemId && role === 'assistant' && content) {
          let collected = '';
          for (const c of content) {
            const ct = c.type as string;
            if (ct === 'audio' || ct === 'output_audio') {
              collected += (c.transcript as string) ?? '';
            } else if (ct === 'text' || ct === 'output_text' || ct === 'input_text') {
              collected += (c.text as string) ?? '';
            }
          }
          const text = collected.trim();
          if (text) {
            setTranscript((prev) => {
              const existing = prev.find((e) => e.id === itemId);
              if (existing?.text.trim()) return prev; // delta stream already populated
              return existing
                ? prev.map((e) => (e.id === itemId ? { ...e, text } : e))
                : [...prev, { id: itemId, role: 'assistant', text }];
            });
          }
        }

        // Anchor caller turns at conversation order. A user item joins the conversation
        // BEFORE the assistant responds, but its transcription lands ~1-2s later. Reserve
        // the slot now with an empty placeholder keyed by item_id; the later
        // input_audio_transcription.completed handler fills it in place — keeping the caller
        // turn ahead of the reply instead of appending it after.
        if (itemId && role === 'user') {
          setTranscript((prev) =>
            prev.find((e) => e.id === itemId)
              ? prev
              : [...prev, { id: itemId, role: 'user', text: '' }]
          );
        }
      }
    }

    // ── Response lifecycle tracking ──────────────────────────────────────────
    // A response is "in progress" between response.created and its terminal event. We never send
    // response.create ourselves (server VAD create_response:true auto-generates), but tracking the
    // state lets us treat a duplicate-response error as recoverable.
    if (type === 'response.created') {
      responseInProgressRef.current = true;
      console.log('[FD debug] response.created — active');
    }
    if (
      type === 'response.done' ||
      type === 'response.cancelled' ||
      type === 'response.canceled' ||
      type === 'response.failed'
    ) {
      responseInProgressRef.current = false;
      console.log(`[FD debug] ${type} — response active cleared`);
    }

    if (type === 'error') {
      const errObj = (event.error as Record<string, unknown>) ?? {};
      const message = String(errObj.message ?? JSON.stringify(errObj));
      const code = String(errObj.code ?? '');

      // Recoverable: the server rejected a duplicate auto-response while one is still generating.
      // The in-flight response continues and completes via response.done — keep the call alive.
      const isActiveResponseError =
        /active response in progress/i.test(message) ||
        code === 'conversation_already_has_active_response';

      if (isActiveResponseError) {
        responseInProgressRef.current = true;
        activeResponseErrorCountRef.current += 1; // a caller barge-in the server rejected
        console.log(
          `[FD debug] Realtime error (recoverable — keeping call alive): ${message} | count this call: ${activeResponseErrorCountRef.current}`,
        );
        return; // do NOT setStatus('error') or cleanup() — the session is still alive
      }

      // Fatal: surface and tear down.
      endReasonRef.current = 'realtime-error';
      console.log(`[FD debug] Realtime error (fatal → ending call): ${message}`);
      setErrorMsg(`OpenAI error: ${message}`);
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

  // Stops MediaRecorder and returns a Blob of the recorded caller audio.
  // Must be called BEFORE stopping mic tracks so the final audio chunk is captured.
  async function stopMediaRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr) { resolve(null); return; }

      // Resolve exactly once. A safety timeout guards against onstop/onerror never firing
      // (some browsers can leave MediaRecorder wedged) so stopCall can't hang forever.
      let settled = false;
      const finish = (blob: Blob | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(blob);
      };
      const blobFromChunks = () =>
        audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
          : null;
      const safety = setTimeout(() => {
        console.warn('[FD debug] stopMediaRecorder — onstop did not fire within 3s; resolving best-effort');
        finish(blobFromChunks());
      }, 3000);

      if (mr.state === 'inactive') {
        finish(blobFromChunks());
        return;
      }
      mr.onstop = () => finish(blobFromChunks());
      mr.onerror = () => finish(null);
      try {
        mr.stop(); // triggers ondataavailable with any remaining data, then onstop
      } catch {
        finish(null);
      }
    });
  }

  function cleanup() {
    console.log(`[FD debug] cleanup — call end reason: ${endReasonRef.current}`);
    console.log(
      `[FD debug] call summary — active-response (possible dropped) turns: ${activeResponseErrorCountRef.current}`,
    );
    responseInProgressRef.current = false;
    clearConnectTimeout();
    if (autoEndTimerRef.current) {
      clearTimeout(autoEndTimerRef.current);
      autoEndTimerRef.current = null;
    }
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
    endReasonRef.current = 'unknown';
    responseInProgressRef.current = false;
    activeResponseErrorCountRef.current = 0;
    setStatus('requesting');

    // 1. Request microphone access
    let stream: MediaStream;
    try {
      // Explicitly enable the browser's built-in DSP. echoCancellation stops the assistant's
      // own voice (played through speakers) from looping back into the mic and being heard as
      // caller speech; noiseSuppression/autoGainControl reduce background noise that can falsely
      // trigger a caller turn. Defaults are device-dependent, so request them explicitly.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
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
        endReasonRef.current = 'connect-error';
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
          endReasonRef.current = 'peer-disconnect';
          console.log(`[FD debug] peer connection ${s} → ending call`);
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
        try {
          handleRealtimeEvent(JSON.parse(e.data as string));
        } catch (err) {
          console.warn('[FD debug] failed to handle Realtime event:', err);
        }
      };
      dc.onerror = () => {
        if (statusRef.current === 'connected' || statusRef.current === 'connecting') {
          endReasonRef.current = 'peer-disconnect';
          console.log('[FD debug] data channel error → ending call');
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
        endReasonRef.current = 'connect-error';
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setStatus('error');
        cleanup();
      }
    }
  }

  async function stopCall(reason: EndReason = 'unknown') {
    endReasonRef.current = reason;
    console.log(`[FD debug] stopCall reason: ${reason}`);
    setStatus('stopping');
    // Collect caller audio BEFORE stopping mic tracks — keeps final chunk in recorder
    const callerAudioBlob = await stopMediaRecorder();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // Brief pause for in-flight Realtime assistant transcript events to arrive
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    const entries = transcriptRef.current;
    const callStart = startedAtRef.current;
    const assistantEntries = entries.filter((e) => e.role === 'assistant');

    console.log('[FD debug] stopCall — total entries:', entries.length, '| assistants:', assistantEntries.length);
    if (assistantEntries.length === 0 && entries.length > 0) {
      console.log('[FD debug] stopCall — entries by role:', entries.map((e) => `${e.role}:"${e.text.slice(0, 30)}"`));
    } else if (assistantEntries.length > 0) {
      console.log('[FD debug] stopCall — assistant samples:', assistantEntries.slice(0, 3).map((e) => `"${e.text.slice(0, 40)}"`));
    }
    console.log('[FD debug] stopCall — caller audio blob size:', callerAudioBlob?.size ?? 0, 'bytes');

    // Dev-only: save a copy of the raw recorded caller audio to project-root /audio-source.
    // Fire-and-forget; runs regardless of save/transcription path and never blocks the flow.
    if (callerAudioBlob && callerAudioBlob.size > 0) {
      void saveAudioSourceForDebug(callerAudioBlob);
    }

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
      // Bound the request so a hung transcription can't leave the UI on "Transcribing…" forever.
      // On abort, fetch rejects → the catch below sets extraction error + status 'saved'.
      const ctrl = new AbortController();
      const transcribeTimeout = setTimeout(() => ctrl.abort(), 60_000);
      let transRes: Response;
      try {
        transRes = await fetch('/api/transcribe-call', { method: 'POST', body: form, signal: ctrl.signal });
      } finally {
        clearTimeout(transcribeTimeout);
      }
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
      const msg =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Transcription timed out after 60 seconds'
          : err instanceof Error ? err.message : String(err);
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

      // Save every captured turn — caller AND assistant. The session enables
      // input_audio_transcription server-side, so each caller utterance arrives as its own
      // entry in `transcript` state via `conversation.item.input_audio_transcription.completed`.
      // Insert in the order they were captured so created_at reflects conversation order.
      const turnRows = entries
        .filter((e) => e.text.trim().length > 0)
        .map((e) => ({
          call_id: callRow.id,
          role: e.role === 'assistant' ? 'assistant' : 'customer',
          content: e.text,
        }));
      if (turnRows.length > 0) {
        const { error: msgError } = await supabase.from('call_messages').insert(turnRows);
        if (msgError) {
          setErrorMsg(`Call saved, but transcript rows failed: ${msgError.message}`);
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

      // The per-turn transcription is lossy on digits; the Front Desk confirmation (what the
      // model actually understood) is accurate. Replace the phone-number caller turn in the
      // live transcript with the confirmed number. The server applies the same fix to the saved
      // call_messages so Call History matches.
      const confirmedPhone: string | undefined = data.extraction?.caller_phone ?? undefined;
      if (confirmedPhone) {
        setTranscript((prev) =>
          prev.map((e) =>
            e.role === 'user' && looksLikePhone(e.text) ? { ...e, text: confirmedPhone } : e
          )
        );
      }
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
    endReasonRef.current = 'unknown';
    responseInProgressRef.current = false;
    activeResponseErrorCountRef.current = 0;
    if (autoEndTimerRef.current) {
      clearTimeout(autoEndTimerRef.current);
      autoEndTimerRef.current = null;
    }
  }

  // ── Derived UI flags ─────────────────────────────────────────────────────

  const isLive = status === 'connected';
  const isConnecting = status === 'requesting' || status === 'connecting';
  const isBusy = status === 'stopping' || status === 'saving' || status === 'transcribing';
  const canSave = !!businessId && isSupabaseConfigured;

  // Caller turns are inserted as empty placeholders the moment the item joins the conversation
  // (for correct ordering) and filled when transcription lands — hide the not-yet-filled ones.
  const visibleTranscript = transcript.filter((e) => e.text.trim().length > 0);

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

  const statusPill: Record<CallStatus, string> = {
    idle:         'fd-pill-muted',
    requesting:   'fd-pill-warn',
    connecting:   'fd-pill-warn',
    connected:    'fd-pill-ok',
    stopping:     'fd-pill-warn',
    saving:       'fd-pill-warn',
    transcribing: 'fd-pill-warn',
    saved:        'fd-pill-ok',
    error:        'fd-pill-danger',
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto px-6 sm:px-10 lg:px-12 pt-10 pb-16 space-y-6">
      {/* Hidden audio element — AI voice plays here */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay />

      {/* Header */}
      <header>
        <h1 className="fd-display text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
          Test the call
        </h1>
        <p className="text-[15px] max-w-xl leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          Connect your microphone and speak with the front desk to see how it handles a live call.
        </p>
      </header>

      {/* ── Setup status checklist ──────────────────────────────────────── */}
      <div className="fd-card overflow-hidden">
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <span className="fd-eyebrow" style={{ color: 'var(--ink)' }}>Setup status</span>
        </div>
        <div>
          <style>{`.fd-card > div > div + div { border-top: 1px solid var(--hairline); }`}</style>
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
        <div className="fd-card overflow-hidden" style={{ borderColor: 'var(--warn)' }}>
          <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--warn-soft)', backgroundColor: 'var(--warn-soft)' }}>
            <span className="fd-eyebrow" style={{ color: 'var(--warn)' }}>Setup needed</span>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Live voice not yet enabled</h2>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              The voice agent is built and ready. To activate live calls, add your OpenAI API key
              (Realtime API access required) to your environment and restart the dev server.
            </p>
            <div className="px-4 py-3 font-mono text-sm select-all" style={{ backgroundColor: 'var(--ink)', color: '#a7f3d0' }}>
              OPENAI_API_KEY=sk-…
            </div>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Add this to{' '}
              <code className="px-1" style={{ backgroundColor: 'var(--paper-dim)' }}>.env.local</code>
              {' '}— already in <code className="px-1" style={{ backgroundColor: 'var(--paper-dim)' }}>.gitignore</code> and safe from commits.
            </p>
          </div>
        </div>
      )}

      {/* ── Live call panel ─────────────────────────────────────────────── */}
      {configured === true && (
        <div className="space-y-5">
          {/* Controls card */}
          <div className="fd-card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--hairline)' }}>
              <span className="fd-eyebrow" style={{ color: 'var(--ink)' }}>Live call</span>
              <span className={`fd-pill ${statusPill[status]}`}>
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
                    className="fd-btn fd-btn-accent"
                  >
                    {status === 'saved' ? 'Start new call' : 'Start voice call'} →
                  </button>
                )}

                {isConnecting && (
                  <>
                    <button disabled className="fd-btn fd-btn-ghost">
                      <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      {statusLabel[status]}
                    </button>
                    <button onClick={cancelConnecting} className="fd-btn fd-btn-quiet">
                      Cancel
                    </button>
                  </>
                )}

                {isBusy && (
                  <button disabled className="fd-btn fd-btn-ghost">
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    {statusLabel[status]}
                  </button>
                )}

                {isLive && (
                  <button
                    onClick={() => stopCall('manual')}
                    className="fd-btn"
                    style={{ backgroundColor: 'var(--danger)', color: 'var(--surface)' }}
                  >
                    ■ End call
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
          <div className="fd-card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--hairline)' }}>
              <span className="fd-eyebrow" style={{ color: 'var(--ink)' }}>Transcript</span>
              {visibleTranscript.length > 0 ? (
                <span className="fd-eyebrow fd-numeric" style={{ color: 'var(--ink-muted)' }}>
                  {visibleTranscript.length} message{visibleTranscript.length !== 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
            <div className="p-5 min-h-[240px] max-h-[480px] overflow-y-auto space-y-3">
              {visibleTranscript.length === 0 ? (
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
                visibleTranscript.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className="max-w-[80%] px-4 py-2.5 text-sm rounded"
                      style={{
                        backgroundColor: entry.role === 'user' ? 'var(--ink)' : 'var(--accent-soft)',
                        color: entry.role === 'user' ? 'var(--surface)' : 'var(--ink)',
                        border: entry.role === 'user' ? 'none' : '1px solid var(--hairline)',
                      }}
                    >
                      <span
                        className="block fd-eyebrow mb-1"
                        style={{
                          color: entry.role === 'user' ? 'rgba(255,255,255,0.6)' : 'var(--accent)',
                          fontSize: '9px',
                        }}
                      >
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
          <div className="px-5 py-4" style={{ backgroundColor: 'var(--surface-soft)', border: '1px solid var(--hairline)' }}>
            <p className="fd-eyebrow mb-3" style={{ color: 'var(--ink-muted)' }}>How it works</p>
            <ul className="text-[12px] space-y-1.5" style={{ color: 'var(--ink-soft)' }}>
              <li>· Your browser connects directly to OpenAI Realtime via WebRTC.</li>
              <li>· Your OpenAI API key stays on the server — never sent to your browser.</li>
              <li>· Both sides are transcribed server-side from the Realtime audio stream.</li>
              <li>· Calls are saved to your account when you end the call (if signed in).</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

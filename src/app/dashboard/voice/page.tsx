'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getActiveBusiness } from '@/lib/supabase/businesses';
import { useDashboardMode } from '@/lib/dashboard-mode';
import { looksLikePhone } from '@/lib/call-pipeline/extraction';
import { looksLikeNoiseOrEmpty } from '@/lib/call-pipeline/noise';
import { classifyCallerIntent } from '@/lib/call-pipeline/intent';
import { looksLikeEndCall } from '@/lib/call-pipeline/endCall';
import { buildTranscript, countCallerTurns, FRONT_DESK_LABEL } from '@/lib/call-pipeline/transcript';
import { classifyConnectionState } from '@/lib/realtime/connectionState';

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
  | 'inactivity'
  | 'max-duration'
  | 'realtime-error'
  | 'peer-disconnect'
  | 'connect-error'
  | 'unknown';

const CONNECT_TIMEOUT_MS = 30_000;

// A WebRTC 'disconnected' is often a momentary blip that self-heals back to 'connected'. Wait this
// long for auto-recovery before ending the call, instead of tearing down on the instant flip.
const RECONNECT_GRACE_MS = 8_000;

// Cost safety net: hard cap on a single browser test call so a forgotten/abandoned session can't run
// up Realtime minutes. The call ends gracefully (same path as the End-call button) at this point.
// Generous so it never cuts off a real conversation; the server session also expires at ~5 min.
const MAX_CALL_DURATION_MS = 10 * 60_000;

// End-of-call (freeze): all ending is PLAYBACK-AWARE, not a blind fixed delay.
// - END_DRAIN_MAX_MS: once ending is requested, wait at most this long for the assistant to go idle
//   (no response in progress, no audio playing, no held turn) before saving — a bounded graceful
//   drain so the final closing line is captured but a stuck event can't block save forever.
// - END_CUE_MAX_MS: after a caller end-cue ("bye"), we let the assistant deliver its closing reply
//   and end once that finishes; this is the fallback if that reply never completes.
// - INACTIVITY_END_MS: conservative idle hang-up — end gracefully after this much caller silence,
//   but ONLY once the call is underway and the assistant is idle (never during a thinking pause
//   mid-reply or before the first exchange). Long on purpose to avoid cutting off a slow caller.
const END_DRAIN_MAX_MS = 3_000;
const END_CUE_MAX_MS = 6_000;
const INACTIVITY_END_MS = 28_000;

// Layer 2 — fail-open safety for app-controlled response creation. The app creates the assistant
// reply only AFTER the caller transcript arrives, so if a transcript is slow or never lands the
// caller would sit in silence. After a caller turn is committed by VAD we wait this long for the
// transcript; if it doesn't arrive we create a response anyway (ungated for that rare turn).
const CALLER_TRANSCRIPT_FALLBACK_MS = 2_500;

// Absolute backstop for a HELD caller turn (one deferred while the assistant was still speaking).
// Normally the held turn fires when playback-finished events arrive; this guards the rare case where
// those events are lost, so a held turn can never leave the caller permanently unanswered.
const PENDING_BACKSTOP_MS = 8_000;

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

// ── Voice event timeline (Layer 1 observability) ───────────────────────────
// Dev-only, in-page, structured log of Realtime + app events so voice-pipeline bugs can be
// diagnosed with evidence instead of guessing. The headline signal it exposes: assistant TEXT
// complete vs assistant AUDIO complete vs audio PLAYBACK finished — i.e. "transcript shows a full
// sentence but the caller heard it cut off" becomes visible as event ordering. Also surfaces
// duplicate responses (two response.created without a caller turn) and VAD activity during
// assistant speech. It records ONLY event type, ids, role, and a short FIXED note — never payloads,
// transcript text, secrets, or ephemeral tokens. Off in production builds.

const SHOW_TIMELINE = process.env.NODE_ENV !== 'production';
const VOICE_EVENT_CAP = 300; // ring buffer — keep the most recent N events per call

interface VoiceEvent {
  seq: number;
  tMs: number; // ms since call start (or first event if the call hadn't connected yet)
  type: string; // Realtime event type, or an `app:` action marker
  responseId?: string;
  itemId?: string;
  role?: string;
  note?: string;
}

// Short FIXED note for the events that matter most to voice diagnosis. This is where assistant
// TEXT-complete is explicitly distinguished from assistant AUDIO-generation-done and audio
// PLAYBACK-finished — the core "full transcript but cut-off audio" signal.
function voiceEventNote(type: string): string | undefined {
  switch (type) {
    case 'session.created': return 'session ready';
    case 'input_audio_buffer.speech_started': return 'caller speech detected (VAD)';
    case 'input_audio_buffer.speech_stopped': return 'caller speech ended (VAD)';
    case 'input_audio_buffer.committed': return 'caller turn committed';
    case 'conversation.item.input_audio_transcription.completed': return 'caller turn transcribed';
    case 'response.created': return 'assistant turn started';
    case 'response.output_item.added': return 'assistant item added';
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done': return 'assistant TEXT complete (not audio)';
    case 'response.audio.done':
    case 'response.output_audio.done': return 'assistant AUDIO generation done';
    case 'output_audio_buffer.started': return 'assistant audio playback started';
    case 'output_audio_buffer.stopped': return 'assistant audio playback FINISHED';
    case 'output_audio_buffer.cleared': return 'assistant audio CLEARED (interrupted)';
    case 'response.done': return 'response complete';
    case 'response.cancelled':
    case 'response.canceled': return 'response cancelled';
    case 'response.failed': return 'response failed';
    case 'error': return 'realtime error';
    default: return undefined;
  }
}

type VoiceEventCategory = 'caller' | 'assistant' | 'audio' | 'error' | 'app' | 'other';

function voiceEventCategory(type: string): VoiceEventCategory {
  if (type.startsWith('app:')) return 'app';
  if (type === 'error' || type.endsWith('.failed')) return 'error';
  if (type === 'response.audio.done' || type === 'response.output_audio.done' || type.startsWith('output_audio_buffer.')) return 'audio';
  if (type.startsWith('input_audio_buffer.') || type.includes('input_audio_transcription')) return 'caller';
  if (type.startsWith('response.') || type.startsWith('conversation.item.')) return 'assistant';
  return 'other';
}

const VOICE_CATEGORY_COLOR: Record<VoiceEventCategory, string> = {
  caller: '#2563eb',    // blue  — caller / VAD
  assistant: '#059669', // green — assistant response lifecycle + transcript
  audio: '#7c3aed',     // purple — assistant audio generation + playback buffer
  error: '#dc2626',     // red   — errors / failures
  app: '#b45309',       // amber — app-side decisions (blocked/re-issued/filtered)
  other: '#6b7280',     // gray
};

// Last 6 chars of an id — enough to correlate events without dumping full ids.
function shortId(id?: string): string {
  return id ? `…${id.slice(-6)}` : '';
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
  // Demo mode (server-resolved) forces the not-saved experience even for a logged-in user, so the
  // demo CTA → this page stays fully in demo. The live test call still works; it just isn't saved.
  const { isDemo } = useDashboardMode();
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
  // Grace timer armed on a transient WebRTC 'disconnected' — ends the call only if it doesn't
  // recover to 'connected' within RECONNECT_GRACE_MS (see onconnectionstatechange).
  const reconnectGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cost safety net — force-ends an over-long call (see MAX_CALL_DURATION_MS).
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // End-of-call state (freeze). endRequested = a graceful end is draining → no new responses.
  // endAfterReply = a caller end-cue fired; end once the assistant's closing reply finishes.
  // substantiveCallerTurnSeen = ≥1 valid caller turn has been accepted this call (gates inactivity-end
  // so it never fires after just a greeting / before a real exchange).
  const endRequestedRef = useRef(false);
  const endAfterReplyRef = useRef(false);
  const substantiveCallerTurnSeenRef = useRef(false);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endCueFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Explicit pending-caller-transcript signal — item_ids committed by VAD but not yet transcribed.
  // Used by BOTH the bounded drain-before-save and the inactivity-end checks (NOT the fail-open
  // timer, which is cleared when it fires while a transcript may still be pending).
  const pendingCallerTranscriptRef = useRef<Set<string>>(new Set());
  // Layer 2 assistant-turn state — the two are tracked SEPARATELY on purpose. A response being
  // "done" does NOT mean the caller heard the audio: playback continues after response.done and the
  // server can still clear it. responseInProgress gates response creation; audioPlaying decides
  // whether a new caller turn is held (assistant still speaking) vs answered now.
  //   responseInProgress: response.created → true; response.done/cancelled/failed → false.
  //   assistantAudioPlaying: output_audio_buffer.started → true; .stopped/.cleared → false.
  const responseInProgressRef = useRef(false);
  const assistantAudioPlayingRef = useRef(false);
  // Why the call is ending — logged in stopCall/cleanup so failures are unambiguous.
  const endReasonRef = useRef<EndReason>('unknown');
  // Count of "active response in progress" errors this call (should be ~0 now that the app owns
  // response creation). Logged as a summary at cleanup.
  const activeResponseErrorCountRef = useRef(0);
  // A substantive caller turn arrived while the assistant was still speaking — answered with exactly
  // one response once playback finishes (see onAssistantSettled / deferCallerResponse backstop).
  const pendingCallerResponseRef = useRef(false);
  // Layer 2 turn timers: fail-open if the caller transcript never arrives; flush a held turn after
  // playback; absolute backstop so a held turn can't hang forever.
  const callerTurnFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBackstopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Risk 1 guard: caller item_ids already answered by the fail-open fallback. A late transcript for
  // the same item must update/save text but must NOT create a SECOND response for that turn.
  const fallbackAnsweredItemsRef = useRef<Set<string>>(new Set());
  // Risk 2 snapshot: was the assistant speaking when THIS caller turn began? Captured at speech-start
  // / item-creation (when the caller actually spoke) and used for backchannel suppression, because
  // the live busy state at transcript-arrival time lags ~1-2s and would let backchannels leak through
  // on short assistant replies.
  const speechStartBusyRef = useRef(false);
  const itemBusyAtSpeechRef = useRef<Map<string, boolean>>(new Map());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const postCallGenRef = useRef(0);
  // Caller mic recording — MediaRecorder is the source of truth for post-call transcription.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Layer 1 voice observability — dev-only structured event timeline (see SHOW_TIMELINE / VoiceEvent).
  const [voiceEvents, setVoiceEvents] = useState<VoiceEvent[]>([]);
  const [showTimeline, setShowTimeline] = useState(true);
  const voiceSeqRef = useRef(0);
  const voiceBaselineRef = useRef<number | null>(null); // first-event timestamp fallback before connect

  // Append one event to the in-page voice timeline. No-op in production. Records only type, ids,
  // role, and a short fixed note — never payloads, transcript text, or secrets.
  function recordVoiceEvent(
    type: string,
    extra?: Partial<Pick<VoiceEvent, 'responseId' | 'itemId' | 'role' | 'note'>>,
  ) {
    if (!SHOW_TIMELINE) return;
    const now = Date.now();
    if (voiceBaselineRef.current === null) voiceBaselineRef.current = now;
    const baseline = startedAtRef.current?.getTime() ?? voiceBaselineRef.current;
    const seq = ++voiceSeqRef.current;
    const note = extra?.note ?? voiceEventNote(type);
    setVoiceEvents((prev) => {
      const next = [
        ...prev,
        { seq, tMs: now - baseline, type, responseId: extra?.responseId, itemId: extra?.itemId, role: extra?.role, note },
      ];
      return next.length > VOICE_EVENT_CAP ? next.slice(next.length - VOICE_EVENT_CAP) : next;
    });
  }

  function resetVoiceTimeline() {
    if (!SHOW_TIMELINE) return;
    voiceSeqRef.current = 0;
    voiceBaselineRef.current = null;
    setVoiceEvents([]);
  }

  // ── Layer 2: app-controlled response creation ────────────────────────────
  // Server VAD no longer auto-creates responses (create_response:false). These helpers are the ONLY
  // path that asks Realtime for an assistant reply, so noise/background/duplicate turns can be gated
  // out before a response is ever generated.

  function clearTurnTimers() {
    for (const ref of [callerTurnFallbackTimerRef, flushPendingTimerRef, pendingBackstopTimerRef]) {
      if (ref.current) { clearTimeout(ref.current); ref.current = null; }
    }
  }

  // Full reset of Layer 2 response/turn state. Used when (re)starting or resetting a call.
  function resetResponseState() {
    responseInProgressRef.current = false;
    assistantAudioPlayingRef.current = false;
    pendingCallerResponseRef.current = false;
    activeResponseErrorCountRef.current = 0;
    fallbackAnsweredItemsRef.current.clear();
    itemBusyAtSpeechRef.current.clear();
    speechStartBusyRef.current = false;
    endRequestedRef.current = false;
    endAfterReplyRef.current = false;
    substantiveCallerTurnSeenRef.current = false;
    pendingCallerTranscriptRef.current.clear();
    clearTurnTimers();
    clearEndTimers();
  }

  // The SINGLE place the app sends response.create. Guarded: only when the data channel is open, the
  // call is connected, no response is already generating, and the assistant's audio isn't still
  // playing (in which case we defer instead of cutting it off). Returns true iff a response was sent.
  function sendResponseCreate(reason: string): boolean {
    if (endRequestedRef.current) {
      // The call is ending/draining — never create a new assistant response.
      recordVoiceEvent('app:response.create blocked/ending', { note: reason });
      return false;
    }
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open' || statusRef.current !== 'connected') {
      recordVoiceEvent('app:response.create blocked/not-connected', { note: reason });
      return false;
    }
    if (responseInProgressRef.current) {
      recordVoiceEvent('app:response.create blocked/response in progress', { note: reason });
      return false;
    }
    if (assistantAudioPlayingRef.current) {
      // Assistant audio is still playing — hold this turn rather than talk over it. The held turn
      // fires from onAssistantSettled() once playback finishes.
      deferCallerResponse();
      recordVoiceEvent('app:response.create blocked/assistant audio playing', { note: reason });
      return false;
    }
    dc.send(JSON.stringify({ type: 'response.create' }));
    recordVoiceEvent('app:response.create sent', { note: reason });
    return true;
  }

  // Remember a caller turn to answer once the assistant finishes speaking, and arm the absolute
  // backstop so the held turn can never hang forever if playback-finished events are lost.
  function deferCallerResponse() {
    if (endRequestedRef.current) return; // ending — do not hold new turns
    pendingCallerResponseRef.current = true;
    if (pendingBackstopTimerRef.current) clearTimeout(pendingBackstopTimerRef.current);
    pendingBackstopTimerRef.current = setTimeout(() => {
      pendingBackstopTimerRef.current = null;
      if (!pendingCallerResponseRef.current) return;
      if (responseInProgressRef.current) return; // a real response is still generating; its terminal event will flush
      // Playback-finished events were likely lost — assume idle and answer the held turn.
      assistantAudioPlayingRef.current = false;
      recordVoiceEvent('app:response.create flushed (backstop — playback events lost)');
      if (sendResponseCreate('deferred caller turn (backstop)')) pendingCallerResponseRef.current = false;
    }, PENDING_BACKSTOP_MS);
  }

  // Called after any event that could end the assistant's turn (response terminal, playback
  // stopped/cleared). Debounced so response.done and output_audio_buffer.stopped coalesce. Once the
  // assistant is fully idle it, in order: (1) flushes a held caller turn, (2) ends the call if a
  // caller end-cue is pending, (3) arms the conservative inactivity hang-up.
  function onAssistantSettled() {
    if (flushPendingTimerRef.current) clearTimeout(flushPendingTimerRef.current);
    flushPendingTimerRef.current = setTimeout(() => {
      flushPendingTimerRef.current = null;
      if (responseInProgressRef.current || assistantAudioPlayingRef.current) return; // not idle yet
      // 1) Answer a held caller turn first (creates a new response → no longer idle).
      if (pendingCallerResponseRef.current && !endRequestedRef.current) {
        recordVoiceEvent('app:response.create flushed (deferred caller turn)');
        if (sendResponseCreate('deferred caller turn')) {
          pendingCallerResponseRef.current = false;
          if (pendingBackstopTimerRef.current) { clearTimeout(pendingBackstopTimerRef.current); pendingBackstopTimerRef.current = null; }
          return; // response in progress now
        }
      }
      if (pendingCallerResponseRef.current) return; // still pending (couldn't send) — wait
      if (endRequestedRef.current) return; // already draining — drainThenStop handles the stop
      // 2) Caller asked to end: the closing reply has now finished playing — end gracefully.
      if (endAfterReplyRef.current) {
        recordVoiceEvent('app:end-call cue — closing reply finished, ending');
        requestEndCall('auto-end');
        return;
      }
      // 3) Assistant idle and nothing pending — arm the conservative inactivity end.
      maybeArmInactivity();
    }, 250);
  }

  // ── End-of-call (freeze): playback-aware ending + bounded graceful drain ───
  function clearInactivityTimer() {
    if (inactivityTimerRef.current) { clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = null; }
  }

  function clearEndTimers() {
    for (const ref of [inactivityTimerRef, endCueFallbackTimerRef, endDrainTimerRef]) {
      if (ref.current) { clearTimeout(ref.current); ref.current = null; }
    }
  }

  // True when every condition for a safe inactivity hang-up holds. Called both at arm time and again
  // at fire time. Requires: ≥1 substantive caller turn this call AND the assistant fully idle (so by
  // construction ≥1 assistant response has finished after that caller turn — maybeArmInactivity is
  // only invoked from onAssistantSettled), no held caller response, no pending caller transcript, and
  // not already ending. Never fires after just a greeting / before a real exchange.
  function inactivityEndAllowed(): boolean {
    return (
      substantiveCallerTurnSeenRef.current &&
      !endRequestedRef.current &&
      !endAfterReplyRef.current &&
      !responseInProgressRef.current &&
      !assistantAudioPlayingRef.current &&
      !pendingCallerResponseRef.current &&
      pendingCallerTranscriptRef.current.size === 0
    );
  }

  // Arm the inactivity hang-up — only when inactivityEndAllowed(). Re-checks at fire time so a
  // resumed caller (or any in-flight turn) cancels it.
  function maybeArmInactivity() {
    clearInactivityTimer();
    if (!inactivityEndAllowed()) return;
    inactivityTimerRef.current = setTimeout(() => {
      inactivityTimerRef.current = null;
      if (statusRef.current !== 'connected') return;
      if (!inactivityEndAllowed()) return;
      recordVoiceEvent('app:inactivity end — caller silent after assistant idle');
      requestEndCall('inactivity');
    }, INACTIVITY_END_MS);
  }

  // The single entry point for ending a call (manual button, end-cue, inactivity, max-duration).
  // Enters a draining state that blocks new responses, then saves once the assistant is idle (or a
  // bounded timeout elapses) so the final closing line is captured without hanging forever.
  function requestEndCall(reason: EndReason) {
    if (endRequestedRef.current) return; // already ending
    if (statusRef.current !== 'connected') { stopCall(reason); return; } // not live — stop directly
    endRequestedRef.current = true;
    endReasonRef.current = reason;
    endAfterReplyRef.current = false;
    pendingCallerResponseRef.current = false; // ending — drop any held turn
    clearTurnTimers();
    clearInactivityTimer();
    if (endCueFallbackTimerRef.current) { clearTimeout(endCueFallbackTimerRef.current); endCueFallbackTimerRef.current = null; }
    recordVoiceEvent('app:end requested — draining before save', { note: reason });
    setStatus('stopping');
    drainThenStop(reason, Date.now());
  }

  // Poll until the assistant is idle (bounded by END_DRAIN_MAX_MS), then save. A stuck Realtime
  // event can never block save past the bound.
  function drainThenStop(reason: EndReason, startTs: number) {
    const idle =
      !responseInProgressRef.current &&
      !assistantAudioPlayingRef.current &&
      !pendingCallerResponseRef.current &&
      pendingCallerTranscriptRef.current.size === 0; // also wait for any committed caller turn's transcript
    if (idle) {
      recordVoiceEvent('app:end drain complete — assistant idle, saving');
      stopCall(reason);
      return;
    }
    if (Date.now() - startTs >= END_DRAIN_MAX_MS) {
      recordVoiceEvent('app:end wait timed out — saving best available transcript');
      stopCall(reason);
      return;
    }
    endDrainTimerRef.current = setTimeout(() => drainThenStop(reason, startTs), 150);
  }

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

  // Best-effort teardown if the tab is closed/navigated away mid-call — releases the mic and closes
  // the peer connection so a Realtime session doesn't keep running (cost) until the server expiry.
  // Kept minimal + synchronous (no setState) because unload handlers can't run async work.
  useEffect(() => {
    const teardown = () => {
      if (statusRef.current !== 'connected' && statusRef.current !== 'connecting') return;
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      try { pcRef.current?.close(); } catch {}
    };
    window.addEventListener('pagehide', teardown);
    window.addEventListener('beforeunload', teardown);
    return () => {
      window.removeEventListener('pagehide', teardown);
      window.removeEventListener('beforeunload', teardown);
    };
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
    // In demo mode, never resolve a real business — keep the page in its not-saved demo state.
    if (isDemo || !isSupabaseConfigured) {
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
  }, [isDemo]);

  // ── OpenAI Realtime event handler ────────────────────────────────────────

  function handleRealtimeEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    // Catch-all diagnostic — every Realtime event type fires through here.
    // Lets us tell at a glance which events the connected model actually emits.
    if (type && !type.startsWith('input_audio_buffer.') && type !== 'response.audio.delta') {
      console.log('[FD debug] event:', type);
    }

    // Layer 1 timeline: record every NON-delta event generically (deltas fire too often to be
    // useful and would flood the panel). This is what makes audio-done vs transcript-done ordering,
    // duplicate response.created, and VAD-during-speech visible. Identifiers are pulled generically
    // from whichever shape the event uses (response_id / response.id, item_id / item.id).
    if (type && !type.endsWith('.delta')) {
      const responseId =
        (typeof event.response_id === 'string' ? event.response_id : undefined) ??
        ((event.response as Record<string, unknown> | undefined)?.id as string | undefined);
      const item = event.item as Record<string, unknown> | undefined;
      const itemId =
        (typeof event.item_id === 'string' ? event.item_id : undefined) ??
        (item?.id as string | undefined);
      const role = item?.role as string | undefined;
      recordVoiceEvent(type, { responseId, itemId, role });
    }

    if (type === 'input_audio_buffer.speech_started') {
      console.log('[FD debug] VAD speech_started');
      setIsSpeaking(true);
      clearInactivityTimer(); // caller is active — cancel any pending idle hang-up
      // Risk 2: capture whether the assistant was speaking the moment the caller started talking.
      // Stored per-item at commit/item-added below and used for backchannel suppression.
      speechStartBusyRef.current = responseInProgressRef.current || assistantAudioPlayingRef.current;
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      console.log('[FD debug] VAD speech_stopped');
      setIsSpeaking(false);
    }

    // Layer 2 fail-open: a caller turn was committed by VAD. The app now waits for the transcript
    // before creating a response, so arm a safety timer — if the transcript never arrives, create a
    // response anyway so the caller isn't left in silence. Cleared when the transcript lands (valid
    // or noise) so a noise-only turn never fail-open-triggers a reply.
    if (type === 'input_audio_buffer.committed') {
      clearInactivityTimer(); // a caller turn was captured — cancel any pending idle hang-up
      const committedItemId = typeof event.item_id === 'string' ? event.item_id : undefined;
      // Risk 2: bind the speech-start busy snapshot to this caller item (first writer wins).
      if (committedItemId && !itemBusyAtSpeechRef.current.has(committedItemId)) {
        itemBusyAtSpeechRef.current.set(committedItemId, speechStartBusyRef.current);
      }
      // A finalized caller turn is now awaiting its transcript — the bounded drain + inactivity end
      // both wait on this until the matching transcription.completed clears it.
      if (committedItemId) pendingCallerTranscriptRef.current.add(committedItemId);
      if (callerTurnFallbackTimerRef.current) clearTimeout(callerTurnFallbackTimerRef.current);
      callerTurnFallbackTimerRef.current = setTimeout(() => {
        callerTurnFallbackTimerRef.current = null;
        if (statusRef.current !== 'connected') return;
        // Risk 1: this turn is being answered WITHOUT a transcript. Remember the item so a late
        // transcript for it cannot trigger a second response.
        if (committedItemId) fallbackAnsweredItemsRef.current.add(committedItemId);
        if (responseInProgressRef.current || assistantAudioPlayingRef.current) {
          deferCallerResponse();
          recordVoiceEvent('app:response.create deferred (fallback — assistant speaking)', committedItemId ? { itemId: committedItemId } : undefined);
          return;
        }
        sendResponseCreate('fallback — transcript missing');
      }, CALLER_TRANSCRIPT_FALLBACK_MS);
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      setIsSpeaking(false);
      // The caller transcript arrived — cancel the fail-open fallback for this turn; we now gate on
      // the actual text instead of blindly creating a response.
      if (callerTurnFallbackTimerRef.current) {
        clearTimeout(callerTurnFallbackTimerRef.current);
        callerTurnFallbackTimerRef.current = null;
      }
      const itemId = event.item_id as string;
      // This committed turn's transcript has now arrived (whatever its content) — clear the explicit
      // pending-transcript signal for ANY outcome (valid / noise / empty), so the drain + inactivity
      // checks don't wait on it forever.
      if (itemId) pendingCallerTranscriptRef.current.delete(itemId);
      const text = ((event.transcript as string) ?? '').trim();
      if (!text) return;
      // Drop obvious noise/junk caller fragments (silence hallucinations, lone fillers, bare
      // punctuation) BEFORE they reach the transcript, the save path, or end-call detection — so
      // noise doesn't create fake caller turns, pollute saved transcripts, or hang up the call on a
      // hallucinated "thank you". The reserved empty placeholder stays empty (not rendered, not
      // saved). Conservative: real short replies are kept. See looksLikeNoiseOrEmpty.
      if (looksLikeNoiseOrEmpty(text)) {
        console.log('[FD debug] caller fragment filtered as noise/junk:', JSON.stringify(text));
        recordVoiceEvent('app:caller fragment filtered (noise/junk)', { itemId });
        return;
      }

      // Layer 2 caller-intent gate. Obvious noise is already gone.
      const intent = classifyCallerIntent(text);
      // Risk 1: did the fail-open fallback already answer THIS exact caller turn?
      const answeredByFallback = fallbackAnsweredItemsRef.current.has(itemId);
      // Risk 2: was the assistant speaking when this turn BEGAN (snapshot), not merely now? The live
      // state lags ~1-2s behind the caller, so a backchannel spoken over a short reply would
      // otherwise leak through after the assistant goes idle. Default false → never over-suppress.
      const busyAtSpeech = itemBusyAtSpeechRef.current.get(itemId) ?? false;
      itemBusyAtSpeechRef.current.delete(itemId);
      const liveBusy = responseInProgressRef.current || assistantAudioPlayingRef.current;

      // A bare backchannel ("mhm"/"yeah") the caller spoke WHILE the assistant was talking is
      // IGNORED — no reply, no state change, not saved (same early-return as noise) — even if its
      // transcript only lands now. Skip this when the fallback already answered the turn (it was
      // treated as a real turn; keep its text). When the assistant was idle at speech time, a
      // "yeah"/"okay" is a real answer and flows through normally.
      if (intent === 'backchannel' && busyAtSpeech && !answeredByFallback) {
        console.log('[FD debug] caller backchannel ignored (assistant busy at speech start):', JSON.stringify(text));
        recordVoiceEvent('app:caller turn ignored/backchannel', { itemId });
        return;
      }

      console.log('[FD debug] caller fragment accepted:', JSON.stringify(text));
      recordVoiceEvent('app:valid caller turn accepted', { itemId, note: intent });
      // A real exchange has happened → inactivity-end becomes allowed (after the assistant next goes
      // idle). Caller is active right now, so cancel any armed idle hang-up.
      substantiveCallerTurnSeenRef.current = true;
      clearInactivityTimer();
      setTranscript((prev) =>
        prev.find((e) => e.id === itemId)
          ? prev.map((e) => (e.id === itemId ? { ...e, text } : e))
          : [...prev, { id: itemId, role: 'user', text }]
      );

      // Auto end-call (playback-aware): if the caller clearly signals they're done, let the assistant
      // deliver its closing reply (created by the normal turn handler below), then end once that
      // reply has finished PLAYING (onAssistantSettled) — never a blind fixed delay. A later
      // non-closing caller turn cancels the pending end. A bounded fallback ends the call if the
      // closing reply never completes.
      if (looksLikeEndCall(text)) {
        if (statusRef.current === 'connected' && !endAfterReplyRef.current && !endRequestedRef.current) {
          console.log('[FD debug] end-call intent detected:', JSON.stringify(text));
          recordVoiceEvent('app:end-call cue detected — will end after closing reply', { itemId });
          endAfterReplyRef.current = true;
          clearInactivityTimer();
          if (endCueFallbackTimerRef.current) clearTimeout(endCueFallbackTimerRef.current);
          endCueFallbackTimerRef.current = setTimeout(() => {
            endCueFallbackTimerRef.current = null;
            if (endAfterReplyRef.current && !endRequestedRef.current && statusRef.current === 'connected') {
              recordVoiceEvent('app:end-call cue fallback — forcing end');
              requestEndCall('auto-end');
            }
          }, END_CUE_MAX_MS);
        }
      } else if (endAfterReplyRef.current) {
        console.log('[FD debug] end-call cancelled — caller continued');
        recordVoiceEvent('app:end-call cue cancelled — caller continued');
        endAfterReplyRef.current = false;
        if (endCueFallbackTimerRef.current) { clearTimeout(endCueFallbackTimerRef.current); endCueFallbackTimerRef.current = null; }
      }

      // Layer 2: create exactly ONE assistant response for this caller turn.
      if (answeredByFallback) {
        // The fail-open fallback already created/queued a response for this exact turn — never send a
        // second. The transcript text was still saved/updated above.
        fallbackAnsweredItemsRef.current.delete(itemId);
        console.log('[FD debug] late transcript for fallback-answered turn — no second response:', JSON.stringify(text));
        recordVoiceEvent('app:late transcript after fallback — no second response', { itemId });
      } else if (liveBusy) {
        // Assistant still speaking — hold and answer once playback finishes (we never cut it off —
        // interrupt_response is false).
        deferCallerResponse();
        recordVoiceEvent('app:response.create deferred (assistant speaking)', { itemId });
      } else {
        sendResponseCreate('caller turn');
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
          // Risk 2: bind the speech-start busy snapshot to this caller item (first writer wins —
          // committed may have already set it). Used later for backchannel suppression.
          if (!itemBusyAtSpeechRef.current.has(itemId)) {
            itemBusyAtSpeechRef.current.set(itemId, speechStartBusyRef.current);
          }
          setTranscript((prev) =>
            prev.find((e) => e.id === itemId)
              ? prev
              : [...prev, { id: itemId, role: 'user', text: '' }]
          );
        }
      }
    }

    // ── Response lifecycle tracking ──────────────────────────────────────────
    // A response is "in progress" between response.created and its terminal event. Response creation
    // is now app-owned (create_response:false) via sendResponseCreate — this state gates it.
    if (type === 'response.created') {
      responseInProgressRef.current = true;
      clearInactivityTimer(); // assistant busy → no idle countdown
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
      // NB: response.done does NOT mean the caller heard the audio — playback may still be running.
      // A held caller turn is only flushed once playback also finishes (onAssistantSettled re-checks
      // assistantAudioPlaying, then handles end-after-reply / inactivity arming).
      onAssistantSettled();
    }

    // ── Assistant audio playback state ───────────────────────────────────────
    // Tracked separately from response.done — this is the real "caller heard the audio" signal. The
    // raw output_audio_buffer.* events are already in the Layer 1 timeline; here we drive app state
    // and flush any held caller turn once playback truly ends.
    if (type === 'output_audio_buffer.started') {
      assistantAudioPlayingRef.current = true;
    }
    if (type === 'output_audio_buffer.stopped') {
      assistantAudioPlayingRef.current = false;
      onAssistantSettled();
    }
    if (type === 'output_audio_buffer.cleared') {
      // Server cleared playback (e.g. a competing speaker triggered VAD). We can't prevent the
      // server-side clear here (Layer 2 scope); we just reflect state and flush any held turn.
      assistantAudioPlayingRef.current = false;
      onAssistantSettled();
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
        // Defensive only — should be rare now that the app gates response creation. Treat as a held
        // turn: answer once the in-flight response + playback finish.
        responseInProgressRef.current = true;
        deferCallerResponse();
        activeResponseErrorCountRef.current += 1;
        console.log(
          `[FD debug] Realtime error (recoverable — keeping call alive): ${message} | count this call: ${activeResponseErrorCountRef.current}`,
        );
        recordVoiceEvent('app:duplicate response blocked (active response in progress)', {
          note: `count ${activeResponseErrorCountRef.current}`,
        });
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
    assistantAudioPlayingRef.current = false;
    pendingCallerResponseRef.current = false;
    fallbackAnsweredItemsRef.current.clear();
    itemBusyAtSpeechRef.current.clear();
    speechStartBusyRef.current = false;
    endRequestedRef.current = false;
    endAfterReplyRef.current = false;
    substantiveCallerTurnSeenRef.current = false;
    pendingCallerTranscriptRef.current.clear();
    clearTurnTimers();
    clearEndTimers();
    clearConnectTimeout();
    if (reconnectGraceTimerRef.current) {
      clearTimeout(reconnectGraceTimerRef.current);
      reconnectGraceTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
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
    // Guard against starting a second call over a live/connecting one — a new peer connection would
    // orphan the previous session (leaked mic + Realtime minutes). The button is already hidden while
    // live, so this is purely defensive.
    if (statusRef.current === 'connecting' || statusRef.current === 'connected') {
      console.warn('[FD debug] startCall ignored — a call is already active/connecting');
      return;
    }
    setErrorMsg('');
    setTranscript([]);
    setSavedCallId(null);
    resetVoiceTimeline();
    endReasonRef.current = 'unknown';
    resetResponseState();
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

      // Handle connection drops. A transient 'disconnected' often self-heals, so we wait a bounded
      // grace period for recovery instead of tearing the call down on the instant flip; only
      // 'failed'/'closed' end immediately. (classifyConnectionState is the single, tested rule.)
      const endOnDrop = (s: string) => {
        endReasonRef.current = 'peer-disconnect';
        console.log(`[FD debug] peer connection ${s} → ending call`);
        setErrorMsg('The connection was interrupted. The call has ended unexpectedly.');
        setStatus('error');
        cleanup();
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        const disposition = classifyConnectionState(s);

        // Recovered before the grace timer fired → cancel the pending teardown, keep the call live.
        if (s === 'connected' && reconnectGraceTimerRef.current) {
          clearTimeout(reconnectGraceTimerRef.current);
          reconnectGraceTimerRef.current = null;
          setErrorMsg('');
          console.log('[FD debug] peer connection recovered from transient disconnect');
          recordVoiceEvent('app:connection recovered (transient disconnect)');
          return;
        }

        if (disposition === 'ignore' || statusRef.current !== 'connected') return;

        if (disposition === 'recover-wait') {
          if (reconnectGraceTimerRef.current) return; // already waiting out this blip
          console.log(`[FD debug] peer connection ${s} → waiting ${RECONNECT_GRACE_MS / 1000}s for auto-recovery`);
          recordVoiceEvent('app:transient disconnect — waiting for recovery');
          reconnectGraceTimerRef.current = setTimeout(() => {
            reconnectGraceTimerRef.current = null;
            // Still not recovered when the grace elapsed → end the call.
            if (statusRef.current === 'connected' && pcRef.current?.connectionState !== 'connected') {
              endOnDrop(pcRef.current?.connectionState ?? 'disconnected');
            }
          }, RECONNECT_GRACE_MS);
          return;
        }

        // 'failed' | 'closed' — terminal, end now.
        endOnDrop(s);
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
        // Cost safety net: end the call gracefully if it runs past the hard cap.
        if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
        maxDurationTimerRef.current = setTimeout(() => {
          maxDurationTimerRef.current = null;
          if (statusRef.current === 'connected') {
            console.log('[FD debug] max call duration reached → ending call');
            recordVoiceEvent('app:max call duration reached — ending call');
            requestEndCall('max-duration');
          }
        }, MAX_CALL_DURATION_MS);
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
    // NB: no fixed post-stop delay here. End paths run through requestEndCall→drainThenStop, which
    // already waited (bounded by END_DRAIN_MAX_MS) for the assistant to be idle AND for any committed
    // caller turn's transcript (pendingCallerTranscriptRef). The only path that reaches stopCall
    // without that drain is the not-connected edge in requestEndCall, where there is nothing in flight.

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

    // The live Realtime transcript is the PRIMARY source of truth — more accurate than the
    // post-call batch recording. Assemble it role-labeled + interleaved in conversation order
    // (Option A noise/empty filtering applied inside buildTranscript).
    const officialTranscript = buildTranscript(entries, looksLikeNoiseOrEmpty);
    const callerTurns = countCallerTurns(entries, looksLikeNoiseOrEmpty);

    const callId = await saveCall(
      entries,
      officialTranscript || '(no transcript captured)',
      callStart,
      'transcribing',
    );
    if (!callId) return;

    if (callerTurns > 0) {
      // Primary path: we have real Realtime caller turns — extract from them directly, skip batch.
      console.log('[FD debug] stopCall — using Realtime transcript as primary (caller turns:', callerTurns, ')');
      setStatus('saved');
      runPostCall(callId, officialTranscript);
    } else if (callerAudioBlob && callerAudioBlob.size > 500) {
      // Fallback ONLY (no usable Realtime caller turns): transcribe the recorded caller audio. The
      // assistant-only lines are assembled here just to give the batch transcript both sides.
      console.log('[FD debug] stopCall — no Realtime caller turns; falling back to batch transcription');
      const assistantTranscript = assistantEntries
        .map((e) => `${FRONT_DESK_LABEL} ${e.text}`)
        .join('\n');
      await uploadAndTranscribe(callId, callerAudioBlob, assistantTranscript);
    } else {
      console.warn('[FD debug] stopCall — no Realtime caller turns and no caller audio');
      setErrorMsg('No caller speech was captured. Appointment extraction could not run. Ensure microphone access is granted and try Chrome or Edge.');
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
        // Skip empty turns, and skip obvious caller noise/junk as defense-in-depth (the live
        // handler already drops most). Never filter assistant turns.
        .filter((e) => e.text.trim().length > 0 && (e.role === 'assistant' || !looksLikeNoiseOrEmpty(e.text)))
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
      // Bound the request so a hung extraction can't leave the UI stuck on "Analyzing transcript…".
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 90_000);
      let res: Response;
      try {
        res = await fetch('/api/post-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_id: callId, business_id: businessId, transcript }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
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
      const msg =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Analysis timed out after 90 seconds'
          : err instanceof Error ? err.message : String(err);
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
    resetVoiceTimeline();
    setExtraction(null);
    setExtractionErrorMsg(null);
    postCallGenRef.current++; // invalidate any in-flight post-call response
    endReasonRef.current = 'unknown';
    resetResponseState(); // also resets end-of-call state + clears end timers
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }

  // ── Derived UI flags ─────────────────────────────────────────────────────

  const isLive = status === 'connected';
  const isConnecting = status === 'requesting' || status === 'connecting';
  const isBusy = status === 'stopping' || status === 'saving' || status === 'transcribing';
  const canSave = !!businessId && isSupabaseConfigured && !isDemo;

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
            warnText="Demo mode — sign in to place and save test calls"
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

              {/* Action buttons. In demo mode the server only mints sessions for the landing
                  demo or signed-in users, so show a sign-in prompt instead of a Start button. */}
              <div className="flex items-center gap-3 flex-wrap">
                {(status === 'idle' || status === 'error' || status === 'saved') && (
                  isDemo ? (
                    <div className="w-full bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 space-y-1.5">
                      <p className="text-sm font-medium text-amber-800">
                        Sign in to place a test call from the dashboard.
                      </p>
                      <p className="text-xs text-amber-700">
                        Or try the live call demo on the{' '}
                        <Link href="/#call-demo" className="font-semibold underline">home page</Link>{' '}
                        — no account needed.
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={status === 'saved' ? resetForNewCall : startCall}
                      className="fd-btn fd-btn-accent"
                    >
                      {status === 'saved' ? 'Start new call' : 'Start voice call'} →
                    </button>
                  )
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
                    onClick={() => requestEndCall('manual')}
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
                      className="max-w-[85%] sm:max-w-[80%] px-4 py-2.5 text-sm rounded"
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

          {/* ── Voice event timeline (Layer 1 observability · dev only) ───── */}
          {SHOW_TIMELINE && (
            <div className="fd-card overflow-hidden">
              <button
                onClick={() => setShowTimeline((s) => !s)}
                className="w-full px-5 py-4 flex items-center justify-between gap-3"
                style={{ borderBottom: showTimeline ? '1px solid var(--hairline)' : 'none' }}
              >
                <span className="fd-eyebrow" style={{ color: 'var(--ink)' }}>
                  Voice event timeline · dev
                </span>
                <span className="flex items-center gap-2">
                  <span className="fd-eyebrow fd-numeric" style={{ color: 'var(--ink-muted)' }}>
                    {voiceEvents.length} event{voiceEvents.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-gray-400">{showTimeline ? '▾' : '▸'}</span>
                </span>
              </button>
              {showTimeline && (
                <div className="p-3 max-h-[340px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                  {voiceEvents.length === 0 ? (
                    <p className="text-gray-400 px-2 py-6 text-center">
                      No events yet. Start a call to record the Realtime + app event timeline.
                    </p>
                  ) : (
                    <table className="w-full border-collapse">
                      <tbody>
                        {voiceEvents.map((ev) => (
                          <tr key={ev.seq} className="align-top">
                            <td className="pr-2 py-0.5 text-gray-400 fd-numeric whitespace-nowrap text-right">
                              {(ev.tMs / 1000).toFixed(2)}s
                            </td>
                            <td
                              className="pr-2 py-0.5 whitespace-nowrap font-semibold"
                              style={{ color: VOICE_CATEGORY_COLOR[voiceEventCategory(ev.type)] }}
                            >
                              {ev.type}
                            </td>
                            <td className="pr-2 py-0.5 text-gray-500">{ev.note}</td>
                            <td className="py-0.5 text-gray-300 whitespace-nowrap">
                              {[ev.role, shortId(ev.responseId), shortId(ev.itemId)].filter(Boolean).join(' ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="text-gray-300 px-2 pt-3 mt-2 text-[10px] leading-relaxed" style={{ borderTop: '1px solid var(--hairline)' }}>
                    Dev-only diagnostic. Watch for: <span style={{ color: VOICE_CATEGORY_COLOR.assistant }}>TEXT complete</span> firing
                    before <span style={{ color: VOICE_CATEGORY_COLOR.audio }}>audio playback FINISHED</span> (cut-off),
                    two <code>response.created</code> without a caller turn between (duplicate response),
                    or caller VAD <span style={{ color: VOICE_CATEGORY_COLOR.caller }}>speech detected</span> while the assistant is still speaking.
                  </p>
                </div>
              )}
            </div>
          )}

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

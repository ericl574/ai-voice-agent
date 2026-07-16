// FrontDesk Twilio ↔ OpenAI Realtime media bridge.
//
// Twilio Media Streams requires a DURABLE WebSocket server, which Vercel serverless cannot host —
// so this small standalone Node service runs separately from the Next app (locally + ngrok for
// testing, or any always-on Node host: Railway/Render/Fly). See docs/twilio-setup.md.
//
// Flow per call:
//   Twilio <Connect><Stream>  ──ws──►  this bridge  ──ws──►  OpenAI Realtime
//   1. Twilio connects and sends `start` (streamSid + custom parameters from /api/twilio/voice).
//   2. Bridge fetches the session config (instructions/voice) from the Next app
//      (/api/twilio/session-config, guarded by TWILIO_BRIDGE_SECRET) — prompt assembly stays in
//      the app's buildSystemPrompt, the single source of truth.
//   3. Bridge opens the OpenAI Realtime WS, configures G.711 μ-law in/out (Twilio's native
//      format — no transcoding), and relays audio both ways. Caller barge-in clears Twilio's
//      audio buffer. Transcript turns are collected from Realtime transcription events.
//   4. On hangup, the turns are POSTed to /api/twilio/post-call, which saves the call into the
//      normal dashboard flow and runs the same post-call extraction as browser calls.
//
// Run: npm run twilio:bridge        (reads .env.local if present)
// Env: OPENAI_API_KEY (required)    — never logged, never sent anywhere except api.openai.com
//      TWILIO_BRIDGE_SECRET (required) — shared secret for the two app endpoints
//      FD_APP_URL                   — the Next app origin (default http://localhost:3000)
//      BRIDGE_PORT                  — listen port (default 8787)
//      OPENAI_REALTIME_MODEL        — default gpt-realtime

import http from 'http';
import { pathToFileURL } from 'url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
// Shared turn-taking config — the SAME source the browser session uses, so phone and browser can't
// drift. Relative .ts import (resolved by `node --experimental-strip-types`, like the QA scripts).
import { REALTIME_VAD, REALTIME_NOISE_REDUCTION } from '../src/lib/realtime/turnDetection.ts';
// Same conservative, context-free goodbye/end-cue detector the browser path uses, so a "goodbye"
// is recognized identically on both paths. It is deliberately pure + self-contained (no imports),
// so it is safe to load into this standalone bridge runtime via a relative .ts import.
import { looksLikeEndCall } from '../src/lib/call-pipeline/endCall.ts';
// Shared, self-contained per-call quality metric — the app post-call route uses the SAME builder,
// so the logged metric and the alert decision can't drift between bridge and app.
import { buildCallQualityMetric } from '../src/lib/call-pipeline/callQuality.ts';
import { randomUUID } from 'crypto';

const PORT = Number(process.env.PORT ?? process.env.BRIDGE_PORT ?? 8787);
const APP_URL = (process.env.FD_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const BRIDGE_SECRET = process.env.TWILIO_BRIDGE_SECRET ?? '';
// Same per-turn transcription model the browser path uses (src/lib/call-pipeline/constants.ts).
const TRANSCRIPTION_MODEL = process.env.TWILIO_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe';

// ── Per-call safety caps ──────────────────────────────────────────────────────────────────────
// The phone path uses the server's auto-response (no Layer 2 orchestration), so these caps live in
// the bridge itself. All three end the call through the single idempotent finish().
//
// Hard ceiling on ONE call — a cost backstop above OpenAI's ~5-min session expiry, matched to the
// browser path's MAX_CALL_DURATION_MS so neither path can run a call forever.
export const MAX_CALL_DURATION_MS = 10 * 60_000;
// Close a call after this much CONTINUOUS silence (no caller speech and no assistant audio). Kept
// conservative so normal mid-call pauses are never cut off — it only catches a genuinely dead call.
export const IDLE_TIMEOUT_MS = 30_000;
// After a clear goodbye/end cue, let the closing line play out for this long, then hang up. A later
// non-cue caller turn cancels it (the caller kept talking), so it never ends a live conversation.
export const END_CUE_DRAIN_MS = 4_000;

// Fail-closed unavailable path (session-config returned 401/403). Once the one-line unavailable
// message finishes generating, let its audio flush to the caller for this long, then hang up. The
// hard cap bounds the whole path so a session that never signals 'done' can't hold the caller.
export const UNAVAILABLE_DRAIN_MS = 4_000;
export const UNAVAILABLE_MAX_MS = 12_000;

// Bounded single reconnect: if the OpenAI socket drops mid-call, try ONE re-open within this window;
// if it isn't ready again by then, end the call rather than leave the caller in dead air. Well under
// IDLE_TIMEOUT_MS so it resolves long before the idle watchdog would otherwise fire.
export const OPENAI_RECONNECT_MAX_MS = 5_000;

export type OpenAIDropAction = 'ignore' | 'reconnect' | 'end';

// Decide what to do when the OpenAI socket closes. Pure so the decision is unit-tested; the socket
// wiring lives in the bridge. 'ignore' = an expected teardown during finish(); 'reconnect' = the
// first unexpected drop while we still have the session config (context is LOST on the new session —
// graceful degrade, not a seamless resume); 'end' = give up (already retried once, or no config) and
// stop promptly — never leave the caller in dead air.
export function decideOpenAIDropAction(state: {
  closed: boolean;
  reconnectAttempted: boolean;
  haveConfig: boolean;
}): OpenAIDropAction {
  if (state.closed) return 'ignore';
  if (!state.reconnectAttempted && state.haveConfig) return 'reconnect';
  return 'end';
}

const bridgeStartedAt = Date.now();
const bridgeMetrics = {
  activeStreams: 0,
  callsHandled: 0,
};

export interface BridgeHealth {
  status: 'ok';
  timestamp: string;
  uptimeSec: number;
  activeStreams: number;
  callsHandled: number;
  version?: string;
  commit?: string;
}

function shortCommit(raw: string | undefined): string | undefined {
  const safe = (raw ?? '').trim().match(/^[a-fA-F0-9]{7,40}$/)?.[0];
  return safe ? safe.slice(0, 12) : undefined;
}

export function buildBridgeHealth(now = new Date()): BridgeHealth {
  return {
    status: 'ok',
    timestamp: now.toISOString(),
    uptimeSec: Math.max(0, Math.round((now.getTime() - bridgeStartedAt) / 1000)),
    activeStreams: bridgeMetrics.activeStreams,
    callsHandled: bridgeMetrics.callsHandled,
    ...(process.env.npm_package_version ? { version: process.env.npm_package_version } : {}),
    ...(shortCommit(process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA) ? { commit: shortCommit(process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA) } : {}),
  };
}

interface Turn {
  role: 'assistant' | 'caller';
  text: string;
}

interface SessionConfig {
  instructions: string;
  voice: string | null;
  speed: number;
  businessId: string | null;
  businessName: string;
}

// Generic prompt used ONLY when the app's /api/twilio/session-config fails for a TRANSIENT reason (a
// network blip or a 5xx) — NOT for an auth rejection (see fetchSessionConfig: 401/403 fails closed).
// The business identity/KB are absent, but the caller still gets a coherent, HONEST front desk that
// MUST pin the language to English: the phone greeting is a bare response.create driven entirely by
// the session instructions (see the greeting comment below), so a fallback prompt with no language
// rule let the model freelance the first turn in a random language (it greeted a caller in
// Vietnamese). Mirror globalRules.ts's LANGUAGE rule here so a transient failure degrades to a
// generic ENGLISH front desk, never a random-language one. It never invents business specifics, and
// "staff will confirm any appointment" frames every appointment as NOT-yet-confirmed (never claims a
// confirmed booking) — the honesty framing used product-wide.
export const FALLBACK_INSTRUCTIONS =
  'You are FrontDesk, the automated phone front desk for a local service business. ' +
  'Always open and reply in English. Only switch to another language if the caller clearly asks for ' +
  'it or speaks several full sentences in that language; a single foreign word or greeting is never ' +
  'enough to switch. ' +
  'Greet the caller, answer briefly and warmly, capture what they need (name, request, preferred ' +
  'time), and make clear staff will confirm any appointment. Never claim to be human.';

// Locked prompt for the FAIL-CLOSED path (session-config returned 401/403 → the bridge secret is
// rejected → post-call persistence is GUARANTEED to fail). We must NOT run a normal front desk:
// anything the caller says would be lost. The model only speaks this one English line; caller audio
// is never forwarded to it and the call ends right after (see playUnavailableThenClose), so the
// "collect nothing / promise nothing / save nothing" guarantee is STRUCTURAL, not prompt-dependent.
export const UNAVAILABLE_INSTRUCTIONS =
  'You are an automated phone line that is temporarily unavailable. Say EXACTLY this one sentence, ' +
  'in English, and nothing else: "I\'m sorry, our front desk is temporarily unavailable. Please ' +
  'call again shortly." Do not greet, do not ask anything, do not collect any information, do not ' +
  'offer to help, and do not mention staff, messages, callbacks, or follow-up. After that one ' +
  'sentence, stop talking. Never claim to be human.';

export type SessionConfigDisposition = 'ok' | 'auth-rejected' | 'unresolved' | 'transient-fallback';

// Pure: map a session-config HTTP status to what the bridge does with it.
//   2xx     → use the returned config.
//   401/403 → FAIL CLOSED as an auth rejection (the shared secret is rejected, so post-call
//             persistence is guaranteed to fail too — never run a front desk it can't save).
//   422     → FAIL CLOSED as an unresolved business (the app has a REAL businessId but could not load
//             its config; it must never answer as the demo business for a real call — Scope B).
//   other   → safe English fallback (a transient server error may recover).
// Kept pure so the fail-closed decisions are unit-tested without a socket/HTTP harness.
export function sessionConfigDisposition(status: number): SessionConfigDisposition {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 422) return 'unresolved';
  return 'transient-fallback';
}

// Outcome of loading the phone session config. A 'fail-closed' outcome (an auth rejection OR an
// unresolved real business) routes to the unavailable message; every other case (real business OR a
// transient-failure fallback) is 'loaded'.
type SessionConfigOutcome =
  | { kind: 'loaded'; config: SessionConfig; usedFallback: boolean }
  | { kind: 'fail-closed'; reason: 'auth-rejected' | 'unresolved' };

async function fetchSessionConfig(businessId: string, from: string, callSid: string): Promise<SessionConfigOutcome> {
  try {
    const res = await fetch(`${APP_URL}/api/twilio/session-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': BRIDGE_SECRET },
      body: JSON.stringify({
        businessId: businessId || undefined,
        from: from || undefined,
        callSid: callSid || undefined,
      }),
    });
    if (res.ok) {
      return { kind: 'loaded', config: (await res.json()) as SessionConfig, usedFallback: false };
    }
    const disposition = sessionConfigDisposition(res.status);
    if (disposition === 'auth-rejected') {
      // Auth rejected → the bridge's x-bridge-secret does not match the app's TWILIO_BRIDGE_SECRET.
      // This exact mismatch caused the 2026-07-16 incident. Because the SAME secret guards post-call,
      // persistence is guaranteed to fail too — so we FAIL CLOSED (unavailable message, no normal
      // front desk) rather than collect caller details that can never be saved. Keep this loud, named
      // log so the next occurrence is diagnosable at a glance instead of by log forensics.
      console.error(
        `[bridge] session-config AUTH REJECTED (${res.status}) — TWILIO_BRIDGE_SECRET mismatch ` +
          `between the bridge and the app (${APP_URL}). Reconcile the secret on BOTH deployments. ` +
          `Failing this call CLOSED (unavailable message, nothing collected or saved).`,
      );
      return { kind: 'fail-closed', reason: 'auth-rejected' };
    }
    if (disposition === 'unresolved') {
      // The app has a REAL businessId but could not load its config (business not found, DB error,
      // server misconfig, or malformed data). Answering as the demo business would give a real caller
      // the wrong business, so FAIL CLOSED with the unavailable message instead (Scope B). No secret
      // mismatch here — do NOT emit the auth diagnostic.
      console.error(
        `[bridge] session-config UNRESOLVED (${res.status}) — the app could not load config for ` +
          `businessId=${businessId || '(none)'} callSid=${callSid || '(none)'}. Failing this call ` +
          `CLOSED (unavailable message, nothing collected or saved).`,
      );
      return { kind: 'fail-closed', reason: 'unresolved' };
    }
    // Transient server error (5xx or other non-auth status) — safe to run the generic English fallback.
    console.warn(`[bridge] session-config failed (${res.status}) — using safe English fallback (transient)`);
  } catch (err) {
    // Network/unreachable — also transient; the safe English fallback keeps the line answering.
    console.warn('[bridge] session-config unreachable — using safe English fallback:', (err as Error).message);
  }
  return {
    kind: 'loaded',
    config: { instructions: FALLBACK_INSTRUCTIONS, voice: null, speed: 1.0, businessId: null, businessName: 'the business' },
    usedFallback: true,
  };
}

async function postCall(payload: {
  businessId: string | null;
  fromNumber: string | null;
  callSid: string | null;
  startedAt: string;
  endedAt: string;
  turns: Turn[];
  endReason: string;
  usedFallbackInstructions: boolean;
}): Promise<void> {
  try {
    const res = await fetch(`${APP_URL}/api/twilio/post-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': BRIDGE_SECRET },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[bridge] post-call → ${res.status}`, JSON.stringify(data));
  } catch (err) {
    console.error('[bridge] post-call failed:', (err as Error).message);
  }
}

// One bridged call: Twilio leg + OpenAI leg.
function handleTwilioConnection(twilioWs: WebSocket): void {
  // Short per-call trace id so every log line for one call is correlatable — even before the Twilio
  // streamSid arrives. Contains no caller data and no secrets.
  const traceId = randomUUID().slice(0, 8);
  let streamSid = '';
  let businessId = '';
  let fromNumber = '';
  // Twilio Call SID (from the <Parameter> our /api/twilio/voice emits). Lets an operator holding a
  // CallSid from the Twilio console jump straight to this call's bridge logs, and vice-versa. Not
  // caller PII — it is Twilio's opaque call identifier.
  let callSid = '';
  let started = new Date();
  let openaiWs: WebSocket | null = null;
  let openaiReady = false;
  let closed = false;
  let countedCall = false;
  let triedLegacyFormat = false;
  let loggedFirstAssistantAudio = false;
  let loggedFirstCallerTranscript = false;
  // True when session-config could not be fetched and the call ran on generic FALLBACK_INSTRUCTIONS
  // (no business identity/KB). Reported in the per-call quality metric so the app can page ops.
  let usedFallback = false;
  // Reconnect state — one bounded OpenAI reconnect per call on an unexpected drop (see
  // handleOpenAIDrop). sessionCfg is stored so the reconnect can reuse the same prompt/voice.
  let sessionCfg: SessionConfig | null = null;
  let greeted = false; // suppress a re-greeting after a mid-call reconnect
  let openaiReconnectAttempted = false;
  let openaiReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const turns: Turn[] = [];
  // Caller audio arriving before OpenAI is ready is buffered (≈20ms/frame; cap ≈10s).
  const pendingAudio: string[] = [];
  const MAX_PENDING = 500;

  // ── Per-call safety timers (all cleared exactly once in finish via clearAllTimers) ──
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let endCueTimer: ReturnType<typeof setTimeout> | null = null;

  const log = (msg: string) =>
    console.log(
      `[bridge ${traceId}${streamSid ? '/' + streamSid.slice(-6) : ''}${callSid ? ' ' + callSid : ''}] ${msg}`,
    );

  function clearAllTimers(): void {
    if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (endCueTimer) { clearTimeout(endCueTimer); endCueTimer = null; }
    if (openaiReconnectTimer) { clearTimeout(openaiReconnectTimer); openaiReconnectTimer = null; }
  }

  // Cost backstop — armed once when the media stream starts.
  function armMaxDuration(): void {
    if (maxDurationTimer) return;
    maxDurationTimer = setTimeout(() => {
      log(`max-duration reached (${Math.round(MAX_CALL_DURATION_MS / 1000)}s) — ending to cap cost`);
      void finish('max-duration');
    }, MAX_CALL_DURATION_MS);
  }

  // (Re)arm the idle timer on any meaningful caller/assistant activity. A genuinely dead call (no
  // audio either way for IDLE_TIMEOUT_MS) is closed cleanly; normal pauses just keep resetting it.
  function resetIdle(): void {
    if (closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      log(`idle-timeout — no caller/assistant activity for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s`);
      void finish('idle-timeout');
    }, IDLE_TIMEOUT_MS);
  }

  // A clear goodbye/end cue starts a short drain, then hangs up. Idempotent: only the first cue arms.
  function armEndCue(by: 'caller' | 'assistant'): void {
    if (closed || endCueTimer) return;
    log(`end-cue detected (${by}) — draining ${Math.round(END_CUE_DRAIN_MS / 1000)}s then closing`);
    endCueTimer = setTimeout(() => void finish('end-cue'), END_CUE_DRAIN_MS);
  }

  // The caller kept talking after a goodbye — cancel the pending hangup so a live call is never cut.
  function cancelEndCue(reason: string): void {
    if (endCueTimer) {
      clearTimeout(endCueTimer);
      endCueTimer = null;
      log(`end-cue canceled (${reason})`);
    }
  }

  function sendToOpenAI(obj: Record<string, unknown>): void {
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify(obj));
    }
  }
  function sendToTwilio(obj: Record<string, unknown>): void {
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(JSON.stringify(obj));
    }
  }

  // GA session shape (audio/pcmu). On an API error we retry once with the legacy beta shape
  // (g711_ulaw flat fields) so the bridge works across Realtime API versions.
  function sessionUpdate(cfg: SessionConfig, legacy: boolean): void {
    if (legacy) {
      sendToOpenAI({
        type: 'session.update',
        session: {
          instructions: cfg.instructions,
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          // Same tuned VAD as the GA shape (shared REALTIME_VAD), so the fallback isn't a silent
          // quality regression. `interrupt_response` is intentionally omitted here — the legacy beta
          // shape may not support it. This fallback only fires if the GA session.update above errors,
          // which does not happen on the current `gpt-realtime` model.
          turn_detection: {
            type: 'server_vad',
            threshold: REALTIME_VAD.threshold,
            prefix_padding_ms: REALTIME_VAD.prefix_padding_ms,
            silence_duration_ms: REALTIME_VAD.silence_duration_ms,
          },
          input_audio_transcription: { model: TRANSCRIPTION_MODEL },
          ...(cfg.voice ? { voice: cfg.voice } : {}),
        },
      });
    } else {
      sendToOpenAI({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: cfg.instructions,
          audio: {
            input: {
              format: { type: 'audio/pcmu' },
              // Shared turn-taking config — IDENTICAL to the browser (src/lib/realtime/turnDetection):
              // tuned VAD + interrupt_response:false, so the assistant finishes its turn instead of
              // being talked over / truncated. create_response stays at the server default
              // (auto-response) for the phone path; app-controlled responses are Phase 2.
              turn_detection: { ...REALTIME_VAD },
              noise_reduction: REALTIME_NOISE_REDUCTION,
              transcription: { model: TRANSCRIPTION_MODEL },
            },
            output: {
              format: { type: 'audio/pcmu' },
              speed: cfg.speed,
              ...(cfg.voice ? { voice: cfg.voice } : {}),
            },
          },
        },
      });
    }
  }

  function connectOpenAI(cfg: SessionConfig): void {
    // Capture THIS socket. After a reconnect, openaiWs points at the new socket; the old socket's
    // late events (including its 'close') are then ignored via the `ws !== openaiWs` guard, so a
    // stale close can never end the call or double-trigger reconnect.
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });
    openaiWs = ws;

    ws.on('open', () => {
      if (ws !== openaiWs) return;
      log('openai connected — configuring session');
      sessionUpdate(cfg, false);
    });

    ws.on('message', (raw: RawData) => {
      if (ws !== openaiWs) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = event.type as string;

      switch (type) {
        case 'session.updated': {
          if (!openaiReady) {
            openaiReady = true;
            resetIdle(); // start/refresh the idle clock now that the session is live
            // A reconnect succeeded — cancel the pending "reconnect failed → end" watchdog.
            if (openaiReconnectTimer) { clearTimeout(openaiReconnectTimer); openaiReconnectTimer = null; }
            if (!greeted) {
              greeted = true;
              // Greet FIRST, then listen. Any audio buffered before the session was ready (an early
              // "hello", line noise) is DISCARDED — previously it was flushed here, which let the
              // caller's pre-greeting audio trigger a competing response / barge-in clear that
              // truncated the greeting ("…thank you for calling the front"). The caller's real first
              // turn starts cleanly after the greeting finishes.
              const discarded = pendingAudio.length;
              pendingAudio.length = 0;
              log(`session ready (discarded ${discarded} pre-greeting frames) — greeting caller`);
              // Bare response.create — NO per-response `instructions`. In the Realtime API,
              // `response.instructions` REPLACES the session instructions for that one turn, which
              // stripped the GREETING text, the business name, and the "always open in English" rule —
              // so the model freelanced the first turn in a random language (it greeted in Vietnamese).
              // The browser path greets with a bare response.create and stays in English; match it. The
              // session prompt (buildSystemPrompt GREETING + LANGUAGE rules) drives the greeting.
              sendToOpenAI({ type: 'response.create' });
            } else {
              // Re-established after a mid-call drop — do NOT re-greet; resume listening. The new
              // session has no memory of earlier turns (graceful degrade, not a seamless resume).
              pendingAudio.length = 0; // stale frames from the gap aren't useful
              log('openai session re-established after a drop — resuming without re-greeting');
            }
          }
          break;
        }
        case 'error': {
          const err = event.error as { message?: string; param?: string } | undefined;
          log(`openai error: ${err?.message ?? 'unknown'}`);
          // Unknown-parameter style errors on our session.update → retry once with legacy shape.
          if (!openaiReady && !triedLegacyFormat) {
            triedLegacyFormat = true;
            log('retrying session.update with legacy audio format fields');
            sessionUpdate(cfg, true);
          }
          break;
        }
        // Assistant audio out (GA + legacy event names) — base64 μ-law passthrough to Twilio.
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          const payload = (event.delta as string) ?? '';
          if (payload && streamSid) {
            if (!loggedFirstAssistantAudio) {
              loggedFirstAssistantAudio = true;
              log('first assistant audio → caller');
            }
            sendToTwilio({ event: 'media', streamSid, media: { payload } });
            resetIdle(); // assistant is actively speaking — keep the call alive
          }
          break;
        }
        // Caller started speaking — an activity signal only (no barge-in clear; that is handled by
        // interrupt_response:false in the shared VAD). Used to keep the idle timer from firing.
        case 'input_audio_buffer.speech_started': {
          resetIdle();
          break;
        }
        // No barge-in: with interrupt_response:false (REALTIME_VAD) the assistant finishes its reply
        // and the caller's turn is handled after — matching the browser. We deliberately no longer
        // clear Twilio's queued audio on speech_started; that manual clear previously truncated the
        // assistant (and the greeting) whenever the caller made any early sound.
        // Transcript turns (same roles the dashboard uses).
        case 'conversation.item.input_audio_transcription.completed': {
          const text = ((event.transcript as string) ?? '').trim();
          if (text) {
            if (!loggedFirstCallerTranscript) {
              loggedFirstCallerTranscript = true;
              log('first caller transcript captured');
            }
            turns.push({ role: 'caller', text });
            resetIdle();
            // Deterministic goodbye shutdown (same conservative, context-free helper as the browser
            // path). A clear end cue arms the drain; any other caller turn cancels a pending one so
            // a caller who keeps talking is never cut off.
            if (looksLikeEndCall(text)) armEndCue('caller');
            else cancelEndCue('caller continued');
          }
          break;
        }
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done': {
          const text = ((event.transcript as string) ?? '').trim();
          if (text) {
            turns.push({ role: 'assistant', text });
            // If the assistant itself delivered a clear goodbye, the call is wrapping up — drain the
            // closing line, then close. A subsequent caller turn still cancels it (handled above).
            if (looksLikeEndCall(text)) armEndCue('assistant');
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (ws !== openaiWs) return; // a replaced/stale socket closing — ignore
      log('openai closed');
      openaiReady = false;
      handleOpenAIDrop('close');
    });
    ws.on('error', (err: Error) => {
      if (ws !== openaiWs) return;
      // 'error' is followed by 'close', which drives reconnect/end — don't double-handle here.
      log(`openai ws error: ${err.message}`);
    });
  }

  // One bounded reconnect on an UNEXPECTED OpenAI drop, else end promptly — never leave the caller in
  // dead air (previously an OpenAI close left silence until the 30s idle timeout). Context is LOST on
  // the new session, so this is graceful degrade (no re-greet, no memory of earlier turns), not resume.
  function handleOpenAIDrop(why: string): void {
    const action = decideOpenAIDropAction({
      closed,
      reconnectAttempted: openaiReconnectAttempted,
      haveConfig: sessionCfg !== null,
    });
    if (action === 'ignore') return; // expected teardown during finish()
    if (action === 'reconnect') {
      openaiReconnectAttempted = true;
      log(`openai dropped (${why}) — attempting one reconnect (context will reset)`);
      if (openaiReconnectTimer) clearTimeout(openaiReconnectTimer);
      openaiReconnectTimer = setTimeout(() => {
        openaiReconnectTimer = null;
        if (!closed && !openaiReady) {
          log('openai reconnect did not become ready in time — ending call');
          void finish('openai-reconnect-failed');
        }
      }, OPENAI_RECONNECT_MAX_MS);
      try {
        connectOpenAI(sessionCfg as SessionConfig);
      } catch (err) {
        log(`openai reconnect failed to start: ${(err as Error).message} — ending call`);
        void finish('openai-closed');
      }
      return;
    }
    log(`openai dropped (${why}) and no reconnect available — ending call`);
    void finish('openai-closed');
  }

  // FAIL-CLOSED unavailable path (session-config returned 401/403). Speak ONE short English line and
  // hang up — never a normal front desk. Safety is STRUCTURAL: this uses a throwaway OpenAI session
  // whose only job is to read UNAVAILABLE_INSTRUCTIONS; caller audio is NEVER forwarded to it
  // (openaiReady stays false, so the Twilio 'media' handler only buffers), NO transcript turns are
  // captured, and finish() runs with turns=[] so post-call is skipped (nothing collected, nothing
  // saved, no follow-up implied) — regardless of what the model actually says.
  function playUnavailableThenClose(): void {
    let drainArmed = false;
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });
    openaiWs = ws;

    // Hard cap: end the call even if the session never opens or never signals 'done'.
    const capTimer = setTimeout(() => {
      if (!closed) { log('unavailable message cap reached — closing'); void finish('service-unavailable'); }
    }, UNAVAILABLE_MAX_MS);

    // Let the closing audio flush to the caller, then hang up. finish() clears every call timer; this
    // local drain/cap pair is cleared here so a late socket event can't re-close a finished call.
    const endAfterDrain = () => {
      if (drainArmed || closed) return;
      drainArmed = true;
      setTimeout(() => { clearTimeout(capTimer); void finish('service-unavailable'); }, UNAVAILABLE_DRAIN_MS);
    };

    ws.on('open', () => {
      if (ws !== openaiWs) return;
      log('unavailable session — configuring locked one-line prompt');
      // Reuse the SAME μ-law session shape as a normal call, but with the locked unavailable prompt.
      sessionUpdate(
        { instructions: UNAVAILABLE_INSTRUCTIONS, voice: null, speed: 1.0, businessId: null, businessName: 'the business' },
        false,
      );
    });

    ws.on('message', (raw: RawData) => {
      if (ws !== openaiWs) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      switch (event.type as string) {
        case 'session.updated':
          // Bare response.create → the single line is driven entirely by UNAVAILABLE_INSTRUCTIONS.
          sendToOpenAI({ type: 'response.create' });
          break;
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          const payload = (event.delta as string) ?? '';
          if (payload && streamSid) sendToTwilio({ event: 'media', streamSid, media: { payload } });
          break;
        }
        // The one response finished generating — drain its audio, then close.
        case 'response.output_audio.done':
        case 'response.audio.done':
        case 'response.done':
          endAfterDrain();
          break;
        case 'error':
          log(`unavailable session openai error: ${(event.error as { message?: string })?.message ?? 'unknown'} — closing`);
          clearTimeout(capTimer);
          void finish('service-unavailable');
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (ws !== openaiWs) return;
      clearTimeout(capTimer);
      if (!closed) { log('unavailable session closed — ending call'); void finish('service-unavailable'); }
    });
    ws.on('error', (err: Error) => {
      if (ws !== openaiWs) return;
      log(`unavailable session ws error: ${err.message}`);
    });
  }

  async function finish(reason: string): Promise<void> {
    // Idempotent: a call can end from Twilio stop, OpenAI close, max-duration, idle-timeout,
    // end-cue, or a socket error — but only the FIRST caller gets past here, so exactly one
    // post-call save runs and the timers are cleared exactly once.
    if (closed) return;
    closed = true;
    clearAllTimers();
    bridgeMetrics.activeStreams = Math.max(0, bridgeMetrics.activeStreams - 1);
    const durationSec = Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
    log(`call ended (${reason}) — duration ${durationSec}s, ${turns.length} transcript turns`);
    // Per-call quality metric (log-based observability; the app also alerts on shouldAlert). Same
    // pure builder the app uses, so bridge logs and app alerts agree.
    const metric = buildCallQualityMetric({
      endReason: reason,
      callerTurns: turns.filter((t) => t.role === 'caller').length,
      assistantTurns: turns.filter((t) => t.role === 'assistant').length,
      usedFallbackInstructions: usedFallback,
      durationSec,
    });
    log(`call-quality ${JSON.stringify(metric)}`);
    try {
      openaiWs?.close();
    } catch {
      /* already closed */
    }
    if (turns.length > 0) {
      log('posting call for save + extraction…');
      await postCall({
        businessId: businessId || null,
        fromNumber: fromNumber || null,
        callSid: callSid || null,
        startedAt: started.toISOString(),
        endedAt: new Date().toISOString(),
        turns,
        endReason: reason,
        usedFallbackInstructions: usedFallback,
      });
    } else {
      log('no transcript turns captured — skipping post-call (nothing to save)');
    }
    try {
      twilioWs.close();
    } catch {
      /* already closed */
    }
  }

  twilioWs.on('message', (raw: RawData) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event as string) {
      case 'start': {
        const start = msg.start as {
          streamSid?: string;
          customParameters?: Record<string, string>;
        };
        streamSid = start.streamSid ?? (msg.streamSid as string) ?? '';
        businessId = start.customParameters?.businessId ?? '';
        fromNumber = start.customParameters?.from ?? '';
        callSid = start.customParameters?.callSid ?? '';
        started = new Date();
        if (!countedCall) {
          countedCall = true;
          bridgeMetrics.callsHandled += 1;
        }
        log(`stream started (business: ${businessId || 'demo fallback'}, callSid: ${callSid || '(none)'})`);
        armMaxDuration(); // cost backstop from the moment the call is live
        void fetchSessionConfig(businessId, fromNumber, callSid).then((outcome) => {
          if (closed) return;
          // FAIL CLOSED without starting the normal greeting/collection flow when either: the bridge
          // secret is rejected (auth-rejected → post-call also 401s, nothing could be saved), OR the
          // app has a real businessId it could not load (unresolved → must never answer as the demo
          // business for a real call). Speak one short English unavailable line and end cleanly;
          // nothing is collected or saved.
          if (outcome.kind === 'fail-closed') {
            log(`failing closed (${outcome.reason}) — unavailable message only, no greeting/collection/save`);
            playUnavailableThenClose();
            return;
          }
          const cfg = outcome.config;
          // A transient session-config failure runs on generic FALLBACK_INSTRUCTIONS — the business
          // identity / knowledge base did NOT load. That is a silent quality failure, so make it LOUD
          // (fetchSessionConfig also warns on the underlying fetch error).
          if (outcome.usedFallback) {
            usedFallback = true;
            log(
              `⚠️  USING FALLBACK INSTRUCTIONS — business identity/KB NOT loaded (session-config ` +
                `fetch failed, transient). Caller hears a GENERIC English front desk. businessId=${businessId || '(none)'}`,
            );
          } else {
            log(`session-config loaded (business: ${cfg.businessName})`);
          }
          sessionCfg = cfg; // stored so a mid-call reconnect can reuse the same prompt/voice
          connectOpenAI(cfg);
        });
        break;
      }
      case 'media': {
        const payload = (msg.media as { payload?: string })?.payload;
        if (!payload) break;
        if (openaiReady) {
          sendToOpenAI({ type: 'input_audio_buffer.append', audio: payload });
        } else {
          pendingAudio.push(payload);
          if (pendingAudio.length > MAX_PENDING) pendingAudio.shift();
        }
        break;
      }
      case 'stop': {
        void finish('twilio stop');
        break;
      }
      default:
        break;
    }
  });

  twilioWs.on('close', () => void finish('twilio ws closed'));
  twilioWs.on('error', (err: Error) => {
    log(`twilio ws error: ${err.message}`);
    void finish('twilio ws error');
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

export function startBridge(): http.Server {
  if (!OPENAI_KEY) {
    console.error('[bridge] OPENAI_API_KEY is required. Start with: npm run twilio:bridge (env from .env.local)');
    process.exit(1);
  }
  if (!BRIDGE_SECRET) {
    console.error('[bridge] TWILIO_BRIDGE_SECRET is required (same value as the Next app env).');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://bridge.local').pathname;
    if (pathname === '/' || pathname === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(buildBridgeHealth()));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/twilio-stream' });
  wss.on('connection', (ws) => {
    bridgeMetrics.activeStreams += 1;
    console.log('[bridge] twilio stream connected');
    handleTwilioConnection(ws);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[bridge] listening on 0.0.0.0:${PORT} (ws path /twilio-stream) -> app: ${APP_URL}, model: ${MODEL}`);
  });

  return server;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  startBridge();
}

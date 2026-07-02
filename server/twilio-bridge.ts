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

const FALLBACK_INSTRUCTIONS =
  'You are FrontDesk, the automated phone front desk for a local service business. Greet the caller, ' +
  'answer briefly and warmly, capture what they need (name, request, preferred time), and make clear ' +
  'staff will confirm any appointment. Never claim to be human.';

async function fetchSessionConfig(businessId: string, from: string): Promise<SessionConfig> {
  try {
    const res = await fetch(`${APP_URL}/api/twilio/session-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': BRIDGE_SECRET },
      body: JSON.stringify({ businessId: businessId || undefined, from: from || undefined }),
    });
    if (res.ok) return (await res.json()) as SessionConfig;
    console.warn(`[bridge] session-config failed (${res.status}) — using fallback instructions`);
  } catch (err) {
    console.warn('[bridge] session-config unreachable — using fallback instructions:', (err as Error).message);
  }
  return { instructions: FALLBACK_INSTRUCTIONS, voice: null, speed: 1.0, businessId: null, businessName: 'the business' };
}

async function postCall(payload: {
  businessId: string | null;
  fromNumber: string | null;
  startedAt: string;
  endedAt: string;
  turns: Turn[];
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
  let started = new Date();
  let openaiWs: WebSocket | null = null;
  let openaiReady = false;
  let closed = false;
  let countedCall = false;
  let triedLegacyFormat = false;
  let loggedFirstAssistantAudio = false;
  let loggedFirstCallerTranscript = false;
  const turns: Turn[] = [];
  // Caller audio arriving before OpenAI is ready is buffered (≈20ms/frame; cap ≈10s).
  const pendingAudio: string[] = [];
  const MAX_PENDING = 500;

  // ── Per-call safety timers (all cleared exactly once in finish via clearAllTimers) ──
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let endCueTimer: ReturnType<typeof setTimeout> | null = null;

  const log = (msg: string) =>
    console.log(`[bridge ${traceId}${streamSid ? '/' + streamSid.slice(-6) : ''}] ${msg}`);

  function clearAllTimers(): void {
    if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (endCueTimer) { clearTimeout(endCueTimer); endCueTimer = null; }
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
    openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });

    openaiWs.on('open', () => {
      log('openai connected — configuring session');
      sessionUpdate(cfg, false);
    });

    openaiWs.on('message', (raw: RawData) => {
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
            // Greet FIRST, then listen. Any audio buffered before the session was ready (an early
            // "hello", line noise) is DISCARDED — previously it was flushed here, which let the
            // caller's pre-greeting audio trigger a competing response / barge-in clear that
            // truncated the greeting ("…thank you for calling the front"). The caller's real first
            // turn starts cleanly after the greeting finishes.
            const discarded = pendingAudio.length;
            pendingAudio.length = 0;
            log(`session ready (discarded ${discarded} pre-greeting frames) — greeting caller`);
            resetIdle(); // start the idle clock now that the call is conversational
            // Bare response.create — NO per-response `instructions`. In the Realtime API,
            // `response.instructions` REPLACES the session instructions for that one turn, which
            // stripped the GREETING text, the business name, and the "always open in English" rule —
            // so the model freelanced the first turn in a random language (it greeted in Vietnamese).
            // The browser path greets with a bare response.create and stays in English; match it. The
            // session prompt (buildSystemPrompt GREETING + LANGUAGE rules) drives the greeting.
            sendToOpenAI({ type: 'response.create' });
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

    openaiWs.on('close', () => {
      log('openai closed');
      openaiReady = false;
    });
    openaiWs.on('error', (err: Error) => log(`openai ws error: ${err.message}`));
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
        startedAt: started.toISOString(),
        endedAt: new Date().toISOString(),
        turns,
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
        started = new Date();
        if (!countedCall) {
          countedCall = true;
          bridgeMetrics.callsHandled += 1;
        }
        log(`stream started (business: ${businessId || 'demo fallback'})`);
        armMaxDuration(); // cost backstop from the moment the call is live
        void fetchSessionConfig(businessId, fromNumber).then((cfg) => {
          if (closed) return;
          // A session-config failure means the call runs on generic FALLBACK_INSTRUCTIONS — the
          // business identity / knowledge base did NOT load. That is a silent quality failure, so
          // make it LOUD here (fetchSessionConfig also warns on the underlying fetch error).
          if (cfg.instructions === FALLBACK_INSTRUCTIONS) {
            log(
              `⚠️  USING FALLBACK INSTRUCTIONS — business identity/KB NOT loaded (session-config ` +
                `fetch failed). Caller hears a GENERIC front desk. businessId=${businessId || '(none)'}`,
            );
          } else {
            log(`session-config loaded (business: ${cfg.businessName})`);
          }
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

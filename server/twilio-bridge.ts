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
import { WebSocketServer, WebSocket, type RawData } from 'ws';

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const APP_URL = (process.env.FD_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const BRIDGE_SECRET = process.env.TWILIO_BRIDGE_SECRET ?? '';
// Same per-turn transcription model the browser path uses (src/lib/call-pipeline/constants.ts).
const TRANSCRIPTION_MODEL = process.env.TWILIO_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe';

if (!OPENAI_KEY) {
  console.error('[bridge] OPENAI_API_KEY is required. Start with: npm run twilio:bridge (env from .env.local)');
  process.exit(1);
}
if (!BRIDGE_SECRET) {
  console.error('[bridge] TWILIO_BRIDGE_SECRET is required (same value as the Next app env).');
  process.exit(1);
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
  let streamSid = '';
  let businessId = '';
  let fromNumber = '';
  let started = new Date();
  let openaiWs: WebSocket | null = null;
  let openaiReady = false;
  let closed = false;
  let triedLegacyFormat = false;
  const turns: Turn[] = [];
  // Caller audio arriving before OpenAI is ready is buffered (≈20ms/frame; cap ≈10s).
  const pendingAudio: string[] = [];
  const MAX_PENDING = 500;

  const log = (msg: string) => console.log(`[bridge${streamSid ? ' ' + streamSid.slice(-6) : ''}] ${msg}`);

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
          turn_detection: { type: 'server_vad' },
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
              // Phone path uses the server's default VAD + auto-response (no browser Layer-2
              // orchestration here). The dashboard's tuned VAD settings are NOT touched.
              turn_detection: { type: 'server_vad' },
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
            log(`session ready (${pendingAudio.length} buffered frames) — greeting caller`);
            for (const payload of pendingAudio.splice(0)) {
              sendToOpenAI({ type: 'input_audio_buffer.append', audio: payload });
            }
            sendToOpenAI({
              type: 'response.create',
              response: { instructions: 'Greet the caller now as the front desk for this business.' },
            });
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
            sendToTwilio({ event: 'media', streamSid, media: { payload } });
          }
          break;
        }
        // Caller barge-in: flush Twilio's queued assistant audio so the caller isn't talked over.
        case 'input_audio_buffer.speech_started': {
          if (streamSid) sendToTwilio({ event: 'clear', streamSid });
          break;
        }
        // Transcript turns (same roles the dashboard uses).
        case 'conversation.item.input_audio_transcription.completed': {
          const text = ((event.transcript as string) ?? '').trim();
          if (text) turns.push({ role: 'caller', text });
          break;
        }
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done': {
          const text = ((event.transcript as string) ?? '').trim();
          if (text) turns.push({ role: 'assistant', text });
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
    if (closed) return;
    closed = true;
    log(`call ended (${reason}) — ${turns.length} transcript turns`);
    try {
      openaiWs?.close();
    } catch {
      /* already closed */
    }
    if (turns.length > 0) {
      await postCall({
        businessId: businessId || null,
        fromNumber: fromNumber || null,
        startedAt: started.toISOString(),
        endedAt: new Date().toISOString(),
        turns,
      });
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
        log(`stream started (business: ${businessId || 'demo fallback'})`);
        void fetchSessionConfig(businessId, fromNumber).then((cfg) => {
          if (!closed) connectOpenAI(cfg);
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

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('FrontDesk Twilio bridge running\n');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/twilio-stream' });
wss.on('connection', (ws) => {
  console.log('[bridge] twilio stream connected');
  handleTwilioConnection(ws);
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT} (ws path /twilio-stream) → app: ${APP_URL}, model: ${MODEL}`);
});

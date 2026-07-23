'use client';

import { useState, useEffect, useRef } from 'react';
import { SIMULATOR_SCRIPT } from '@/lib/mock-data';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/agents/verticals/registry';

type SimState = 'idle' | 'ringing' | 'active' | 'ended';
type Mode = 'demo' | 'try' | 'live';
type CallStatus = 'idle' | 'requesting' | 'connecting' | 'connected' | 'error';

const SIM_CUSTOMER_PHONE = '(555) 100-2000';
const CALLBACK_LINE = "you'll receive a callback within 2 hours";

// Selectable service types for the live "try our service" demo (the agent adopts that vertical's
// persona). 'other' is excluded — it just maps to the generic profile.
const SERVICES = BUSINESS_TYPE_OPTIONS.filter((o) => o.value !== 'other');

// Landing-page call demo. Two things in one card:
//   • demo  — an auto-looping scripted call (no buttons; loops forever)
//   • try/live — "Try our service" → pick a service → real live mic call to the OpenAI Realtime
//     agent (same tech as the dashboard test, but public, unsaved, and rate-limited server-side).
export default function CallSimulatorDemo() {
  const [mode, setMode] = useState<Mode>('demo');

  // ── Scripted demo state ───────────────────────────────────────────────────
  const [simState, setSimState] = useState<SimState>('idle');
  const [visibleMessages, setVisibleMessages] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const script = SIMULATOR_SCRIPT as { role: 'ai' | 'caller'; text: string }[];

  // ── Live call state ───────────────────────────────────────────────────────
  const [selectedService, setSelectedService] = useState(SERVICES[0]?.value ?? 'restaurant');
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [callError, setCallError] = useState('');
  // True when the current live call is the "API" control (raw OpenAI Realtime, none of our prompt).
  const [rawCall, setRawCall] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callStatusRef = useRef<CallStatus>('idle');
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  // ── Auto-looping scripted demo ────────────────────────────────────────────
  // One effect drives the whole loop and only runs while in 'demo' mode. Each branch schedules the
  // next state and cleans up its own timers, so switching modes mid-run stops cleanly.
  useEffect(() => {
    if (mode !== 'demo') return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let interval: ReturnType<typeof setInterval> | null = null;

    if (simState === 'idle') {
      setSimState('ringing');
    } else if (simState === 'ringing') {
      setVisibleMessages(0);
      setElapsed(0);
      timers.push(setTimeout(() => { if (!cancelled) setSimState('active'); }, 2000));
    } else if (simState === 'active') {
      interval = setInterval(() => { if (!cancelled) setElapsed((e) => e + 1); }, 1000);
      let i = 0;
      const reveal = () => {
        if (cancelled) return;
        if (i < script.length) {
          setVisibleMessages(i + 1);
          i++;
          if (i < script.length) timers.push(setTimeout(reveal, 1800));
          else timers.push(setTimeout(() => { if (!cancelled) setSimState('ended'); }, 1200));
        }
      };
      timers.push(setTimeout(reveal, 400));
    } else if (simState === 'ended') {
      // Pause on the summary, then loop back to the start.
      timers.push(setTimeout(() => { if (!cancelled) setSimState('ringing'); }, 3500));
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (interval) clearInterval(interval);
    };
  }, [mode, simState, script]);

  // Keep the newest message in view by scrolling ONLY the chat container — never the page
  // (the old scrollIntoView scrolled the whole window, causing the "jump").
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages]);

  // Tear down any live call on unmount.
  useEffect(() => () => teardownCall(), []);

  function teardownCall() {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // ── Mode transitions ──────────────────────────────────────────────────────
  function openTry() {
    setMode('try');
  }
  function backToDemo() {
    teardownCall();
    setCallStatus('idle');
    setCallError('');
    setSimState('idle'); // restart the loop fresh
    setMode('demo');
  }
  function endCall() {
    teardownCall();
    setCallStatus('idle');
    setCallError('');
    setMode('try');
  }

  // ── Live call ─────────────────────────────────────────────────────────────
  // `raw` = the "API" control: the server ships the model with no FrontDesk prompt/config (see
  // /api/voice-session). Same transport otherwise, so the ONLY variable is our prompt layer.
  async function startCall(raw = false) {
    setRawCall(raw);
    setCallError('');
    setMode('live');
    setCallStatus('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
    } catch (err: unknown) {
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCallError(
        denied
          ? "Microphone access was denied. Allow it in your browser's address bar, then try again."
          : 'Could not access your microphone. Check your device settings and try again.',
      );
      setCallStatus('error');
      return;
    }

    setCallStatus('connecting');
    try {
      // Ephemeral token — API key never leaves the server. Pass the chosen service vertical.
      const tokenRes = await fetch('/api/voice-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true, businessType: selectedService, raw }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: 'Server error' }));
        throw new Error(body.error ?? `Session request failed (${tokenRes.status})`);
      }
      const { clientSecret } = await tokenRes.json();
      if (!clientSecret) throw new Error('Server returned an empty session token.');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if ((s === 'failed' || s === 'disconnected' || s === 'closed') && callStatusRef.current === 'connected') {
          setCallError('The connection was interrupted. The call ended.');
          setCallStatus('error');
          teardownCall();
        }
      };
      pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onopen = () => setCallStatus('connected');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!sdpRes.ok) throw new Error(`WebRTC handshake failed: ${sdpRes.status} ${sdpRes.statusText}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    } catch (err: unknown) {
      setCallError(err instanceof Error ? err.message : String(err));
      setCallStatus('error');
      teardownCall();
    }
  }

  const selectedLabel = SERVICES.find((s) => s.value === selectedService)?.label ?? 'Service';

  // ── Status bar text ───────────────────────────────────────────────────────
  const dotClass =
    mode === 'demo'
      ? simState === 'active' ? 'bg-green-400 animate-pulse' : simState === 'ringing' ? 'bg-yellow-400 animate-pulse' : 'bg-slate-500'
      : callStatus === 'connected' ? 'bg-green-400 animate-pulse' : callStatus === 'connecting' || callStatus === 'requesting' ? 'bg-yellow-400 animate-pulse' : callStatus === 'error' ? 'bg-red-400' : 'bg-slate-500';
  const statusText =
    mode === 'demo'
      ? simState === 'idle' ? 'Ready' : simState === 'ringing' ? 'Incoming call…' : simState === 'active' ? 'Call in progress' : 'Call ended'
      : mode === 'try' ? 'Try it yourself'
      : callStatus === 'requesting' ? 'Requesting microphone…' : callStatus === 'connecting' ? 'Connecting…' : callStatus === 'connected' ? 'Live call' : callStatus === 'error' ? 'Call ended' : 'Ready';

  return (
    <div className="max-w-2xl mx-auto">
      <audio ref={audioRef} autoPlay className="hidden" />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* ── Status bar ── */}
        <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${dotClass}`} />
            <span className="text-slate-300 text-sm font-medium">{statusText}</span>
          </div>
          {mode === 'demo' && (simState === 'active' || simState === 'ended') && (
            <span className="text-slate-400 text-xs font-mono">{formatTime(elapsed)}</span>
          )}
          {mode !== 'demo' && (
            <button onClick={backToDemo} className="text-slate-400 hover:text-white text-xs font-medium transition-colors">
              ← Back to demo
            </button>
          )}
        </div>

        {/* ════════════════ DEMO (auto-looping scripted) ════════════════ */}
        {mode === 'demo' && (
          <>
            <div ref={chatRef} className="p-4 sm:p-5 h-[42vh] sm:h-96 overflow-y-auto space-y-3">
              {(simState === 'idle' || simState === 'ringing') && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center ${simState === 'ringing' ? 'bg-yellow-50 animate-bounce' : 'bg-orange-50'}`}>
                    <svg className={`w-7 h-7 ${simState === 'ringing' ? 'text-yellow-500' : 'text-orange-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700">
                    {simState === 'ringing' ? `Incoming call from ${SIM_CUSTOMER_PHONE}` : 'Connecting…'}
                  </p>
                  {simState === 'ringing' && <p className="text-xs text-gray-400">Front desk answering…</p>}
                </div>
              )}

              {(simState === 'active' || simState === 'ended') &&
                script.slice(0, visibleMessages).map((msg, idx) => (
                  <div key={idx} className={`flex gap-2 ${msg.role === 'caller' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'ai' && (
                      <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                        </svg>
                      </div>
                    )}
                    <div className={`max-w-[85%] sm:max-w-xs rounded-2xl px-4 py-2 text-sm ${msg.role === 'ai' ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : 'bg-orange-500 text-white rounded-tr-sm'}`}>
                      {msg.text}
                    </div>
                    {msg.role === 'caller' && (
                      <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {simState === 'ended' && (
              <div className="mx-5 mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                <p className="font-medium mb-1">Call Summary</p>
                <p>
                  Appointment request logged for <strong>John Walker</strong>, party of 4, Saturday
                  May 17th at 7:00 PM. Status: <strong>Pending staff confirmation.</strong> {CALLBACK_LINE}.
                </p>
              </div>
            )}

            <div className="px-5 pb-5 pt-1 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">Auto-playing demo</span>
              <button
                onClick={openTry}
                className="flex items-center gap-2 bg-black hover:bg-orange-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                Try It Yourself →
              </button>
            </div>
          </>
        )}

        {/* ════════════════ TRY (pick a service) ════════════════ */}
        {mode === 'try' && (
          <div className="p-5 sm:p-6">
            <p className="text-sm font-semibold text-gray-900 mb-1">Pick a service to try</p>
            <p className="text-xs text-gray-500 mb-4">
              The front desk will answer as that kind of business. Then press Call and talk to it live.
            </p>
            <div className="flex flex-wrap gap-2 mb-6">
              {SERVICES.map((s) => {
                const active = s.value === selectedService;
                return (
                  <button
                    key={s.value}
                    onClick={() => setSelectedService(s.value)}
                    className={`text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors ${
                      active
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => startCall(false)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call the {selectedLabel} front desk
            </button>
            <p className="mt-3 text-xs text-gray-400">
              A real live call answered by an automated front desk. Microphone access required. Nothing is saved.
            </p>

            {/* ── Control experiment: raw OpenAI Realtime API, none of FrontDesk's prompt/config ── */}
            <div className="mt-5 pt-5 border-t border-dashed border-gray-200">
              <button
                onClick={() => startCall(true)}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                API
              </button>
              <p className="mt-2 text-xs text-gray-400">
                Control test — talks to the raw OpenAI Realtime API with <strong>no prompt or config from FrontDesk</strong>. Service selection is ignored.
              </p>
            </div>
          </div>
        )}

        {/* ════════════════ LIVE (real mic call) ════════════════ */}
        {mode === 'live' && (
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            {callStatus === 'error' ? (
              <>
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.34 16a2 2 0 001.73 3z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-700 max-w-xs mb-5">{callError}</p>
                <div className="flex gap-3">
                  <button onClick={() => startCall(rawCall)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
                    Try again
                  </button>
                  <button onClick={endCall} className="border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
                    Pick another service
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Mic / listening visualizer */}
                <div className="relative w-24 h-24 flex items-center justify-center mb-5">
                  {callStatus === 'connected' && (
                    <>
                      <span className="absolute inset-0 rounded-full bg-orange-400/30 animate-ping" />
                      <span className="absolute inset-2 rounded-full bg-orange-400/20 animate-ping" style={{ animationDelay: '0.4s' }} />
                    </>
                  )}
                  <div className={`relative w-20 h-20 rounded-full flex items-center justify-center ${callStatus === 'connected' ? 'bg-orange-500' : 'bg-slate-300'}`}>
                    <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-900 mb-1">
                  {callStatus === 'connected' ? `Listening — speak now` : callStatus === 'connecting' ? 'Connecting…' : 'Requesting microphone…'}
                </p>
                <p className="text-xs text-gray-500 mb-6">
                  {rawCall ? 'Raw OpenAI Realtime API · no prompt attached' : `${selectedLabel} front desk`} · live demo, not saved
                </p>
                <div className="flex gap-3">
                  <button onClick={endCall} className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors">
                    End call
                  </button>
                  <button onClick={endCall} className="border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
                    Switch service
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        <strong>Note:</strong> This is a demo of an automated front desk. Requests it collects are always marked as{' '}
        <strong>pending staff confirmation</strong>. The live call is not recorded or saved.
      </div>
    </div>
  );
}

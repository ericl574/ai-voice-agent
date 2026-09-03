'use client';

import { useEffect, useRef, useState } from 'react';

type CallStatus = 'idle' | 'requesting' | 'connecting' | 'connected' | 'error';

// Minimal landing-page Realtime control. This intentionally requests the raw session from
// /api/voice-session: no FrontDesk prompt, vertical, tools, RAG, persistence, or post-call work.
// The single button is also the hang-up control while a call is active.
export default function CallSimulatorDemo() {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const statusRef = useRef<CallStatus>('idle');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => () => teardownCall(), []);

  function teardownCall() {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }

  function endCall() {
    teardownCall();
    setError('');
    setStatus('idle');
  }

  async function startCall() {
    if (status !== 'idle' && status !== 'error') return;

    setError('');
    setStatus('requesting');

    let stream: MediaStream;
    try {
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
      setError(
        denied
          ? "Microphone access was denied. Allow it in your browser's address bar, then try again."
          : 'Could not access your microphone. Check your device settings and try again.',
      );
      setStatus('error');
      return;
    }

    setStatus('connecting');
    try {
      const tokenResponse = await fetch('/api/voice-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true, raw: true }),
      });
      if (!tokenResponse.ok) {
        const body = await tokenResponse.json().catch(() => ({ error: 'Server error' }));
        throw new Error(body.error ?? `Session request failed (${tokenResponse.status})`);
      }

      const { clientSecret } = await tokenResponse.json();
      if (!clientSecret) throw new Error('Server returned an empty session token.');

      const peerConnection = new RTCPeerConnection();
      pcRef.current = peerConnection;
      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection.connectionState;
        if (
          (connectionState === 'failed' ||
            connectionState === 'disconnected' ||
            connectionState === 'closed') &&
          statusRef.current === 'connected'
        ) {
          setError('The connection was interrupted. The call ended.');
          setStatus('error');
          teardownCall();
        }
      };
      peerConnection.ontrack = (event) => {
        if (audioRef.current) audioRef.current.srcObject = event.streams[0];
      };
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => setStatus('connected');

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) {
        throw new Error(
          `WebRTC handshake failed: ${sdpResponse.status} ${sdpResponse.statusText}`,
        );
      }
      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      teardownCall();
    }
  }

  const callActive = status === 'requesting' || status === 'connecting' || status === 'connected';
  const statusText =
    status === 'requesting'
      ? 'Requesting microphone…'
      : status === 'connecting'
        ? 'Connecting…'
        : status === 'connected'
          ? 'Live — speak now'
          : status === 'error'
            ? error
            : 'Raw OpenAI Realtime API — no FrontDesk prompt, tools, or saved data.';

  return (
    <div className="max-w-2xl mx-auto">
      <audio ref={audioRef} autoPlay className="hidden" />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
        <div
          className={`mx-auto mb-5 h-3 w-3 rounded-full ${
            status === 'connected'
              ? 'bg-green-500 animate-pulse'
              : status === 'requesting' || status === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : status === 'error'
                  ? 'bg-red-500'
                  : 'bg-slate-400'
          }`}
        />
        <p className="mx-auto mb-6 max-w-md text-sm text-gray-600">{statusText}</p>

        <button
          type="button"
          onClick={callActive ? endCall : startCall}
          className={`inline-flex min-w-40 items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors ${
            callActive
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-slate-900 hover:bg-slate-700'
          }`}
        >
          {callActive ? 'End call' : status === 'error' ? 'Try again' : 'API'}
        </button>
      </div>
    </div>
  );
}

// Pure classification of an RTCPeerConnection.connectionState change into what the call should do.
//
// No imports so the deterministic QA runner can load it. The timer/teardown side effects live in
// the caller (voice/page.tsx). WebRTC 'disconnected' is frequently transient and self-heals back to
// 'connected', so it must be WAITED OUT (grace period) rather than ending the call instantly; only
// 'failed'/'closed' are terminal.

export type ConnectionDisposition = 'ignore' | 'recover-wait' | 'fatal';

export function classifyConnectionState(state: string): ConnectionDisposition {
  switch (state) {
    case 'disconnected':
      return 'recover-wait'; // transient — wait a bounded grace period for auto-recovery
    case 'failed':
    case 'closed':
      return 'fatal'; // terminal — end the call
    default:
      return 'ignore'; // 'new' | 'connecting' | 'connected' | anything else
  }
}

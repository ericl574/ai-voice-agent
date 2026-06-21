// Single source of truth for the OpenAI Realtime turn-taking config, shared by BOTH the browser
// session (src/app/api/voice-session/route.ts) and the phone bridge (server/twilio-bridge.ts).
//
// One definition stops the two paths from drifting. Divergent VAD / interruption settings were why
// real phone calls felt worse than the browser test — the phone path ran bare server-VAD defaults
// and a manual barge-in clear, so the assistant talked over the caller and the greeting got cut off.
//
// Intentionally NOT here (these legitimately differ per path, so each path adds its own):
//   • audio format    — the browser uses the WebRTC default; the phone bridge uses G.711 μ-law.
//   • create_response — the dashboard test is app-controlled (false, Layer 2); the landing demo and
//                       the phone bridge use the server's auto-response (true).
//
// Self-contained (no imports) so the standalone bridge (run via `node --experimental-strip-types`)
// can import it by relative path, the same way the QA scripts import from src/.

export const REALTIME_VAD = {
  type: 'server_vad',
  // Caller must speak clearly to open a turn — background noise is less likely to commit a turn.
  threshold: 0.7,
  // Include 0.3s of audio before detected speech so natural sentence starts aren't clipped.
  prefix_padding_ms: 300,
  // Wait a full second of silence before closing the caller's turn (short replies still register).
  silence_duration_ms: 1000,
  // Do NOT let detected caller speech truncate the assistant mid-reply. The assistant finishes its
  // turn; the caller's turn is handled afterward. Identical on browser and phone — no barge-in.
  interrupt_response: false,
} as const;

// Far-field input noise reduction (suppresses steady background noise before VAD / transcription).
export const REALTIME_NOISE_REDUCTION = { type: 'far_field' } as const;

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
  // turn; the caller's turn is handled afterward. This is the PHONE-safe default — see the incident
  // note above and the interactive profile below. Barge-in stays off on telephony until it's verified
  // on a real forwarded call (echo on a phone line makes early barge-in risky, and the bridge's
  // idle-timer logic assumes the assistant finishes its reply).
  interrupt_response: false,
} as const;

// Interactive (near-field browser) turn-taking — SEMANTIC VAD + barge-in.
//
// CURRENTLY UNUSED: the browser Realtime session was reverted to OpenAI's default server VAD (the
// near-field mic + echo cancellation make the defaults feel great, and we chose to trust the model's
// own settings rather than layer our own). This profile is kept here, documented and tested, so it is
// a one-line re-add if the browser ever needs semantic endpointing again. NEVER used by the phone bridge.
//
// Uses SEMANTIC VAD, not the silence-timer server VAD above. A fixed silence timer cannot tell a
// mid-sentence thinking pause ("what do you guys… have?") from the end of a turn, so any value short
// enough to feel responsive also cuts hesitant callers off. Semantic VAD lets the model decide when
// the caller has actually finished a thought, which removes those mid-sentence cutoffs while staying
// responsive. `eagerness: 'medium'` is the balance point — drop to 'low' if it still jumps in too
// early, raise to 'high' if it feels slow. `interrupt_response: true` keeps caller→assistant barge-in
// (the caller can talk over the assistant; the assistant never cuts off the caller). Safe here because
// WebRTC gives a near-field mic + echo cancellation; telephony keeps the conservative silence-timer
// REALTIME_VAD until barge-in + semantic endpointing are verified on a real forwarded call.
export const REALTIME_VAD_INTERACTIVE = {
  type: 'semantic_vad',
  eagerness: 'medium',
  interrupt_response: true,
} as const;

// Far-field input noise reduction (suppresses steady background noise before VAD / transcription).
export const REALTIME_NOISE_REDUCTION = { type: 'far_field' } as const;

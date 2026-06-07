// Central voice configuration — the single source of truth for everything voice-related:
//   • Settings dropdown (label + description)
//   • allowed-voice validation (settings + /api/voice-preview fallback)
//   • preview sample paths (Test voice & speed button)
//   • generator script voice list (scripts/generate-voice-samples.ts)
//
// `id` is the stable key stored in agent_config.voice_id and shown in the dropdown.
// `runtimeVoiceId` is what gets sent to OpenAI (Realtime audio.output.voice + TTS previews).
// They coincide today, but the split lets the display id and the provider id diverge later.

export interface VoiceOption {
  /** Stable id stored in agent_config.voice_id and used as the dropdown value. */
  id: string;
  /** Human label shown in the Settings dropdown. */
  displayName: string;
  /** Short tone/description. */
  description: string;
  /** OpenAI voice id sent to the Realtime session and the TTS preview endpoint. */
  runtimeVoiceId: string;
  /** Static preview clip served from /public. */
  previewAudioUrl: string;
  /** Whether the voice is offered/validated. */
  enabled: boolean;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: 'alloy',
    displayName: 'Voice 1 — neutral',
    description: 'Neutral, balanced',
    runtimeVoiceId: 'alloy',
    previewAudioUrl: '/voice-samples/alloy.mp3',
    enabled: true,
  },
  {
    id: 'coral',
    displayName: 'Voice 2 — warm',
    description: 'Warm, friendly',
    runtimeVoiceId: 'coral',
    previewAudioUrl: '/voice-samples/coral.mp3',
    enabled: true,
  },
  {
    id: 'sage',
    displayName: 'Voice 3 — clear / professional',
    description: 'Clear, professional',
    runtimeVoiceId: 'sage',
    previewAudioUrl: '/voice-samples/sage.mp3',
    enabled: true,
  },
  {
    id: 'shimmer',
    displayName: 'Voice 4 — brighter',
    description: 'Brighter, more energetic',
    runtimeVoiceId: 'shimmer',
    previewAudioUrl: '/voice-samples/shimmer.mp3',
    enabled: true,
  },
];

// The fixed line spoken in every preview. Edit here, then re-run `npm run voice:samples`.
export const PREVIEW_SAMPLE_TEXT =
  "Hi! Thanks for calling. I can help you book an appointment or answer a quick question. How can I help today?";

// TTS model for previews — the cheap mini model, NOT the Realtime agent model (CLAUDE.md rule 17).
export const PREVIEW_TTS_MODEL = 'gpt-4o-mini-tts';

// ── Derived helpers ─────────────────────────────────────────────────────────

export const ENABLED_VOICE_OPTIONS = VOICE_OPTIONS.filter((v) => v.enabled);

/** Look up an option by its stored id (dropdown value). */
export function getVoiceById(id: string | null | undefined): VoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_OPTIONS.find((v) => v.id === id);
}

/** The fallback option used when none is selected. */
export const DEFAULT_VOICE_OPTION = ENABLED_VOICE_OPTIONS[0];

/** Resolve a requested runtime voice id to an enabled config voice (validation). */
export function resolveRuntimeVoice(runtimeVoiceId: string | null | undefined): VoiceOption | undefined {
  if (!runtimeVoiceId) return undefined;
  return ENABLED_VOICE_OPTIONS.find((v) => v.runtimeVoiceId === runtimeVoiceId);
}

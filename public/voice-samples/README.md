# Voice samples

Pre-recorded clips for the Settings → **Test voice & speed** button. Playing a static file makes the
preview instant; the speed slider is applied in the browser via `audio.playbackRate`.

Files are named by voice id: `alloy.mp3`, `coral.mp3`, `sage.mp3`, `shimmer.mp3`.

## Regenerate from OpenAI (recommended — matches the real agent voices)

```bash
OPENAI_API_KEY=sk-... npm run voice:samples
```

(The script reads the key from the environment only; it never opens `.env.local`. If your key lives
there, load it first, e.g. `set -a; source .env.local; set +a; npm run voice:samples`.)

## Hand-replace a clip

Drop your own `mp3` here named after the voice id (e.g. `coral.mp3`). Any source works, but a clip
that isn't an OpenAI voice won't sound like what callers actually hear.

## Change the spoken line or voice list

Edit `src/lib/voice/voices.ts` — the central voice config (`VOICE_OPTIONS`, `PREVIEW_SAMPLE_TEXT`) —
then re-run the script. If a clip is missing, the app falls back to live synthesis via
`/api/voice-preview`.

// One-time generator for the Settings "Test voice & speed" preview clips.
//
// For each enabled voice in the central config, synthesizes PREVIEW_SAMPLE_TEXT via OpenAI TTS and
// writes its previewAudioUrl file under public/ (committed so previews are instant in the app).
//
// Run:  OPENAI_API_KEY=sk-... npm run voice:samples
// (Reads the key from the ENVIRONMENT only — it never opens .env.local. If your key lives there,
//  load it yourself first, e.g.  set -a; source .env.local; set +a; npm run voice:samples )
//
// Re-run anytime to regenerate. To change the spoken line or voice list, edit
// src/lib/voice/voices.ts. To hand-replace a clip, just drop your own mp3 at its previewAudioUrl.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ENABLED_VOICE_OPTIONS,
  PREVIEW_SAMPLE_TEXT,
  PREVIEW_TTS_MODEL,
} from '../src/lib/voice/voices.ts';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      'OPENAI_API_KEY is not set in the environment.\n' +
        'Run with the key available, e.g.:\n' +
        '  OPENAI_API_KEY=sk-... npm run voice:samples',
    );
    process.exit(1);
  }

  console.log(`Generating ${ENABLED_VOICE_OPTIONS.length} voice samples → public/voice-samples`);
  for (const voice of ENABLED_VOICE_OPTIONS) {
    process.stdout.write(`  ${voice.id} (${voice.runtimeVoiceId}) … `);
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PREVIEW_TTS_MODEL,
        voice: voice.runtimeVoiceId,
        input: PREVIEW_SAMPLE_TEXT,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.log('failed');
      console.error(`\nTTS failed for "${voice.id}" (${res.status}): ${detail}`);
      process.exit(1);
    }

    // Write to exactly the file the app requests (derived from previewAudioUrl).
    const filePath = path.join(process.cwd(), 'public', voice.previewAudioUrl.replace(/^\//, ''));
    await mkdir(path.dirname(filePath), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(filePath, buf);
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB) → ${path.relative(process.cwd(), filePath)}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// Dev-only debug endpoint. Writes the recorded caller audio Blob to <project-root>/audio-source/
// so the original MediaRecorder source can be inspected offline. Disabled in production. This
// never affects the call / transcription flow — the client treats any failure as a warning.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const audio = formData.get('audio') as File | null;
  if (!audio) {
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
  }

  try {
    const dir = path.join(process.cwd(), 'audio-source');
    await mkdir(dir, { recursive: true });

    // Timestamped filename in local time, e.g. call-2026-06-04-13-25-10.webm
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `call-${stamp}.webm`;
    const filePath = path.join(dir, filename);

    // Original recorded format (.webm) — the real MediaRecorder source audio. No conversion.
    const buffer = Buffer.from(await audio.arrayBuffer());
    await writeFile(filePath, buffer);

    console.log(`[FD debug] caller audio source saved → ${filePath}`);
    return NextResponse.json({ ok: true, path: filePath, filename });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[FD debug] save-audio-source write failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

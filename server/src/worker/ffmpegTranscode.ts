import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export function extensionFromStoragePath(rawPath: string | null | undefined): string {
  if (!rawPath?.trim()) return '';
  const base = rawPath.trim().split('/').pop() ?? '';
  if (!base.includes('.')) return '';
  return (base.split('.').pop() ?? '').toLowerCase();
}

function extractFfmpegError(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const hit = [...lines].reverse().find(l =>
    /conversion failed|error|invalid|could not|no such file|encoder|decoder|not found|matches no streams/i.test(l),
  );
  if (hit) return hit.slice(0, 600);
  return (lines.slice(-3).join(' | ') || 'ffmpeg failed').slice(0, 600);
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { maxBuffer: 24 * 1024 * 1024 });
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      extractFfmpegError(err.stderr ?? '', err.stdout ?? '') || err.message || 'ffmpeg failed',
    );
  }
}

const VIDEO_TRANSCODE_PROFILES: string[][] = [
  [
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-vf',
    "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p",
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
  ],
  [
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-vf',
    'scale=-2:720,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
  ],
  ['-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
];

export async function transcodeVideoForQr(
  tmpDir: string,
  inputBuf: Buffer,
  rawPathHint?: string | null,
): Promise<Buffer> {
  const ext = extensionFromStoragePath(rawPathHint) || 'mp4';
  const inPath = path.join(tmpDir, `in.${ext}`);
  const outPath = path.join(tmpDir, 'out.mp4');
  await writeFile(inPath, inputBuf);

  let lastErr = 'ffmpeg video transcode failed';
  for (const profile of VIDEO_TRANSCODE_PROFILES) {
    try {
      await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', inPath, ...profile, outPath]);
      return await readFile(outPath);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

export async function transcodeAudioForQr(
  tmpDir: string,
  inputBuf: Buffer,
  rawPathHint?: string | null,
): Promise<Buffer> {
  const ext = extensionFromStoragePath(rawPathHint) || 'm4a';
  const inPath = path.join(tmpDir, `in.${ext}`);
  const outPath = path.join(tmpDir, 'out.m4a');
  await writeFile(inPath, inputBuf);

  const profiles: string[][] = [
    ['-vn', '-ac', '1', '-c:a', 'aac', '-ar', '44100', '-b:a', '96k', '-movflags', '+faststart'],
    ['-ac', '1', '-c:a', 'aac', '-ar', '44100', '-b:a', '96k', '-movflags', '+faststart'],
  ];

  let lastErr = 'ffmpeg audio transcode failed';
  for (const profile of profiles) {
    try {
      await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', inPath, ...profile, outPath]);
      return await readFile(outPath);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

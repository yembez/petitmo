import type { Memory } from '@/types/local';

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i;

export function isLikelyVideoFileUri(uri: string): boolean {
  const u = (uri.split('?')[0] ?? '').trim().toLowerCase();
  if (!u) return false;
  return VIDEO_EXT_RE.test(u);
}

export function firstNonEmptyUri(...parts: (string | null | undefined)[]): string {
  for (const p of parts) {
    const t = typeof p === 'string' ? p.trim() : '';
    if (t) return t;
  }
  return '';
}

/** Chaîne de lecture vidéo : distant, puis chemins locaux persistés. */
export function videoPlaybackCandidateFromMemory(
  m: Pick<Memory, 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path'>
): string {
  return firstNonEmptyUri(
    m.edited_media_url,
    m.media_url,
    m.local_media_path,
    m.local_original_path
  );
}

/** URI exploitable par `expo-av` `Video` (préfixe `file://` si chemin absolu). */
export function normalizeVideoPlaybackUri(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (
    /^https?:\/\//i.test(t) ||
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://')
  ) {
    return t;
  }
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

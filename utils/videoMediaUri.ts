import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import { peekFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import {
  isLocalMediaUriReadable,
  rebaseSandboxUriToCurrentContainer,
} from '@/utils/localMediaReadable';

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i;

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

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

/** Ordre de préférence pour la lecture (sans vérif disque). */
export function videoPlaybackCandidateUrisFromMemory(
  m: Pick<Memory, 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path'>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = (raw ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(m.edited_media_url);
  /** Sandbox canonique avant la copie fil (souvent absente si `petitmo_feed_local_videos` purgée). */
  push(m.local_original_path);
  push(m.local_media_path);
  push(m.media_url);
  return out;
}

/** Premier candidat non vide (affichage rapide / heuristiques). */
export function videoPlaybackCandidateFromMemory(
  m: Pick<Memory, 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path'>,
): string {
  return videoPlaybackCandidateUrisFromMemory(m)[0] ?? '';
}

/**
 * Première URI réellement lisible : évite les chemins SQLite obsolètes vers `petitmo_feed_local_videos/`.
 */
export async function resolveReadableVideoPlaybackUri(
  m: Pick<Memory, 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path' | 'type'>,
  opts?: {
    feedCopy?: string | null;
    bootstrap?: string | null;
    resolveRemote?: (raw: string) => Promise<string>;
  },
): Promise<string> {
  if (m.type !== 'video') return '';

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = (raw ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    candidates.push(t);
  };

  push(opts?.feedCopy);
  push(opts?.bootstrap);
  for (const u of videoPlaybackCandidateUrisFromMemory(m)) push(u);

  const resolveRemote = opts?.resolveRemote ?? (async (raw: string) => raw);

  if (Platform.OS === 'web') {
    const raw = candidates.find(c => !isHttpUrl(c)) ?? candidates[0] ?? '';
    if (!raw) return '';
    if (isHttpUrl(raw)) return normalizeVideoPlaybackUri(await resolveRemote(raw));
    return normalizeVideoPlaybackUri(raw);
  }

  for (const raw of candidates) {
    if (isHttpUrl(raw)) {
      const remote = (await resolveRemote(raw)).trim();
      if (remote) return normalizeVideoPlaybackUri(remote);
      continue;
    }
    if (await isLocalMediaUriReadable(raw)) {
      return normalizeVideoPlaybackUri(raw);
    }
  }

  return '';
}

/** URI locale synchronisable pour autoplay fil — bootstrap / copie fil uniquement (pas de chemins SQLite morts). */
export function syncFeedLocalVideoPlaybackUri(
  m: Pick<Memory, 'id' | 'type' | 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path'>,
): string {
  if (m.type !== 'video') return '';
  const boot = peekFeedBootstrapVideoUri(m.id)?.trim();
  if (boot && isFeedLocalVideoPlaybackUri(boot)) return normalizeVideoPlaybackUri(boot);
  return '';
}

/** URI exploitable par `expo-av` `Video` (préfixe `file://` si chemin absolu). */
export function normalizeVideoPlaybackUri(raw: string): string {
  const input = raw.trim();
  if (!input) return '';
  // Rebase container iOS (UUID change au build/réinstall) avant de composer l’URI de lecture.
  const t = rebaseSandboxUriToCurrentContainer(input);
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

/** URI de lecture fil autoplay-safe : sandbox ou copie fil — jamais une URL cloud signée. */
export function isFeedLocalVideoPlaybackUri(uri: string): boolean {
  const t = uri.trim();
  if (!t || /^https?:\/\//i.test(t)) return false;
  return (
    t.includes('petitmo_memories/') ||
    t.includes('petitmo_feed_local_videos/') ||
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('/') ||
    t.startsWith('ph://')
  );
}

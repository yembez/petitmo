import type { Memory } from '@/types/local';
import {
  appendLocalMediaCacheBuster,
  getVideoPosterUriForFeedAndViewer,
  isDeviceLocalMediaUri,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import { isSandboxUriFromForeignContainer, isLocalMediaUriReadable } from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import { isLikelyRasterImageUri, isLikelyVideoFileUri } from '@/utils/videoMediaUri';
import {
  invalidateFeedVideoPosterStableCache,
  peekFeedVideoPosterStableCache,
  resolveFeedVideoPosterStableCache,
} from '@/hooks/feedVideoPosterStableCache';

function isUsableFeedPosterUri(u: string): boolean {
  const t = u.trim();
  if (!t || isLikelyVideoFileUri(t)) return false;
  return isLikelyRasterImageUri(t);
}

function remoteVideoPosterRef(memory: Memory): string {
  for (const u of [memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && !isDeviceLocalMediaUri(t) && isUsableFeedPosterUri(t)) return t;
  }
  return '';
}

function normalizePosterDisplay(u: string, updatedAt?: string | null): string {
  const t = u.trim();
  if (!t || !isUsableFeedPosterUri(t)) return '';
  const n = normalizeMemoryMediaUriForDisplay(t);
  if (isDeviceLocalMediaUri(n)) return appendLocalMediaCacheBuster(n, updatedAt);
  return n;
}

/** Poster local uniquement si le JPEG est lisible (ignore chemins morts et fichiers vidéo). */
async function readableLocalPosterUri(memory: Memory): Promise<string> {
  for (const u of [memory.local_thumb_path, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (!t || !isDeviceLocalMediaUri(t) || !isUsableFeedPosterUri(t)) continue;
    if (isSandboxUriFromForeignContainer(t)) continue;
    if (await isLocalMediaUriReadable(t)) {
      return normalizePosterDisplay(t, memory.updated_at);
    }
  }
  return '';
}

async function resolveRemotePoster(memory: Memory): Promise<string> {
  const remote = remoteVideoPosterRef(memory);
  if (!remote) return '';
  if (/^https?:\/\//i.test(remote)) return normalizePosterDisplay(remote);
  const signed = (await getSignedMediaDisplayUrl(remote)).trim();
  return signed ? normalizePosterDisplay(signed) : '';
}

/**
 * Résout un poster vidéo affichable — jamais un chemin sandbox mort.
 * Met à jour le cache stable session.
 */
export async function resolveFeedVideoPosterDisplayUri(memory: Memory): Promise<string> {
  if (memory.type !== 'video') return '';

  const cached = peekFeedVideoPosterStableCache(memory.id);
  if (cached && isUsableFeedPosterUri(cached)) {
    return normalizePosterDisplay(cached, memory.updated_at);
  }
  if (cached) invalidateFeedVideoPosterStableCache(memory.id);

  const local = await readableLocalPosterUri(memory);
  if (local) return resolveFeedVideoPosterStableCache(memory.id, local);

  const remote = await resolveRemotePoster(memory);
  if (remote) return resolveFeedVideoPosterStableCache(memory.id, remote);

  /** Jamais d’extraction de frame ici : ça partage le décodeur avec expo-video et gèle l’app. */
  return '';
}

/** Sync : cache session ou chemin DB connu (1er paint fil / favoris). */
export function peekSyncFeedVideoPosterDisplayUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  const cached = peekFeedVideoPosterStableCache(memory.id);
  if (cached && isUsableFeedPosterUri(cached)) {
    return normalizePosterDisplay(cached, memory.updated_at);
  }
  const sync = getVideoPosterUriForFeedAndViewer(memory).trim();
  return sync ? normalizePosterDisplay(sync, memory.updated_at) : '';
}

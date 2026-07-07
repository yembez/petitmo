import type { Memory } from '@/types/local';
import {
  isDeviceLocalMediaUri,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import { isSandboxUriFromForeignContainer, isLocalMediaUriReadable } from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  peekFeedVideoPosterStableCache,
  resolveFeedVideoPosterStableCache,
} from '@/hooks/feedVideoPosterStableCache';

function remoteVideoPosterRef(memory: Memory): string {
  for (const u of [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && !isDeviceLocalMediaUri(t)) return t;
  }
  return '';
}

function normalizePosterDisplay(u: string): string {
  const t = u.trim();
  return t ? normalizeMemoryMediaUriForDisplay(t) : '';
}

/** Poster local uniquement si le fichier est lisible (ignore chemins morts pré-Petitmo+). */
async function readableLocalPosterUri(memory: Memory): Promise<string> {
  for (const u of [memory.local_thumb_path, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (!t || !isDeviceLocalMediaUri(t)) continue;
    if (isSandboxUriFromForeignContainer(t)) continue;
    if (await isLocalMediaUriReadable(t)) {
      return normalizeMemoryMediaUriForDisplay(t);
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
  if (cached) return normalizePosterDisplay(cached);

  const local = await readableLocalPosterUri(memory);
  if (local) return resolveFeedVideoPosterStableCache(memory.id, local);

  const remote = await resolveRemotePoster(memory);
  if (remote) return resolveFeedVideoPosterStableCache(memory.id, remote);

  return '';
}

/** Sync : cache session uniquement (safe au 1er paint FlatList hors écran). */
export function peekSyncFeedVideoPosterDisplayUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  const cached = peekFeedVideoPosterStableCache(memory.id);
  return cached ? normalizePosterDisplay(cached) : '';
}

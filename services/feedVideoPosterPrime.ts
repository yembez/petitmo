import type { Memory } from '@/types/local';
import { isDeviceLocalMediaUri, normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import { isSandboxUriFromForeignContainer, isLocalMediaUriReadable } from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import { setFeedVideoPosterStableCache } from '@/hooks/feedVideoPosterStableCache';
import { resolveFeedVideoPosterDisplayUri } from '@/utils/feedVideoPosterUri';

function remoteVideoPosterRef(memory: Memory): string {
  for (const u of [memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && !isDeviceLocalMediaUri(t)) return t;
  }
  return '';
}

/**
 * Pré-charge les posters vidéo cloud (souvenirs pré-Petitmo+) avant le scroll.
 */
export async function primeFeedVideoPosterStableCache(
  memories: readonly Memory[],
  options?: { max?: number },
): Promise<void> {
  const max = options?.max ?? 48;
  let done = 0;

  for (const m of memories) {
    if (done >= max) break;
    if (m.type !== 'video') continue;
    await resolveFeedVideoPosterDisplayUri(m);
    done += 1;
  }
}

/** Résolution rapide pour prefetch viewability (poster cloud signé si besoin). */
export async function primeFeedVideoPosterForMemory(memory: Memory): Promise<void> {
  if (memory.type !== 'video') return;
  await resolveFeedVideoPosterDisplayUri(memory);
}

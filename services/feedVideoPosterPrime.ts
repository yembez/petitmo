import type { Memory } from '@/types/local';
import { resolveFeedVideoPosterDisplayUri } from '@/utils/feedVideoPosterUri';

/**
 * Cache les posters **déjà présents** (local / cloud). Aucune extraction de frame.
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

/** Prefetch viewability : JPEG existant seulement, pas de `getThumbnailAsync`. */
export async function primeFeedVideoPosterForMemory(memory: Memory): Promise<void> {
  if (memory.type !== 'video') return;
  await resolveFeedVideoPosterDisplayUri(memory);
}

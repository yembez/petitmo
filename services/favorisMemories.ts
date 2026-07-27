import { getAllLocalMemories } from '@/lib/localDb';
import { getFamilyMemories } from '@/services/media';
import { reconcileFavoritesAfterCloudSync } from '@/services/memoryDisplayHeal';
import type { Memory } from '@/types/local';
import { parseFavoritePhotoUrls } from '@/utils/memoryPhotos';

/** Un souvenir doit apparaître dans l’onglet Favoris (grille ou diaporama). */
export function memoryShouldAppearInFavoris(m: Memory): boolean {
  if (m.is_favorite) return true;
  if (m.type === 'photo') return parseFavoritePhotoUrls(m).length > 0;
  if (m.type === 'video' || m.type === 'voice') {
    return parseFavoritePhotoUrls(m).length > 0;
  }
  return false;
}

/**
 * Charge les souvenirs pour Favoris.
 * Défaut = **local-first** (SQLite immédiat). Passer `{ waitForRemote: true }` seulement
 * pour un pull bloquant explicite (rare).
 */
export async function loadMemoriesForFavorisTab(opts?: {
  waitForRemote?: boolean;
}): Promise<Memory[]> {
  const { applyFeedHydrationFavoriteFlagsToLocal } = await import('@/services/memoryDisplayHeal');
  applyFeedHydrationFavoriteFlagsToLocal();

  if (opts?.waitForRemote === true) {
    await getFamilyMemories();
    applyFeedHydrationFavoriteFlagsToLocal();
    await reconcileFavoritesAfterCloudSync();
    return getAllLocalMemories();
  }

  return getAllLocalMemories();
}

/** Pull cloud + reconcile favoris en fond (ne doit jamais bloquer l’UI). */
export function syncFavorisMemoriesFromCloudInBackground(
  onDone?: (list: Memory[]) => void,
): void {
  void (async () => {
    try {
      const list = await loadMemoriesForFavorisTab({ waitForRemote: true });
      onDone?.(list);
    } catch (e) {
      console.warn('[syncFavorisMemoriesFromCloudInBackground]', e);
    }
  })();
}

export function listLocalMemoriesMarkedForFavoris(): Memory[] {
  return getAllLocalMemories().filter(memoryShouldAppearInFavoris);
}

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
 * Charge les souvenirs pour Favoris : sync cloud + réaligne les cœurs du fil (cache onglet Fil)
 * vers SQLite avant affichage.
 */
export async function loadMemoriesForFavorisTab(): Promise<Memory[]> {
  await getFamilyMemories();
  const { applyFeedHydrationFavoriteFlagsToLocal } = await import('@/services/memoryDisplayHeal');
  applyFeedHydrationFavoriteFlagsToLocal();
  await reconcileFavoritesAfterCloudSync();
  return getAllLocalMemories();
}

export function listLocalMemoriesMarkedForFavoris(): Memory[] {
  return getAllLocalMemories().filter(memoryShouldAppearInFavoris);
}

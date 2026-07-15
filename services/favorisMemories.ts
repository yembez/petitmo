import { getAllLocalMemories } from '@/lib/localDb';
import { getFamilyMemories } from '@/services/media';
import { reconcileFavoritesAfterCloudSync } from '@/services/memoryDisplayHeal';
import type { Memory } from '@/types/local';
import {
  getAlbumCanonicalFavoriteUrls,
  mapPhotoUrlToThumb,
  normalizeMemoryMediaUriForDisplay,
  normalizePhotoUrlForCompare,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';

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

/** Vignettes photo pour le modal « Choisir la couverture » — parité onglet Favoris + albums favoris complets. */
export function buildFavoriteCoverThumbs(
  memories: readonly Memory[],
): { thumb: string; source: string }[] {
  const out: { thumb: string; source: string }[] = [];
  const seen = new Set<string>();

  for (const m of memories) {
    if (m.type !== 'photo') continue;
    if (!memoryShouldAppearInFavoris(m)) continue;

    const sources: string[] = [];
    const favUrls = parseFavoritePhotoUrls(m);
    // Album marqué favori → toutes les cases (pas seulement la vignette principale).
    if (m.is_favorite) {
      for (const u of getAlbumCanonicalFavoriteUrls(m)) sources.push(u);
    }
    for (const u of favUrls) sources.push(u);

    for (const u of sources) {
      const source = u.trim();
      if (!source) continue;
      const dedupeKey = normalizePhotoUrlForCompare(source);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const thumbRaw = mapPhotoUrlToThumb(m, source).trim() || source;
      const thumb = normalizeMemoryMediaUriForDisplay(thumbRaw) || thumbRaw;
      if (!thumb) continue;
      out.push({ thumb, source });
    }
  }

  return out;
}

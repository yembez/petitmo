/**
 * Picker couverture livre — parité stricte grille Favoris.
 */

import type { Memory } from '@/types/local';
import {
  canonicalBookCoverPhotoRef,
  getAllPhotoUrlsForFeed,
  getVideoPosterUriForFeedAndViewer,
  getVoiceCoverUriForFeedAndViewer,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import { buildFavorisGridItems, type FavorisGridItem } from '@/utils/favorisGridItems';

export type FavoriteCoverThumb = { thumb: string; source: string };

function coverPickerSourceForItem(item: FavorisGridItem): string {
  if (item.kind === 'photo' && item.favPhotoOriginalUrl?.trim()) {
    return item.favPhotoOriginalUrl.trim();
  }
  const m = item.memory;
  if (m.type === 'photo') {
    return (
      getAllPhotoUrlsForFeed(m)[0]?.trim() ||
      canonicalBookCoverPhotoRef(m).trim() ||
      item.thumbUrl.trim()
    );
  }
  if (m.type === 'video') return getVideoPosterUriForFeedAndViewer(m).trim() || item.thumbUrl.trim();
  if (m.type === 'voice') return getVoiceCoverUriForFeedAndViewer(m).trim() || item.thumbUrl.trim();
  return item.thumbUrl.trim();
}

export function buildFavoriteCoverThumbs(memories: readonly Memory[]): FavoriteCoverThumb[] {
  const seen = new Set<string>();
  const out: FavoriteCoverThumb[] = [];

  for (const item of buildFavorisGridItems(memories)) {
    const source = coverPickerSourceForItem(item).trim();
    const thumbRaw = item.thumbUrl.trim() || source;
    if (!source || !thumbRaw) continue;
    if (seen.has(source)) continue;
    seen.add(source);
    const thumb = normalizeMemoryMediaUriForDisplay(thumbRaw) || thumbRaw;
    out.push({ thumb, source });
  }

  return out;
}

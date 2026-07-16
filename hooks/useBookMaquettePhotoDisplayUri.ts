import { useMemo } from 'react';
import type { Memory } from '@/types/local';
import { useFeedPhotoDisplayUrls } from '@/hooks/useFeedPhotoDisplayUrls';
import {
  getPhotoUriForBookMaquetteDisplay,
  indexOfPhotoUrlInFeed,
} from '@/utils/memoryPhotos';

/**
 * URI photo maquette livre — même résolution que le fil Favoris (sandbox lisible + repli cloud).
 */
export function useBookMaquettePhotoDisplayUri(
  memory: Memory | null | undefined,
  photoRef?: string | null,
): string {
  const photoMemory = memory?.type === 'photo' ? memory : null;
  const feedUrls = useFeedPhotoDisplayUrls(photoMemory ?? ({ id: '', type: 'text' } as Memory));

  return useMemo(() => {
    if (!photoMemory) return '';
    const ref = photoRef?.trim() ?? '';
    if (ref) {
      const idx = indexOfPhotoUrlInFeed(photoMemory, ref);
      const fromFeed = idx >= 0 ? feedUrls[idx]?.trim() : '';
      if (fromFeed) return fromFeed;
    } else if (feedUrls[0]?.trim()) {
      return feedUrls[0].trim();
    }
    return getPhotoUriForBookMaquetteDisplay(photoMemory, ref || undefined).trim();
  }, [feedUrls, photoMemory, photoRef]);
}

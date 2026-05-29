import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { toggleFavorite as toggleFavoriteService } from '@/services/media';
import type { Memory } from '@/utils/feedHelpers';
import {
  getAlbumCanonicalFavoriteUrls,
  isFeedMultiPhotoAlbum,
} from '@/utils/memoryPhotos';

export function useToggleFavorite(
  setMemories: Dispatch<SetStateAction<Memory[]>>
): (id: string) => Promise<void> {
  const toggleFavorite = useCallback(
    async (id: string) => {
      if (id.startsWith('pending_')) return;

      let previousFavorite: boolean | undefined;
      setMemories(prev => {
        const memory = prev.find(m => m.id === id);
        if (!memory) return prev;
        previousFavorite = memory.is_favorite;
        const nextFavorite = !memory.is_favorite;
        const album =
          memory.type === 'photo' && isFeedMultiPhotoAlbum(memory);
        return prev.map(m => {
          if (m.id !== id) return m;
          if (album) {
            return {
              ...m,
              is_favorite: nextFavorite,
              favorite_photo_urls: nextFavorite
                ? getAlbumCanonicalFavoriteUrls(m)
                : [],
            };
          }
          return { ...m, is_favorite: nextFavorite };
        });
      });

      if (previousFavorite === undefined) return;

      const nextFavorite = !previousFavorite;
      const ok = await toggleFavoriteService(id, nextFavorite);
      if (!ok) {
        const rollback = previousFavorite;
        setMemories(prev => prev.map(m => (m.id === id ? { ...m, is_favorite: rollback } : m)));
      }
    },
    [setMemories]
  );
  return toggleFavorite;
}

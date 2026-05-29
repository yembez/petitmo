import type { Memory } from '@/types/local';
import { getAllPhotoUrlsForFeed, isFeedMultiPhotoAlbum } from '@/utils/memoryPhotos';

/** Une page du viewer vertical : souvenir entier ou une photo d’album. */
export type ImmersiveViewerItem =
  | { kind: 'memory'; memory: Memory }
  | {
      kind: 'albumPhoto';
      memory: Memory;
      photoUri: string;
      albumPhotoIndex: number;
      albumPhotoCount: number;
    };

export function buildImmersiveViewerItems(memories: Memory[]): ImmersiveViewerItem[] {
  const items: ImmersiveViewerItem[] = [];
  for (const memory of memories) {
    if (memory.type === 'photo' && isFeedMultiPhotoAlbum(memory)) {
      const urls = getAllPhotoUrlsForFeed(memory);
      urls.forEach((photoUri, albumPhotoIndex) => {
        items.push({
          kind: 'albumPhoto',
          memory,
          photoUri,
          albumPhotoIndex,
          albumPhotoCount: urls.length,
        });
      });
    } else {
      items.push({ kind: 'memory', memory });
    }
  }
  return items;
}

/** Index dans la liste aplatie (album = une page par photo). */
export function resolveImmersiveViewerInitialIndex(
  memories: Memory[],
  memoryIndex: number,
  albumPhotoIndex?: number,
): number {
  const items = buildImmersiveViewerItems(memories);
  const target = memories[memoryIndex];
  if (!target) return 0;

  if (target.type === 'photo' && isFeedMultiPhotoAlbum(target)) {
    const urls = getAllPhotoUrlsForFeed(target);
    const safePhoto = Math.min(Math.max(0, albumPhotoIndex ?? 0), Math.max(0, urls.length - 1));
    const idx = items.findIndex(
      it =>
        it.kind === 'albumPhoto' &&
        it.memory.id === target.id &&
        it.albumPhotoIndex === safePhoto,
    );
    return idx >= 0 ? idx : 0;
  }

  const idx = items.findIndex(it => it.kind === 'memory' && it.memory.id === target.id);
  return idx >= 0 ? idx : 0;
}

export function immersiveViewerItemKey(item: ImmersiveViewerItem): string {
  return item.kind === 'albumPhoto'
    ? `${item.memory.id}-album-${item.albumPhotoIndex}`
    : item.memory.id;
}

export function memoryFromImmersiveViewerItem(item: ImmersiveViewerItem): Memory {
  return item.memory;
}

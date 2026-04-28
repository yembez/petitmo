import { useCallback } from 'react';
import { Image } from 'expo-image';
import type { ViewToken } from 'react-native';
import type { Memory as MemoryRow } from '@/types/local';
import { getAllPhotoUrlsForFeed } from '@/utils/memoryPhotos';

type FeedListItemForPrefetch =
  | { rowKind: 'memory'; memory: MemoryRow }
  | { rowKind: 'pending'; row: { committedMemory?: MemoryRow | null } };

function pushHttpsUrl(acc: string[], u: string | null | undefined): void {
  const t = (u ?? '').trim();
  if (t.startsWith('https://') || t.startsWith('http://')) {
    acc.push(t);
  }
}

function urisFromMemory(m: MemoryRow): string[] {
  const acc: string[] = [];
  if (m.type === 'photo') {
    for (const u of getAllPhotoUrlsForFeed(m)) {
      pushHttpsUrl(acc, u);
    }
  }
  pushHttpsUrl(acc, m.poster_url);
  pushHttpsUrl(acc, m.thumbnail_url);
  pushHttpsUrl(acc, m.voice_cover_url);
  return [...new Set(acc)];
}

function memoryFromViewTokenItem(item: ViewToken['item']): MemoryRow | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as FeedListItemForPrefetch;
  if (it.rowKind === 'memory') return it.memory;
  if (it.rowKind === 'pending' && it.row.committedMemory) return it.row.committedMemory;
  return null;
}

export function usePrefetchMemories(): {
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
} {
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      const all = new Set<string>();
      for (const t of info.viewableItems) {
        const m = memoryFromViewTokenItem(t.item);
        if (!m) continue;
        for (const u of urisFromMemory(m)) {
          all.add(u);
        }
      }
      const list = [...all];
      if (list.length === 0) return;
      void Image.prefetch(list, 'disk');
    },
    []
  );

  return { onViewableItemsChanged };
}

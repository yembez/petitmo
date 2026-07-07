import { useCallback, useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import type { ViewToken } from 'react-native';
import type { Memory as MemoryRow } from '@/types/local';
import { getAllPhotoUrlsForFeed } from '@/utils/memoryPhotos';
import { getSignedMediaDisplayUrl, primeSignedMediaDisplayUrls } from '@/lib/mediaSignedUrl';
import { primeFeedVideoPosterForMemory } from '@/services/feedVideoPosterPrime';

/** Limite le travail réseau / disque quand beaucoup de lignes sont « viewables ». */
const PREFETCH_MAX_HTTPS_URLS = 40;
/** Regroupe les prefetch pendant un scroll rapide (haut ou bas). */
const PREFETCH_DEBOUNCE_MS = 80;

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
  if (m.type !== 'video') {
    pushHttpsUrl(acc, m.poster_url);
    pushHttpsUrl(acc, m.thumbnail_url);
  }
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestViewableRef = useRef<ViewToken[]>([]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const runPrefetch = useCallback((viewableItems: ViewToken[]) => {
    const all = new Set<string>();
    for (const t of viewableItems) {
      const m = memoryFromViewTokenItem(t.item);
      if (!m) continue;
      if (m.type === 'video') {
        void primeFeedVideoPosterForMemory(m);
        continue;
      }
      for (const u of urisFromMemory(m)) {
        all.add(u);
      }
    }
    const list = [...all];
    if (list.length === 0) return;
    if (list.length > PREFETCH_MAX_HTTPS_URLS) {
      list.length = PREFETCH_MAX_HTTPS_URLS;
    }
    void (async () => {
      await primeSignedMediaDisplayUrls(list);
      const signed = await Promise.all(list.map(u => getSignedMediaDisplayUrl(u)));
      void Image.prefetch(signed, 'disk');
    })();
  }, []);

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      latestViewableRef.current = info.viewableItems;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runPrefetch(latestViewableRef.current);
      }, PREFETCH_DEBOUNCE_MS);
    },
    [runPrefetch],
  );

  return { onViewableItemsChanged };
}

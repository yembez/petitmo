import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookPage } from '@/src/book/BookEngine';
import { primeBookQrTokens } from '@/lib/bookQrTokenStore';
import {
  bookQrMemoryIdsKey,
  readCachedBookQrTokens,
  resolveBookQrTokensForPreview,
} from '@/services/bookQrPreview';
import {
  bookPortraitPerfNetwork,
  bookPortraitPerfState,
  bookPortraitPerfTiming,
  isBookPortraitPerfEnabled,
} from '@/utils/bookPortraitSpreadPerf';

function mergeTokenMaps(
  ...maps: Array<Record<string, string>>
): Record<string, string> {
  return Object.assign({}, ...maps);
}

function tokenMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Tokens QR livre — lecture SQLite synchrone à chaque render, fetch réseau uniquement pour les manquants.
 * Publie dans `bookQrTokenStore` pour que `useBookQrUrl` re-render uniquement les feuilles concernées.
 */
export function useBookQrTokenUrls(childId: string | undefined, pages: BookPage[]): Record<string, string> {
  const idsKey = useMemo(() => bookQrMemoryIdsKey(pages), [pages]);
  const memoryIds = useMemo(
    () => (idsKey ? idsKey.split(',').filter(Boolean) : []),
    [idsKey],
  );

  const cachedTokens = useMemo(() => {
    if (memoryIds.length === 0) return {};
    return readCachedBookQrTokens(memoryIds);
  }, [idsKey, memoryIds.length]);

  const [networkTokens, setNetworkTokens] = useState<Record<string, string>>({});
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const tokensByMemoryId = useMemo(() => {
    const merged = mergeTokenMaps(cachedTokens, networkTokens);
    if (Object.keys(merged).length > 0) {
      primeBookQrTokens(merged);
    }
    return merged;
  }, [cachedTokens, networkTokens]);

  useEffect(() => {
    if (!isBookPortraitPerfEnabled()) return;
    bookPortraitPerfState('useBookQrTokenUrls:effect', {
      childId: childId?.slice(0, 8),
      idsKey,
      memoryIdsCount: memoryIds.length,
      cachedCount: Object.keys(cachedTokens).length,
    });
  }, [childId, idsKey, memoryIds.length, cachedTokens]);

  useEffect(() => {
    if (!childId || memoryIds.length === 0) {
      setNetworkTokens(prev => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const missing = memoryIds.filter(id => !cachedTokens[id]?.trim());
    if (isBookPortraitPerfEnabled()) {
      bookPortraitPerfState('useBookQrTokenUrls:cache-read', {
        cachedCount: Object.keys(cachedTokens).length,
        missingCount: missing.length,
        missingIds: missing.map(id => id.slice(0, 8)),
      });
    }

    if (missing.length === 0) return;

    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    bookPortraitPerfNetwork('resolveBookQrTokensForPreview:start', {
      missingCount: missing.length,
    });
    void (async () => {
      try {
        const tokens = await resolveBookQrTokensForPreview(childId, pagesRef.current);
        if (cancelled) return;
        bookPortraitPerfTiming('resolveBookQrTokensForPreview:done', startedAt, {
          fetchedCount: Object.keys(tokens).length,
        });
        setNetworkTokens(prev => {
          const merged = mergeTokenMaps(prev, tokens);
          const same = tokenMapsEqual(prev, merged);
          if (!same && isBookPortraitPerfEnabled()) {
            bookPortraitPerfState('useBookQrTokenUrls:setState-network', {
              prevCount: Object.keys(prev).length,
              mergedCount: Object.keys(merged).length,
            });
          }
          return same ? prev : merged;
        });
      } catch (e) {
        bookPortraitPerfNetwork('resolveBookQrTokensForPreview:error', {
          message: e instanceof Error ? e.message : String(e),
        });
        console.warn('[useBookQrTokenUrls]', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [childId, idsKey, memoryIds, cachedTokens]);

  return tokensByMemoryId;
}

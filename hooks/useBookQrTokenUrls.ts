import { useEffect, useState } from 'react';
import type { BookPage } from '@/src/book/BookEngine';
import { resolveBookQrTokensForPreview } from '@/services/bookQrPreview';

export function useBookQrTokenUrls(childId: string | undefined, pages: BookPage[]): Record<string, string> {
  const [tokensByMemoryId, setTokensByMemoryId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!childId) {
      setTokensByMemoryId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tokens = await resolveBookQrTokensForPreview(childId, pages);
        if (!cancelled) setTokensByMemoryId(tokens);
      } catch (e) {
        console.warn('[useBookQrTokenUrls]', e);
        if (!cancelled) setTokensByMemoryId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, pages]);

  return tokensByMemoryId;
}

import { useEffect, useState } from 'react';
import type { Memory } from '@/types/local';
import { awaitVideoPosterForBookMemory } from '@/services/memoryLocalStore';
import {
  getBookVideoPosterDisplayUri,
  getBookVideoPosterSyncDisplayUri,
  getVideoPosterUriForFeedAndViewer,
  hasCustomVideoPrintPoster,
  getVideoPosterPrintUriForBookPreview,
  isDeviceLocalMediaUri,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import { isLocalMediaUriReadable } from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';

async function resolveRemotePoster(memory: Memory): Promise<string> {
  for (const u of [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (!t || isDeviceLocalMediaUri(t)) continue;
    if (/^https?:\/\//i.test(t)) return normalizeMemoryMediaUriForDisplay(t);
    const signed = (await getSignedMediaDisplayUrl(t)).trim();
    if (signed) return normalizeMemoryMediaUriForDisplay(signed);
  }
  return '';
}

async function readableLocalUri(uri: string): Promise<string> {
  const base = (uri.split('?')[0] ?? uri).trim();
  if (!base || !isDeviceLocalMediaUri(base)) return '';
  if (await isLocalMediaUriReadable(base)) {
    return normalizeMemoryMediaUriForDisplay(uri.trim() || base);
  }
  return '';
}

async function readableLocalBookPosterUri(memory: Memory): Promise<string> {
  if (hasCustomVideoPrintPoster(memory)) {
    const custom = getBookVideoPosterDisplayUri(memory).trim();
    if (custom) {
      const readable = await readableLocalUri(custom);
      if (readable) return custom;
    }
    const customRaw = getVideoPosterPrintUriForBookPreview(memory).trim();
    if (customRaw && !isDeviceLocalMediaUri(customRaw)) return customRaw;
  }
  const feed = getVideoPosterUriForFeedAndViewer(memory).trim();
  if (feed) {
    const readable = await readableLocalUri(feed);
    if (readable) return readable;
  }
  return '';
}

/**
 * Poster vidéo pour la maquette livre.
 * Custom `poster_print` si choisi, sinon poster fil par défaut (`poster.jpg` t≈0).
 */
export function useBookVideoPosterDisplayUrl(memory: Memory): string {
  const syncUri =
    memory.type === 'video' ? getBookVideoPosterSyncDisplayUri(memory).trim() : '';
  const [asyncUri, setAsyncUri] = useState('');

  useEffect(() => {
    if (memory.type !== 'video') {
      setAsyncUri('');
      return;
    }

    let alive = true;
    void (async () => {
      let resolved = await readableLocalBookPosterUri(memory);
      if (!resolved.trim()) {
        resolved = await resolveRemotePoster(memory);
      }
      if (!resolved.trim()) {
        const updated = await awaitVideoPosterForBookMemory(memory.id);
        if (updated) {
          resolved =
            (await readableLocalBookPosterUri(updated)) ||
            getBookVideoPosterSyncDisplayUri(updated).trim() ||
            getVideoPosterUriForFeedAndViewer(updated).trim();
        }
      }
      if (!alive || !resolved.trim()) return;
      setAsyncUri(resolved);
    })();

    return () => {
      alive = false;
    };
  }, [
    memory.id,
    memory.type,
    memory.local_poster_print_path,
    memory.local_thumb_path,
    memory.poster_url,
    memory.poster_print_url,
    memory.thumbnail_url,
    memory.updated_at,
  ]);

  if (memory.type !== 'video') return '';

  if (hasCustomVideoPrintPoster(memory)) {
    const custom = getBookVideoPosterDisplayUri(memory).trim();
    if (custom) return custom;
    return asyncUri.trim() || syncUri;
  }

  return syncUri || asyncUri.trim();
}

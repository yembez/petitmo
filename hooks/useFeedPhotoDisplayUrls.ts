import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import { getAllPhotoUrlsForFeed } from '@/utils/memoryPhotos';
import {
  getFeedLocalThumbnail,
  peekFeedBootstrapDisplayUrls,
  takeFeedBootstrapDisplayUrls,
} from '@/services/feedLocalPhotoCache';
import { getSignedMediaDisplayUrl, primeSignedMediaDisplayUrls, extractMediaBucketPath } from '@/lib/mediaSignedUrl';

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/** Fichier / photothèque / sandbox — pas une URL réseau affichable telle quelle. */
function isLikelyDeviceLocalAsset(u: string): boolean {
  const t = u.trim();
  if (!t || isHttpUrl(t) || t.startsWith('data:')) return false;
  if (
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://')
  ) {
    return true;
  }
  if (t.startsWith('/')) return true;
  return false;
}

async function resolveFeedSlotRemoteUrl(remote: string): Promise<string> {
  const r = remote.trim();
  if (!r || isLikelyDeviceLocalAsset(r)) return r;
  if (isHttpUrl(r) || extractMediaBucketPath(r)) {
    return getSignedMediaDisplayUrl(r);
  }
  return r;
}

function initialMergedForMemory(memory: Memory): string[] {
  if (memory.type !== 'photo') return [];
  const boot = peekFeedBootstrapDisplayUrls(memory.id);
  if (boot?.length) return boot;
  return getAllPhotoUrlsForFeed(memory);
}

/**
 * URLs affichées dans le fil.
 * - Après import : bootstrap = **les mêmes** `previewUris` que la carte « envoi » (évite un reload Image).
 * - Ne remplace pas une URI locale déjà affichée par une autre URI locale (ex. copie sandbox) : même pixels,
 *   autre chemin → RN remontait l’Image (flash court).
 * - Puis : fichier cache disque préféré au **http** pour un slot quand le worker change seulement l’URL.
 */
export function useFeedPhotoDisplayUrls(memory: Memory): string[] {
  const [merged, setMerged] = useState<string[]>(() => initialMergedForMemory(memory));
  const photoIdRef = useRef(memory.id);

  useLayoutEffect(() => {
    if (memory.type !== 'photo') {
      photoIdRef.current = memory.id;
      return;
    }
    if (photoIdRef.current !== memory.id) {
      photoIdRef.current = memory.id;
      setMerged(initialMergedForMemory(memory));
    }
  }, [memory.id, memory.type]);

  useEffect(() => {
    if (memory.type !== 'photo') {
      setMerged([]);
      return;
    }

    const remRaw = getAllPhotoUrlsForFeed(memory);
    let alive = true;
    void (async () => {
      const maxProbe = Math.max(remRaw.length, 6);

      const localPromises: Promise<string>[] = [];
      for (let i = 0; i < maxProbe; i++) {
        if (Platform.OS === 'web') {
          localPromises.push(Promise.resolve(''));
        } else {
          localPromises.push(
            getFeedLocalThumbnail(memory.id, i).then(s => (s?.trim() ? s.trim() : ''))
          );
        }
      }
      const locals = await Promise.all(localPromises);
      if (!alive) return;

      const toPrime: string[] = [];
      for (let i = 0; i < remRaw.length; i++) {
        const raw = remRaw[i]?.trim() || '';
        if (!raw) continue;
        if (locals[i] && Platform.OS !== 'web') continue;
        if (isLikelyDeviceLocalAsset(raw)) continue;
        if (isHttpUrl(raw) || extractMediaBucketPath(raw)) {
          toPrime.push(raw);
        }
      }
      await primeSignedMediaDisplayUrls(toPrime);
      if (!alive) return;

      const rem: string[] = [];
      for (let i = 0; i < remRaw.length; i++) {
        const raw = remRaw[i]?.trim() || '';
        if (!raw) {
          rem.push('');
          continue;
        }
        if (locals[i] && Platform.OS !== 'web') {
          rem.push('');
          continue;
        }
        rem.push(await resolveFeedSlotRemoteUrl(raw));
      }
      if (!alive) return;

      const slots: { remote: string; local: string }[] = [];
      for (let i = 0; i < maxProbe; i++) {
        const remote = (rem[i]?.trim() || '') || '';
        const local = (locals[i]?.trim() || '') || '';
        slots.push({ remote, local });
      }
      if (!alive) return;

      setMerged(prev => {
        const next: string[] = [];
        for (let i = 0; i < maxProbe; i++) {
          const { remote, local } = slots[i] ?? { remote: '', local: '' };
          let chosen = (local || remote || '').trim();
          const prevU = (prev[i]?.trim() || '');
          if (
            prevU &&
            isLikelyDeviceLocalAsset(prevU) &&
            chosen &&
            isLikelyDeviceLocalAsset(chosen) &&
            prevU !== chosen
          ) {
            chosen = prevU;
          }
          if (chosen) next.push(chosen);
          else if (i >= rem.length) break;
        }
        const nextMerged = next.length > 0 ? next : rem;
        if (
          prev.length === nextMerged.length &&
          prev.every((u, j) => u === nextMerged[j])
        ) {
          return prev;
        }
        return nextMerged;
      });
      takeFeedBootstrapDisplayUrls(memory.id);
    })();

    return () => {
      alive = false;
    };
  }, [
    memory.type,
    memory.id,
    memory.local_display_path,
    memory.local_thumb_path,
    memory.local_print_path,
    memory.local_original_path,
    memory.local_media_path,
    memory.thumb_url,
    memory.display_url,
    memory.print_url,
    memory.edited_media_url,
    memory.media_url,
    memory.extra_photo_paths,
    memory.extra_thumb_urls,
    memory.extra_display_urls,
    memory.extra_photo_urls,
    memory.media_path,
  ]);

  return merged;
}

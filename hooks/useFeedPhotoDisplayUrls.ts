import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import { getAllPhotoUrlsForFeed } from '@/utils/memoryPhotos';
import {
  getFeedLocalThumbnail,
  peekFeedBootstrapDisplayUrls,
  takeFeedBootstrapDisplayUrls,
} from '@/services/feedLocalPhotoCache';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';

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
  if (!r || !isHttpUrl(r) || isLikelyDeviceLocalAsset(r)) return r;
  return getSignedMediaDisplayUrl(r);
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
      const rem = await Promise.all(remRaw.map(u => resolveFeedSlotRemoteUrl(u)));
      if (!alive) return;

      const maxProbe = Math.max(rem.length, 6);
      const slots: { remote: string; local: string }[] = [];
      for (let i = 0; i < maxProbe; i++) {
        const remote = (rem[i]?.trim() || '') || '';
        const loc =
          Platform.OS === 'web'
            ? ''
            : ((await getFeedLocalThumbnail(memory.id, i))?.trim() || '');
        const local = loc;
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
    memory.thumb_url,
    memory.display_url,
    memory.extra_thumb_urls,
    memory.extra_display_urls,
  ]);

  return merged;
}

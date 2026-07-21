import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import type { Memory } from '@/types/local';
import { resolveFeedPhotoStableCache } from '@/hooks/feedPhotoStableCache';
import {
  getAllPhotoUrlsForFeed,
  getAllPhotoUrlsForFeedRemoteOnly,
} from '@/utils/memoryPhotos';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  isProbablyStalePetitmoSandboxPath,
} from '@/utils/localMediaReadable';
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

/**
 * Repli cloud uniquement si le fichier sandbox est confirmé absent (réinstall).
 * Sinon on garde l’URI locale — ne pas vider les vignettes sur un faux négatif `getInfoAsync`.
 */
async function maybeSwapDeadSandboxForCloud(
  raw: string,
  cloudFallback: string,
): Promise<string> {
  const t = raw.trim();
  const cloud = cloudFallback.trim();
  if (!t || !isLikelyDeviceLocalAsset(t)) return t;
  if (!isProbablyStalePetitmoSandboxPath(t)) return t;
  const readable = await isLocalMediaUriReadable(t);
  if (readable) return t;
  if (cloud && isCloudMediaReference(cloud)) return cloud;
  return t;
}

function initialMergedForMemory(memory: Memory): string[] {
  if (memory.type !== 'photo') return [];
  const boot = peekFeedBootstrapDisplayUrls(memory.id);
  if (boot?.length) return boot;
  return getAllPhotoUrlsForFeed(memory);
}

function nonEmptyUrls(urls: string[]): string[] {
  return urls.map(u => u.trim()).filter(Boolean);
}

function isSandboxFeedDerivativeUri(u: string): boolean {
  const t = u.trim();
  if (!t) return false;
  return /\/(thumb|display)\.jpe?g(\?|$)/i.test(t) || /\/petitmo_memories\/[^/]+\/thumb\.jpe?g/i.test(t);
}

/**
 * URLs affichées dans le fil — local-first (`getAllPhotoUrlsForFeed`).
 * Passe async : cache fil disque, signature cloud, repli réinstall si fichier sandbox confirmé mort.
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

    let alive = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const remRaw = getAllPhotoUrlsForFeed(memory);
        /** Ne pas sonder 6 slots vides (rafale getInfoAsync) pour une mono-photo. */
        const maxProbe = Math.max(remRaw.length, 1);

        const localPromises: Promise<string>[] = [];
        for (let i = 0; i < maxProbe; i++) {
          if (Platform.OS === 'web') {
            localPromises.push(Promise.resolve(''));
          } else {
            localPromises.push(
              getFeedLocalThumbnail(memory.id, i).then(s => (s?.trim() ? s.trim() : '')),
            );
          }
        }
        const locals = await Promise.all(localPromises);
        if (!alive) return;

        const localsVerified: string[] = [];
        for (let i = 0; i < locals.length; i++) {
          const L = locals[i]?.trim() || '';
          if (!L || Platform.OS === 'web') {
            localsVerified.push('');
            continue;
          }
          localsVerified.push((await isLocalMediaUriReadable(L)) ? L : '');
        }
        if (!alive) return;

        const remoteOnly = getAllPhotoUrlsForFeedRemoteOnly(memory);
        const resolvedRaw: string[] = [];
        for (let i = 0; i < remRaw.length; i++) {
          const rawIn = remRaw[i]?.trim() || '';
          const cloudOnly = (remoteOnly[i]?.trim() ?? '').trim();
          const raw = await maybeSwapDeadSandboxForCloud(rawIn, cloudOnly);
          resolvedRaw.push(raw);
        }
        if (!alive) return;

        const toPrime: string[] = [];
        for (let i = 0; i < resolvedRaw.length; i++) {
          const raw = resolvedRaw[i]?.trim() || '';
          if (!raw) continue;
          if (isSandboxFeedDerivativeUri(raw)) continue;
          if (localsVerified[i] && Platform.OS !== 'web') continue;
          if (isLikelyDeviceLocalAsset(raw)) continue;
          if (isHttpUrl(raw) || extractMediaBucketPath(raw)) {
            toPrime.push(raw);
          }
        }
        await primeSignedMediaDisplayUrls(toPrime);
        if (!alive) return;

        const rem: string[] = [];
        for (let i = 0; i < maxProbe; i++) {
          const raw = (resolvedRaw[i]?.trim() || '') || '';
          if (!raw) {
            rem.push('');
            continue;
          }
          /** Thumb/display sandbox gagne toujours sur le cache fil (anciens originaux plein format). */
          if (isSandboxFeedDerivativeUri(raw)) {
            rem.push(await resolveFeedSlotRemoteUrl(raw));
            continue;
          }
          if (localsVerified[i] && Platform.OS !== 'web') {
            rem.push('');
            continue;
          }
          rem.push(await resolveFeedSlotRemoteUrl(raw));
        }
        if (!alive) return;

        const slots: { remote: string; local: string }[] = [];
        for (let i = 0; i < maxProbe; i++) {
          const remote = (rem[i]?.trim() || '') || '';
          const local = (localsVerified[i]?.trim() || '') || '';
          slots.push({ remote, local });
        }
        if (!alive) return;

        setMerged(prev => {
          const next: string[] = [];
          for (let i = 0; i < maxProbe; i++) {
            const { remote, local } = slots[i] ?? { remote: '', local: '' };
            /** Préférer dérivé sandbox (480/1400) au cache fil éventuellement plein format. */
            let chosen = (remote || local || '').trim();
            if (remote && local && isSandboxFeedDerivativeUri(remote)) {
              chosen = remote;
            }
            const prevU = (prev[i]?.trim() || '');
            if (
              prevU &&
              isLikelyDeviceLocalAsset(prevU) &&
              chosen &&
              isLikelyDeviceLocalAsset(chosen) &&
              prevU !== chosen &&
              !isSandboxFeedDerivativeUri(chosen)
            ) {
              chosen = prevU;
            }
            if (chosen) next.push(chosen);
            else if (i >= remRaw.length) break;
          }
          const fromSlots = nonEmptyUrls(next);
          const fromRem = nonEmptyUrls(rem);
          const fromSync = nonEmptyUrls(remRaw);
          const nextMerged =
            fromSlots.length > 0
              ? fromSlots
              : fromRem.length > 0
                ? fromRem
                : fromSync.length > 0
                  ? fromSync
                  : nonEmptyUrls(prev);
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
    });

    return () => {
      alive = false;
      task.cancel();
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

  return merged.map((u, i) => resolveFeedPhotoStableCache(`${memory.id}:${i}`, u));
}

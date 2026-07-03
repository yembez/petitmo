import { useLayoutEffect, useState } from 'react';
import type { Memory } from '@/types/local';
import { getVideoPosterUriForFeedAndViewer, normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  isProbablyStalePetitmoSandboxPath,
} from '@/utils/localMediaReadable';
import {
  extractMediaBucketPath,
  getSignedMediaDisplayUrl,
  peekSignedMediaDisplayUrl,
  useSignedMediaUrl,
} from '@/lib/mediaSignedUrl';

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

function isLikelyDeviceLocalAsset(u: string): boolean {
  const t = u.trim();
  if (!t || isHttpUrl(t) || t.startsWith('data:')) return false;
  return (
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://') ||
    t.startsWith('/')
  );
}

function remoteVideoPosterCandidates(memory: Memory): string {
  return [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]
    .map(u => (u ?? '').trim())
    .find(Boolean) ?? '';
}

async function resolveFeedPosterRemoteUrl(remote: string): Promise<string> {
  const r = remote.trim();
  if (!r || isLikelyDeviceLocalAsset(r)) return r;
  if (isHttpUrl(r) || extractMediaBucketPath(r)) {
    return getSignedMediaDisplayUrl(r);
  }
  return r;
}

async function maybeSwapDeadSandboxForCloud(raw: string, cloudFallback: string): Promise<string> {
  const t = raw.trim();
  const cloud = cloudFallback.trim();
  if (!t || !isLikelyDeviceLocalAsset(t)) return t;
  if (!isProbablyStalePetitmoSandboxPath(t)) return t;
  if (await isLocalMediaUriReadable(t)) return t;
  if (cloud && isCloudMediaReference(cloud)) return cloud;
  return t;
}

function initialPosterUri(memory: Memory, remote: string): string {
  const cached = remote ? peekSignedMediaDisplayUrl(remote) : null;
  if (cached?.trim()) return cached.trim();
  const sync = getVideoPosterUriForFeedAndViewer(memory).trim();
  if (sync) return sync;
  return remote.trim();
}

/**
 * Poster vidéo affichable (fil, favoris, viewer) — parité `useFeedPhotoDisplayUrls` :
 * sandbox lisible d’abord, sinon repli cloud signé.
 */
export function useFeedVideoPosterDisplayUrl(memory: Memory): string {
  const remote = remoteVideoPosterCandidates(memory);
  const syncRaw = getVideoPosterUriForFeedAndViewer(memory);

  const [resolved, setResolved] = useState(() => initialPosterUri(memory, remote));

  useLayoutEffect(() => {
    if (memory.type !== 'video') return;
    let cancelled = false;
    void (async () => {
      const swapped = await maybeSwapDeadSandboxForCloud(syncRaw, remote);
      const picked = (swapped.trim() || remote.trim()).trim();
      if (!picked) return;
      const signed = await resolveFeedPosterRemoteUrl(picked);
      if (!cancelled && signed.trim()) {
        setResolved(prev => (prev === signed.trim() ? prev : signed.trim()));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memory.id, memory.type, memory.updated_at, syncRaw, remote]);

  const hookSigned = useSignedMediaUrl(
    memory.type === 'video' && (resolved || remote) ? resolved || remote : null,
  );

  const raw = (hookSigned ?? resolved ?? remote).trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

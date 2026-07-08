import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import type { Memory } from '@/types/local';
import {
  getVideoPosterUriForFeedAndViewer,
  getVoiceCoverUriForBookPreview,
  getVoiceCoverUriForFeedAndViewer,
} from '@/utils/memoryPhotos';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  isProbablyStalePetitmoSandboxPath,
} from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl, extractMediaBucketPath } from '@/lib/mediaSignedUrl';

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

async function resolveCloudDisplayUrl(raw: string): Promise<string> {
  const t = raw.trim();
  if (!t) return '';
  if (isHttpUrl(t) || extractMediaBucketPath(t)) {
    return (await getSignedMediaDisplayUrl(t)) ?? t;
  }
  return t;
}

async function resolveRasterUri(raw: string, cloudFallback: string): Promise<string> {
  const t = raw.trim();
  const cloud = cloudFallback.trim();
  if (!t) return cloud ? resolveCloudDisplayUrl(cloud) : '';
  if (isCloudMediaReference(t)) return resolveCloudDisplayUrl(t);
  if (!isProbablyStalePetitmoSandboxPath(t)) return t;
  const readable = await isLocalMediaUriReadable(t);
  if (readable) return t;
  if (cloud && isCloudMediaReference(cloud)) return resolveCloudDisplayUrl(cloud);
  return t;
}

function remoteVideoPosterCandidates(memory: Memory): string {
  return [memory.poster_url, memory.thumbnail_url]
    .map(u => (u ?? '').trim())
    .find(Boolean) ?? '';
}

function remoteVoiceCoverCandidates(memory: Memory, forBook: boolean): string {
  if (forBook) return (memory.voice_cover_url ?? '').trim();
  return (memory.voice_cover_url ?? '').trim();
}

/**
 * Poster vidéo ou cover audio — local-first avec repli cloud si sandbox mort (parité `useFeedPhotoDisplayUrls`).
 */
export function useFeedRasterMediaUrl(
  memory: Memory,
  kind: 'video-poster' | 'voice-cover' | 'voice-cover-book',
): string {
  const syncRaw =
    kind === 'video-poster'
      ? getVideoPosterUriForFeedAndViewer(memory)
      : kind === 'voice-cover-book'
        ? getVoiceCoverUriForBookPreview(memory)
        : getVoiceCoverUriForFeedAndViewer(memory);

  const cloudFallback =
    kind === 'video-poster'
      ? remoteVideoPosterCandidates(memory)
      : remoteVoiceCoverCandidates(memory, kind === 'voice-cover-book');

  const [uri, setUri] = useState(syncRaw.trim() || cloudFallback);

  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const resolved = await resolveRasterUri(syncRaw, cloudFallback);
        if (!cancelled && resolved.trim()) setUri(resolved.trim());
      })();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [memory.id, memory.updated_at, syncRaw, cloudFallback]);

  return uri.trim() || syncRaw.trim() || cloudFallback;
}

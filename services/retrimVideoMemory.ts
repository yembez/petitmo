import {
  copyAsync,
  documentDirectory,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { getCachedUserMode } from '@/lib/userMode';
import type { Memory } from '@/types/local';
import { persistFeedLocalVideo, setFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import { persistDefaultVideoPostersAtImport } from '@/services/videoPosterLocal';
import {
  ensureVideoFileUri,
  trimVideoClipToLocalFile,
  VideoTrimNativeMissingError,
} from '@/services/videoTrimNative';
import { resolveReadableVideoPlaybackUri } from '@/utils/videoMediaUri';
import { emitMemoriesUpdatedIfVisualChanged } from '@/services/memoriesUiNotify';
import { replacePooledVideoUri } from '@/lib/videoPlayerPool';
import { setFeedAutoplayActiveMemoryId } from '@/lib/feedAutoplayStore';

export { VideoTrimNativeMissingError };

/**
 * Résout l’URI **originale** (rush) pour re-trim — pas l’extrait courant.
 */
export async function resolveVideoOriginalUriForRetrim(memory: Memory): Promise<string> {
  const original = (memory.local_original_path ?? '').trim();
  if (original) {
    const fromOriginal = await resolveReadableVideoPlaybackUri({
      ...memory,
      local_media_path: null,
      edited_media_url: null,
      media_url: null,
      local_original_path: original,
    });
    if (fromOriginal) return fromOriginal;
  }
  return resolveReadableVideoPlaybackUri(memory);
}

async function copyIntoMemorySandbox(
  memoryId: string,
  fromUri: string,
  fileName: string,
): Promise<string> {
  if (!documentDirectory) return ensureVideoFileUri(fromUri);
  const dir = `${documentDirectory}petitmo_memories/${memoryId}/`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${fileName}`;
  await copyAsync({ from: ensureVideoFileUri(fromUri), to: dest });
  return dest;
}

/**
 * Local-first : coupe un nouvel extrait depuis l’original, met à jour SQLite,
 * régénère posters, enqueue sync cloud. L’original reste dans `local_original_path`.
 */
export async function retrimVideoMemoryFromOriginal(params: {
  memoryId: string;
  startSec: number;
  endSec: number;
}): Promise<Memory> {
  const prev = getLocalMemoryById(params.memoryId);
  if (!prev || prev.type !== 'video') {
    throw new Error('memory_not_video');
  }

  const originalUri = await resolveVideoOriginalUriForRetrim(prev);
  if (!originalUri) throw new Error('original_unreadable');

  const clip = await trimVideoClipToLocalFile({
    inputUri: originalUri,
    startSec: params.startSec,
    endSec: params.endSec,
  });

  let sandboxOriginal = (prev.local_original_path ?? '').trim();
  if (!sandboxOriginal) {
    try {
      sandboxOriginal = await copyIntoMemorySandbox(prev.id, originalUri, 'original.mp4');
    } catch {
      sandboxOriginal = ensureVideoFileUri(originalUri);
    }
  }

  let sandboxClip = ensureVideoFileUri(clip.uri);
  try {
    sandboxClip = await copyIntoMemorySandbox(prev.id, clip.uri, `clip_${Date.now()}.mp4`);
  } catch {
    /* garde l’URI trim native */
  }

  let feedClip = sandboxClip;
  try {
    const feedPath = await persistFeedLocalVideo(prev.id, sandboxClip);
    if (feedPath?.trim()) feedClip = feedPath.trim();
  } catch (e) {
    console.warn('[retrimVideoMemory] feed video', e);
  }

  const mode = await getCachedUserMode();
  const next: Memory = {
    ...prev,
    local_original_path: sandboxOriginal,
    local_media_path: feedClip,
    duration: clip.durationSec,
    video_playback_start_sec: params.startSec,
    video_playback_end_sec: params.endSec,
    media_url: null,
    media_path: null,
    edited_media_url: null,
    upload_status: 'pending',
    sync_status: mode === 'local' ? 'local' : 'pending',
    updated_at: new Date().toISOString(),
  };
  upsertLocalMemory(next);

  setFeedBootstrapVideoUri(next.id, feedClip);
  replacePooledVideoUri(next.id, feedClip);
  setFeedAutoplayActiveMemoryId(next.id, 'video-retrim');

  try {
    await persistDefaultVideoPostersAtImport({
      memoryId: next.id,
      videoUri: feedClip,
      timeMs: 0,
    });
  } catch (e) {
    console.warn('[retrimVideoMemory] posters', e);
  }

  const fresh = getLocalMemoryById(next.id) ?? next;
  emitMemoriesUpdatedIfVisualChanged(fresh.id, prev);

  if (mode === 'cloud') {
    void (async () => {
      try {
        const { ensureMemoryUploadedForCloud } = await import('@/services/migration');
        await ensureMemoryUploadedForCloud(fresh, { forceCloud: true });
      } catch (e) {
        console.warn('[retrimVideoMemory] cloud sync', e);
      }
    })();
  }

  return getLocalMemoryById(next.id) ?? fresh;
}

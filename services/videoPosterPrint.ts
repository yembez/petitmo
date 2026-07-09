import { Platform, DeviceEventEmitter } from 'react-native';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { Memory } from '@/types/local';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { resolveReadableVideoPlaybackUri } from '@/utils/videoMediaUri';
import { invalidateBookVideoPosterStableCache } from '@/hooks/bookVideoPosterStableCache';
import { getVideoPosterPrintUriForBookPreview } from '@/utils/memoryPhotos';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extrait une frame vidéo et persiste `poster_print.jpg` (impression livre).
 * Local-first : écriture sandbox + SQLite immédiate ; le fil garde `poster.jpg` (t≈0).
 */
export async function persistVideoPosterPrintAtTimeMs(
  memoryId: string,
  timeMs: number,
  opts?: { videoUri?: string; settleMs?: number },
): Promise<Memory | null> {
  const id = memoryId.trim();
  if (!id) return null;
  const cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'video') return cur ?? null;
  if (Platform.OS === 'web') return cur;

  const videoUri =
    (opts?.videoUri ?? '').trim() || (await resolveReadableVideoPlaybackUri(cur));
  if (!videoUri) return null;

  const durationMs =
    typeof cur.duration === 'number' && Number.isFinite(cur.duration) && cur.duration > 0
      ? Math.floor(cur.duration * 1000)
      : null;
  const clampedMs =
    durationMs != null
      ? Math.max(0, Math.min(Math.round(timeMs), Math.max(0, durationMs - 16)))
      : Math.max(0, Math.round(timeMs));

  try {
    await sleep(opts?.settleMs ?? 160);
    const { uri: thumbTmp } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: clampedMs,
      quality: 0.92,
    });
    if (!thumbTmp?.trim() || !documentDirectory) return null;

    const dir = `${documentDirectory}petitmo_memories/${id}/`;
    await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const dest = `${dir}poster_print.jpg`;
    await copyAsync({ from: thumbTmp, to: dest });

    const now = new Date().toISOString();
    const next: Memory = {
      ...cur,
      local_poster_print_path: dest,
      poster_print_url: dest,
      updated_at: now,
    };
    upsertLocalMemory(next);
    invalidateBookVideoPosterStableCache(id);
    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    return next;
  } catch (e) {
    console.warn('[videoPosterPrint] persistVideoPosterPrintAtTimeMs', id, e);
    return null;
  }
}

/** URI locale immédiate pour l’aperçu livre (poster print si présent). */
export function peekBookVideoPosterPrintUri(memory: Memory): string {
  return getVideoPosterPrintUriForBookPreview(memory).trim();
}

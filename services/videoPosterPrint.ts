import { Platform, DeviceEventEmitter } from 'react-native';
import type { Memory } from '@/types/local';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { resolveReadableVideoPlaybackUri } from '@/utils/videoMediaUri';
import { invalidateBookVideoPosterStableCache, setBookVideoPosterStableCache } from '@/hooks/bookVideoPosterStableCache';
import { getVideoPosterPrintUriForBookPreview, getBookVideoPosterDisplayUri } from '@/utils/memoryPhotos';
import { persistVideoPosterFiles } from '@/services/videoPosterLocal';
import { VIDEO_POSTER_PRINT_JPEG_QUALITY } from '@/lib/limits';

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
    const { printPath, printPx } = await persistVideoPosterFiles({
      memoryId: id,
      videoUri,
      timeMs: clampedMs,
      writeFeed: false,
      writePrint: true,
      quality: VIDEO_POSTER_PRINT_JPEG_QUALITY,
      settleMs: opts?.settleMs ?? 160,
    });
    if (!printPath || !printPx) {
      console.warn('[videoPosterPrint] no printPath after extract', id, clampedMs);
      return null;
    }

    // Relecture SQLite : un backfill concurrent peut avoir touché la row pendant l’extract.
    const latest = getLocalMemoryById(id) ?? cur;
    const now = new Date().toISOString();
    const next: Memory = {
      ...latest,
      local_poster_print_path: printPath,
      poster_print_url: printPath,
      print_px_w: printPx.w,
      print_px_h: printPx.h,
      updated_at: now,
    };
    upsertLocalMemory(next);
    invalidateBookVideoPosterStableCache(id);
    const displayUri = getBookVideoPosterDisplayUri(next).trim() || printPath;
    setBookVideoPosterStableCache(id, displayUri);
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

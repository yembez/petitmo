import { Platform, DeviceEventEmitter, Image } from 'react-native';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { Memory } from '@/types/local';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import {
  MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
  VIDEO_POSTER_FEED_JPEG_QUALITY,
  VIDEO_POSTER_PRINT_JPEG_QUALITY,
} from '@/lib/limits';
import { resolveReadableVideoPlaybackUri } from '@/utils/videoMediaUri';
import {
  collectVideoFeedPosterLocalUriCandidates,
  getBookVideoPosterDisplayUri,
} from '@/utils/memoryPhotos';
import {
  isLocalMediaUriReadable,
  pickFirstReadableLocalMediaUri,
} from '@/utils/localMediaReadable';
import {
  invalidateBookVideoPosterStableCache,
  setBookVideoPosterStableCache,
} from '@/hooks/bookVideoPosterStableCache';

/** Long côté mini pour considérer le print « cible livre » (parité photos 3200 px). */
const PRINT_TARGET_MIN_LONG_SIDE = Math.floor(MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH * 0.9);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureMemoryDir(memoryId: string): Promise<string | null> {
  if (!documentDirectory) return null;
  const dir = `${documentDirectory}petitmo_memories/${memoryId.trim()}/`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  return dir;
}

async function getJpegPx(uri: string): Promise<{ w: number; h: number } | null> {
  const src = uri.trim();
  if (!src) return null;
  return await new Promise(resolve => {
    Image.getSize(
      src,
      (w, h) => resolve(w > 0 && h > 0 ? { w, h } : null),
      () => resolve(null),
    );
  });
}

/**
 * Dérivé print livre : même pipeline que `print.jpg` / `voice_cover_print.jpg`
 * (resize largeur → 3200 px). Une frame 1080p native ≈ 147 DPI sur 186 mm ;
 * après upscale le badge dépasse 240 DPI (parité photos).
 */
async function writePrintPosterAtBookWidth(
  srcJpegUri: string,
  destPath: string,
): Promise<string | null> {
  const src = srcJpegUri.trim();
  if (!src) return null;
  try {
    const print = await ImageManipulator.manipulateAsync(
      src,
      [{ resize: { width: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
    );
    await copyAsync({ from: print.uri, to: destPath });
    return destPath;
  } catch {
    try {
      await copyAsync({ from: src, to: destPath });
      return destPath;
    } catch {
      return null;
    }
  }
}

async function printPosterMeetsBookTarget(uri: string): Promise<boolean> {
  const px = await getJpegPx(uri);
  if (!px) return false;
  return Math.max(px.w, px.h) >= PRINT_TARGET_MIN_LONG_SIDE;
}

/**
 * Extrait une frame JPEG via `expo-video-thumbnails`.
 * `quality` = compression JPEG (0–1) — la résolution suit la frame native.
 */
export async function extractVideoFrameJpeg(
  videoUri: string,
  opts?: { timeMs?: number; quality?: number },
): Promise<string | null> {
  const src = videoUri.trim();
  if (!src || Platform.OS === 'web') return null;
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(src, {
      time: Math.max(0, Math.round(opts?.timeMs ?? 0)),
      quality: opts?.quality ?? VIDEO_POSTER_PRINT_JPEG_QUALITY,
    });
    return uri?.trim() || null;
  } catch {
    return null;
  }
}

export type PersistVideoPostersResult = {
  feedPath: string | null;
  printPath: string | null;
};

/**
 * Écrit `poster.jpg` (fil, frame native) et/ou `poster_print.jpg` (livre, 3200 px).
 */
export async function persistVideoPosterFiles(params: {
  memoryId: string;
  videoUri: string;
  timeMs?: number;
  writeFeed?: boolean;
  writePrint?: boolean;
  /** Qualité JPEG pour l’extraction (défaut = print HQ). */
  quality?: number;
  settleMs?: number;
}): Promise<PersistVideoPostersResult> {
  const id = params.memoryId.trim();
  const writeFeed = params.writeFeed !== false;
  const writePrint = params.writePrint !== false;
  const empty: PersistVideoPostersResult = { feedPath: null, printPath: null };
  if (!id || (!writeFeed && !writePrint)) return empty;
  if (Platform.OS === 'web') return empty;

  if (params.settleMs && params.settleMs > 0) await sleep(params.settleMs);

  const thumbTmp = await extractVideoFrameJpeg(params.videoUri, {
    timeMs: params.timeMs,
    quality: params.quality ?? VIDEO_POSTER_PRINT_JPEG_QUALITY,
  });
  if (!thumbTmp) return empty;

  const dir = await ensureMemoryDir(id);
  if (!dir) return empty;

  let feedPath: string | null = null;
  let printPath: string | null = null;

  if (writeFeed) {
    const dest = `${dir}poster.jpg`;
    try {
      await copyAsync({ from: thumbTmp, to: dest });
      feedPath = dest;
    } catch {
      feedPath = null;
    }
  }

  if (writePrint) {
    const dest = `${dir}poster_print.jpg`;
    printPath = await writePrintPosterAtBookWidth(thumbTmp, dest);
  }

  return { feedPath, printPath };
}

/** Import / capture : génère fil + print livre (3200 px) d’un coup. */
export async function persistDefaultVideoPostersAtImport(params: {
  memoryId: string;
  videoUri: string;
  timeMs?: number;
}): Promise<PersistVideoPostersResult> {
  return persistVideoPosterFiles({
    ...params,
    writeFeed: true,
    writePrint: true,
    quality: VIDEO_POSTER_PRINT_JPEG_QUALITY,
  });
}

function applyPosterFields(
  cur: Memory,
  paths: { feedPath?: string | null; printPath?: string | null },
): Memory {
  return {
    ...cur,
    ...(paths.feedPath
      ? {
          local_thumb_path: paths.feedPath,
          poster_url: paths.feedPath,
          thumbnail_url: paths.feedPath,
        }
      : {}),
    ...(paths.printPath
      ? {
          local_poster_print_path: paths.printPath,
          poster_print_url: paths.printPath,
        }
      : {}),
    updated_at: new Date().toISOString(),
  };
}

function commitPosterMemory(next: Memory): Memory {
  upsertLocalMemory(next);
  invalidateBookVideoPosterStableCache(next.id);
  const displayUri =
    getBookVideoPosterDisplayUri(next).trim() ||
    (next.local_poster_print_path ?? '').trim() ||
    (next.poster_url ?? '').trim();
  if (displayUri) setBookVideoPosterStableCache(next.id, displayUri);
  DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: next.id });
  return next;
}

/**
 * Garantit un `poster_print.jpg` à largeur livre (3200 px).
 * - Print absent → extrait frame + upscale
 * - Print trop petit (ex. 1080p / 147 DPI) → upscale sur place (conserve la frame choisie)
 */
export async function ensureVideoPosterPrintForBookMemory(
  memoryId: string,
): Promise<Memory | null> {
  const id = memoryId.trim();
  const cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'video') return cur;
  if (Platform.OS === 'web') return cur;

  const existingPrint =
    (cur.local_poster_print_path ?? '').trim() ||
    ((cur.poster_print_url ?? '').trim().includes('poster_print')
      ? (cur.poster_print_url ?? '').trim()
      : '');

  if (existingPrint && (await isLocalMediaUriReadable(existingPrint))) {
    if (await printPosterMeetsBookTarget(existingPrint)) return cur;

    const dir = await ensureMemoryDir(id);
    const dest = dir ? `${dir}poster_print.jpg` : existingPrint;
    const printPath = await writePrintPosterAtBookWidth(existingPrint, dest);
    if (!printPath) return cur;
    return commitPosterMemory(applyPosterFields(cur, { printPath }));
  }

  if (
    existingPrint &&
    /^https?:\/\//i.test(existingPrint) &&
    !existingPrint.includes('file:')
  ) {
    return cur;
  }

  const videoUri = await resolveReadableVideoPlaybackUri(cur);
  if (!videoUri) {
    const feed = await pickFirstReadableLocalMediaUri(
      collectVideoFeedPosterLocalUriCandidates(cur),
    );
    if (!feed) return cur;
    const dir = await ensureMemoryDir(id);
    if (!dir) {
      return commitPosterMemory(
        applyPosterFields(cur, { feedPath: feed }),
      );
    }
    const printPath = await writePrintPosterAtBookWidth(feed, `${dir}poster_print.jpg`);
    return commitPosterMemory(
      applyPosterFields(cur, { feedPath: feed, printPath }),
    );
  }

  const { feedPath, printPath } = await persistVideoPosterFiles({
    memoryId: id,
    videoUri,
    timeMs: 0,
    writeFeed: true,
    writePrint: true,
    quality: VIDEO_POSTER_PRINT_JPEG_QUALITY,
  });

  if (!feedPath && !printPath) return cur;
  return commitPosterMemory(applyPosterFields(cur, { feedPath, printPath }));
}

/** Poster fil seul (qualité un peu plus légère) — chemins legacy. */
export async function extractVideoFeedPosterJpeg(videoUri: string, timeMs = 0): Promise<string | null> {
  return extractVideoFrameJpeg(videoUri, {
    timeMs,
    quality: VIDEO_POSTER_FEED_JPEG_QUALITY,
  });
}

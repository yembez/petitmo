import { Platform, DeviceEventEmitter, Image } from 'react-native';
import { copyAsync, deleteAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
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

/** iOS : AVFoundation échoue parfois si le fichier est encore verrouillé (expo-av / retry). */
async function extractVideoFrameJpegOnce(
  videoUri: string,
  timeMs: number,
  quality: number,
): Promise<string | null> {
  const src = videoUri.trim();
  if (!src || Platform.OS === 'web') return null;
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(src, {
      time: Math.max(0, Math.round(timeMs)),
      quality,
    });
    return uri?.trim() || null;
  } catch (e) {
    console.warn('[videoPosterLocal] getThumbnailAsync failed', Math.round(timeMs), e);
    return null;
  }
}

async function ensureMemoryDir(memoryId: string): Promise<string | null> {
  if (!documentDirectory) return null;
  const dir = `${documentDirectory}petitmo_memories/${memoryId.trim()}/`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  return dir;
}

/** Décode le JPEG (pas `Image.getSize` : cache natif périmé si le fichier est réécrit au même chemin). */
async function getJpegPxReliable(uri: string): Promise<{ w: number; h: number } | null> {
  const src = uri.trim().replace(/[?&]petitmo_v=[^&]*/gi, '').replace(/[?&]$/, '');
  if (!src) return null;
  try {
    const decoded = await ImageManipulator.manipulateAsync(src, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (decoded.width > 0 && decoded.height > 0) {
      return { w: decoded.width, h: decoded.height };
    }
  } catch {
    /* fallback RN */
  }
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
async function replaceFileAtomically(fromUri: string, destPath: string): Promise<boolean> {
  const from = fromUri.trim();
  const dest = destPath.trim();
  if (!from || !dest) return false;
  const tmp = `${dest}.tmp`;
  try {
    await deleteAsync(tmp, { idempotent: true }).catch(() => {});
    await copyAsync({ from, to: tmp });
    await deleteAsync(dest, { idempotent: true }).catch(() => {});
    await copyAsync({ from: tmp, to: dest });
    await deleteAsync(tmp, { idempotent: true }).catch(() => {});
    return true;
  } catch {
    try {
      await deleteAsync(dest, { idempotent: true }).catch(() => {});
      await copyAsync({ from, to: dest });
      await deleteAsync(tmp, { idempotent: true }).catch(() => {});
      return true;
    } catch {
      await deleteAsync(tmp, { idempotent: true }).catch(() => {});
      return false;
    }
  }
}

export type VideoPrintPosterWrite = { path: string; w: number; h: number };

/**
 * Upscale → 3200 px. Pas de fallback frame native (sinon badge ~147 DPI puis flash à ~400+).
 */
async function writePrintPosterAtBookWidth(
  srcJpegUri: string,
  destPath: string,
): Promise<VideoPrintPosterWrite | null> {
  const src = srcJpegUri.trim();
  if (!src) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(100 * attempt);
    try {
      const print = await ImageManipulator.manipulateAsync(
        src,
        [{ resize: { width: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      const manipW = print.width ?? 0;
      const manipH = print.height ?? 0;
      if (Math.max(manipW, manipH) < PRINT_TARGET_MIN_LONG_SIDE) continue;
      if (!(await replaceFileAtomically(print.uri, destPath))) continue;
      const onDisk = await getJpegPxReliable(destPath);
      const w = onDisk?.w ?? manipW;
      const h = onDisk?.h ?? manipH;
      if (Math.max(w, h) >= PRINT_TARGET_MIN_LONG_SIDE) {
        return { path: destPath, w, h };
      }
    } catch (e) {
      console.warn('[videoPosterLocal] writePrintPosterAtBookWidth attempt', attempt, e);
    }
  }
  console.warn('[videoPosterLocal] writePrintPosterAtBookWidth failed book target', destPath);
  return null;
}

async function printPosterMeetsBookTarget(uri: string): Promise<boolean> {
  const px = await getJpegPxReliable(uri);
  if (!px) return false;
  return Math.max(px.w, px.h) >= PRINT_TARGET_MIN_LONG_SIDE;
}

/**
 * Extrait une frame JPEG via `expo-video-thumbnails`.
 * `quality` = compression JPEG (0–1) — la résolution suit la frame native.
 * Retries + offsets de temps : iOS échoue souvent si AVPlayer tient encore le fichier.
 */
export async function extractVideoFrameJpeg(
  videoUri: string,
  opts?: { timeMs?: number; quality?: number },
): Promise<string | null> {
  const src = videoUri.trim();
  if (!src || Platform.OS === 'web') return null;
  const quality = opts?.quality ?? VIDEO_POSTER_PRINT_JPEG_QUALITY;
  const baseMs = Math.max(0, Math.round(opts?.timeMs ?? 0));
  const timeCandidates = [
    baseMs,
    Math.max(0, baseMs - 40),
    baseMs + 40,
    Math.max(0, baseMs - 120),
  ];
  const seen = new Set<number>();
  for (let attempt = 0; attempt < timeCandidates.length; attempt++) {
    const t = timeCandidates[attempt]!;
    if (seen.has(t)) continue;
    seen.add(t);
    if (attempt > 0) await sleep(120 + attempt * 80);
    const uri = await extractVideoFrameJpegOnce(src, t, quality);
    if (uri) return uri;
  }
  return null;
}

export type PersistVideoPostersResult = {
  feedPath: string | null;
  printPath: string | null;
  printPx: { w: number; h: number } | null;
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
  const empty: PersistVideoPostersResult = { feedPath: null, printPath: null, printPx: null };
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
  let printPx: { w: number; h: number } | null = null;

  if (writeFeed) {
    const dest = `${dir}poster.jpg`;
    feedPath = (await replaceFileAtomically(thumbTmp, dest)) ? dest : null;
  }

  if (writePrint) {
    const dest = `${dir}poster_print.jpg`;
    const written = await writePrintPosterAtBookWidth(thumbTmp, dest);
    if (written) {
      printPath = written.path;
      printPx = { w: written.w, h: written.h };
    }
  }

  return { feedPath, printPath, printPx };
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
  paths: {
    feedPath?: string | null;
    printPath?: string | null;
    printPx?: { w: number; h: number } | null;
  },
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
    ...(paths.printPx && paths.printPx.w > 0 && paths.printPx.h > 0
      ? {
          print_px_w: paths.printPx.w,
          print_px_h: paths.printPx.h,
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
    const meets = await printPosterMeetsBookTarget(existingPrint);
    const hasPx =
      typeof cur.print_px_w === 'number' &&
      typeof cur.print_px_h === 'number' &&
      cur.print_px_w > 0 &&
      cur.print_px_h > 0 &&
      Math.max(cur.print_px_w, cur.print_px_h) >= PRINT_TARGET_MIN_LONG_SIDE;
    if (meets && hasPx) return cur;
    if (meets && !hasPx) {
      const px = await getJpegPxReliable(existingPrint);
      if (px) {
        return commitPosterMemory(applyPosterFields(cur, { printPath: existingPrint, printPx: px }));
      }
      return cur;
    }

    const dir = await ensureMemoryDir(id);
    const dest = dir ? `${dir}poster_print.jpg` : existingPrint;
    const written = await writePrintPosterAtBookWidth(existingPrint, dest);
    if (!written) return cur;
    return commitPosterMemory(
      applyPosterFields(cur, { printPath: written.path, printPx: { w: written.w, h: written.h } }),
    );
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
    const written = await writePrintPosterAtBookWidth(feed, `${dir}poster_print.jpg`);
    return commitPosterMemory(
      applyPosterFields(cur, {
        feedPath: feed,
        printPath: written?.path ?? null,
        printPx: written ? { w: written.w, h: written.h } : null,
      }),
    );
  }

  const { feedPath, printPath, printPx } = await persistVideoPosterFiles({
    memoryId: id,
    videoUri,
    timeMs: 0,
    writeFeed: true,
    writePrint: true,
    quality: VIDEO_POSTER_PRINT_JPEG_QUALITY,
  });

  if (!feedPath && !printPath) return cur;
  return commitPosterMemory(applyPosterFields(cur, { feedPath, printPath, printPx }));
}

/** Poster fil seul (qualité un peu plus légère) — chemins legacy. */
export async function extractVideoFeedPosterJpeg(videoUri: string, timeMs = 0): Promise<string | null> {
  return extractVideoFrameJpeg(videoUri, {
    timeMs,
    quality: VIDEO_POSTER_FEED_JPEG_QUALITY,
  });
}

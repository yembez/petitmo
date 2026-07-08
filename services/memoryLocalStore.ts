import { DeviceEventEmitter, Platform, Image } from 'react-native';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } from '@/lib/limits';
import type { Memory } from '@/types/local';
import {
  collectVideoCloudSyncUriCandidates,
  collectVideoFeedPosterLocalUriCandidates,
  collectVoiceCoverReadableSourceCandidates,
} from '@/utils/memoryPhotos';
import { pickFirstReadableLocalMediaUri } from '@/utils/localMediaReadable';
import {
  feedBooksHydrationSnapshot,
  feedChildHydrationSnapshot,
  feedMemoriesHydrationSnapshot,
  setFeedHydrationSnapshots,
} from '@/services/tabScreensCache';
import { peekFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';

function safeExtFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? '').toLowerCase();
  if (!ext) return fallback;
  if (ext.length > 6) return fallback;
  return ext;
}

function baseDir(): string | null {
  if (Platform.OS === 'web') return null;
  if (!documentDirectory) return null;
  return `${documentDirectory}petitmo_memories/`;
}

async function ensureDir(dir: string): Promise<void> {
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
}

async function getImagePx(uri: string): Promise<{ w: number; h: number }> {
  return await new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ w, h }),
      err => reject(err),
    );
  });
}

export async function persistOriginalToSandbox(params: {
  memoryId: string;
  type: 'photo' | 'video' | 'voice';
  sourceUri: string;
}): Promise<{ localOriginalUri: string | null }> {
  const { memoryId, type, sourceUri } = params;
  if (Platform.OS === 'web') return { localOriginalUri: null };
  const root = baseDir();
  if (!root) return { localOriginalUri: null };
  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);

  const ext =
    type === 'photo'
      ? safeExtFromUri(sourceUri, 'jpg')
      : type === 'video'
        ? safeExtFromUri(sourceUri, 'mp4')
        : safeExtFromUri(sourceUri, 'm4a');

  const dest = `${dir}original.${ext}`;
  try {
    await copyAsync({ from: sourceUri.trim(), to: dest });
    return { localOriginalUri: dest };
  } catch {
    return { localOriginalUri: null };
  }
}

export type LocalPhotoThumbResult = {
  localThumbUri: string | null;
  originalPx: { w: number; h: number } | null;
};

export type LocalPhotoHeavyDerivativesResult = {
  localDisplayUri: string | null;
  localPrintUri: string | null;
  printPx: { w: number; h: number } | null;
};

/** Vignette fil 480px — seul dérivé bloquant à la capture (affichage immédiat). */
export async function ensureLocalPhotoFeedThumbOnly(params: {
  memoryId: string;
  localOriginalUri: string;
}): Promise<LocalPhotoThumbResult> {
  const { memoryId, localOriginalUri } = params;
  if (Platform.OS === 'web') {
    return { localThumbUri: null, originalPx: null };
  }
  const root = baseDir();
  if (!root) {
    return { localThumbUri: null, originalPx: null };
  }
  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);

  const thumbDest = `${dir}thumb.jpg`;
  const originalPx = await getImagePx(localOriginalUri).catch(() => null);

  const thumb = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: 480 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );
  await copyAsync({ from: thumb.uri, to: thumbDest }).catch(() => {});

  return { localThumbUri: thumbDest, originalPx };
}

/** Display 1400px + print 3200px — qualité fil / livre (peut tourner en arrière-plan). */
export async function ensureLocalPhotoDisplayPrintDerivatives(params: {
  memoryId: string;
  localOriginalUri: string;
}): Promise<LocalPhotoHeavyDerivativesResult> {
  const { memoryId, localOriginalUri } = params;
  if (Platform.OS === 'web') {
    return { localDisplayUri: null, localPrintUri: null, printPx: null };
  }
  const root = baseDir();
  if (!root) {
    return { localDisplayUri: null, localPrintUri: null, printPx: null };
  }
  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);

  const displayDest = `${dir}display.jpg`;
  const printDest = `${dir}print.jpg`;

  const display = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: 1400 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );
  const print = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
  );

  await copyAsync({ from: display.uri, to: displayDest }).catch(() => {});
  await copyAsync({ from: print.uri, to: printDest }).catch(() => {});

  const printPx = await getImagePx(printDest).catch(() => null);

  return {
    localDisplayUri: displayDest,
    localPrintUri: printDest,
    printPx,
  };
}

const heavyDerivativesInFlight = new Set<string>();

/**
 * Génère display + print sans bloquer la navigation fil / favoris après capture.
 * Met à jour SQLite puis notifie le fil quand c’est prêt.
 */
export function scheduleLocalPhotoHeavyDerivatives(memoryId: string, localOriginalUri: string): void {
  const id = memoryId.trim();
  const src = localOriginalUri.trim();
  if (!id || !src || Platform.OS === 'web') return;
  if (heavyDerivativesInFlight.has(id)) return;
  heavyDerivativesInFlight.add(id);

  void (async () => {
    try {
      const heavy = await ensureLocalPhotoDisplayPrintDerivatives({
        memoryId: id,
        localOriginalUri: src,
      });
      const cur = getLocalMemoryById(id);
      if (!cur || cur.type !== 'photo') return;

      const display = heavy.localDisplayUri?.trim() || null;
      const print = heavy.localPrintUri?.trim() || null;
      if (!display && !print) return;

      const next = {
        ...cur,
        local_display_path: display ?? cur.local_display_path,
        local_print_path: print ?? cur.local_print_path,
        display_url: display ?? cur.display_url ?? cur.thumb_url,
        print_url: print ?? cur.print_url,
        print_px_w: heavy.printPx?.w ?? cur.print_px_w,
        print_px_h: heavy.printPx?.h ?? cur.print_px_h,
        updated_at: new Date().toISOString(),
      };
      upsertLocalMemory(next);

      const snapIdx = feedMemoriesHydrationSnapshot.findIndex(m => m.id === id);
      if (snapIdx >= 0) {
        const snapMemories = [...feedMemoriesHydrationSnapshot];
        snapMemories[snapIdx] = next;
        setFeedHydrationSnapshots(
          feedChildHydrationSnapshot,
          snapMemories,
          feedBooksHydrationSnapshot,
        );
      }

      DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    } catch (e) {
      console.warn('[memoryLocalStore] heavy derivatives', id, e);
    } finally {
      heavyDerivativesInFlight.delete(id);
    }
  })();
}

/**
 * Génère display + print **de façon synchrone** (couverture livre, export) et met à jour SQLite.
 * À utiliser quand le badge DPI / `book_covers/` ne doit pas attendre le job arrière-plan.
 */
export async function awaitPhotoPrintDerivativesForMemory(memoryId: string): Promise<Memory | null> {
  const id = memoryId.trim();
  const cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'photo') return cur;
  const orig = cur.local_original_path?.trim();
  if (!orig || Platform.OS === 'web') return cur;

  try {
    const heavy = await ensureLocalPhotoDisplayPrintDerivatives({
      memoryId: id,
      localOriginalUri: orig,
    });
    const display = heavy.localDisplayUri?.trim() || null;
    const print = heavy.localPrintUri?.trim() || null;
    if (!display && !print) return cur;

    const next: Memory = {
      ...cur,
      local_display_path: display ?? cur.local_display_path,
      local_print_path: print ?? cur.local_print_path,
      display_url: display ?? cur.display_url ?? cur.thumb_url,
      print_url: print ?? cur.print_url,
      print_px_w: heavy.printPx?.w ?? cur.print_px_w,
      print_px_h: heavy.printPx?.h ?? cur.print_px_h,
      updated_at: new Date().toISOString(),
    };
    upsertLocalMemory(next);

    const snapIdx = feedMemoriesHydrationSnapshot.findIndex(m => m.id === id);
    if (snapIdx >= 0) {
      const snapMemories = [...feedMemoriesHydrationSnapshot];
      snapMemories[snapIdx] = next;
      setFeedHydrationSnapshots(
        feedChildHydrationSnapshot,
        snapMemories,
        feedBooksHydrationSnapshot,
      );
    }

    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    return next;
  } catch (e) {
    console.warn('[memoryLocalStore] awaitPhotoPrintDerivativesForMemory', id, e);
    return cur;
  }
}

/** Dérivé print cover vocal (`voice_cover_print.jpg`) — parité `print.jpg` photo. */
export async function ensureLocalVoiceCoverPrintDerivative(params: {
  memoryId: string;
  sourceCoverUri: string;
}): Promise<{ localPrintUri: string | null; printPx: { w: number; h: number } | null }> {
  const { memoryId, sourceCoverUri } = params;
  const src = sourceCoverUri.trim();
  if (!src || Platform.OS === 'web') {
    return { localPrintUri: null, printPx: null };
  }
  const root = baseDir();
  if (!root) return { localPrintUri: null, printPx: null };

  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);
  const printDest = `${dir}voice_cover_print.jpg`;

  const print = await ImageManipulator.manipulateAsync(
    src,
    [{ resize: { width: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
  );
  await copyAsync({ from: print.uri, to: printDest }).catch(() => {});
  const printPx = await getImagePx(printDest).catch(() => null);
  return { localPrintUri: printDest, printPx };
}

const voiceCoverPrintInFlight = new Set<string>();

export function scheduleLocalVoiceCoverPrintDerivative(memoryId: string, sourceCoverUri: string): void {
  const id = memoryId.trim();
  const src = sourceCoverUri.trim();
  if (!id || !src || Platform.OS === 'web') return;
  if (voiceCoverPrintInFlight.has(id)) return;
  voiceCoverPrintInFlight.add(id);

  void (async () => {
    try {
      const cur = getLocalMemoryById(id);
      if (!cur || cur.type !== 'voice') return;
      if (cur.local_print_path?.trim()) return;

      const heavy = await ensureLocalVoiceCoverPrintDerivative({ memoryId: id, sourceCoverUri: src });
      const print = heavy.localPrintUri?.trim() || null;
      if (!print) return;

      const next: Memory = {
        ...cur,
        local_print_path: print,
        print_px_w: heavy.printPx?.w ?? cur.print_px_w,
        print_px_h: heavy.printPx?.h ?? cur.print_px_h,
        updated_at: new Date().toISOString(),
      };
      upsertLocalMemory(next);

      const snapIdx = feedMemoriesHydrationSnapshot.findIndex(m => m.id === id);
      if (snapIdx >= 0) {
        const snapMemories = [...feedMemoriesHydrationSnapshot];
        snapMemories[snapIdx] = next;
        setFeedHydrationSnapshots(
          feedChildHydrationSnapshot,
          snapMemories,
          feedBooksHydrationSnapshot,
        );
      }

      DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    } catch (e) {
      console.warn('[memoryLocalStore] voice cover print', id, e);
    } finally {
      voiceCoverPrintInFlight.delete(id);
    }
  })();
}

/** Génère `voice_cover_print.jpg` avant badge DPI livre / export. */
export async function awaitVoiceCoverPrintDerivativeForMemory(memoryId: string): Promise<Memory | null> {
  const id = memoryId.trim();
  const cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'voice') return cur;
  if (cur.local_print_path?.trim() && cur.print_px_w && cur.print_px_h) return cur;

  const readableCover = await pickFirstReadableLocalMediaUri(
    collectVoiceCoverReadableSourceCandidates(cur),
  );
  if (!readableCover) return cur;

  try {
    const heavy = await ensureLocalVoiceCoverPrintDerivative({
      memoryId: id,
      sourceCoverUri: readableCover,
    });
    const print = heavy.localPrintUri?.trim() || null;
    if (!print) return cur;

    const next: Memory = {
      ...cur,
      local_print_path: print,
      print_px_w: heavy.printPx?.w ?? cur.print_px_w,
      print_px_h: heavy.printPx?.h ?? cur.print_px_h,
      updated_at: new Date().toISOString(),
    };
    upsertLocalMemory(next);

    const snapIdx = feedMemoriesHydrationSnapshot.findIndex(m => m.id === id);
    if (snapIdx >= 0) {
      const snapMemories = [...feedMemoriesHydrationSnapshot];
      snapMemories[snapIdx] = next;
      setFeedHydrationSnapshots(
        feedChildHydrationSnapshot,
        snapMemories,
        feedBooksHydrationSnapshot,
      );
    }

    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    return next;
  } catch (e) {
    console.warn('[memoryLocalStore] awaitVoiceCoverPrintDerivativeForMemory', id, e);
    return cur;
  }
}

/** Génère `poster.jpg` si absent — vignette vidéo livre / export PDF. */
export async function awaitVideoPosterForBookMemory(memoryId: string): Promise<Memory | null> {
  const id = memoryId.trim();
  const cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'video') return cur;

  const readablePoster = await pickFirstReadableLocalMediaUri(
    collectVideoFeedPosterLocalUriCandidates(cur),
  );
  if (readablePoster) {
    const posterNorm = readablePoster.trim();
    const dbHasSameLocal = [cur.local_thumb_path, cur.poster_url, cur.thumbnail_url]
      .map(u => (u ?? '').trim())
      .includes(posterNorm);
    if (!dbHasSameLocal) {
      const next: Memory = {
        ...cur,
        local_thumb_path: readablePoster,
        poster_url: readablePoster,
        thumbnail_url: readablePoster,
        updated_at: new Date().toISOString(),
      };
      upsertLocalMemory(next);
      DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
      return next;
    }
    return cur;
  }

  if (Platform.OS === 'web') return cur;

  const videoCandidates = [
    ...collectVideoCloudSyncUriCandidates(cur).filter(u => !u.endsWith('poster.jpg')),
    peekFeedBootstrapVideoUri(id) ?? '',
  ].filter(Boolean);
  const videoUri = await pickFirstReadableLocalMediaUri(videoCandidates);
  if (!videoUri) return cur;

  try {
    const { uri: thumbTmp } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 0,
      quality: 0.7,
    });
    if (!thumbTmp?.trim() || !documentDirectory) return cur;

    const dir = `${documentDirectory}petitmo_memories/${id}/`;
    await ensureDir(dir);
    const thumbDest = `${dir}poster.jpg`;
    await copyAsync({ from: thumbTmp, to: thumbDest });

    const next: Memory = {
      ...cur,
      local_thumb_path: thumbDest,
      poster_url: thumbDest,
      thumbnail_url: thumbDest,
      updated_at: new Date().toISOString(),
    };
    upsertLocalMemory(next);

    const snapIdx = feedMemoriesHydrationSnapshot.findIndex(m => m.id === id);
    if (snapIdx >= 0) {
      const snapMemories = [...feedMemoriesHydrationSnapshot];
      snapMemories[snapIdx] = next;
      setFeedHydrationSnapshots(
        feedChildHydrationSnapshot,
        snapMemories,
        feedBooksHydrationSnapshot,
      );
    }

    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    return next;
  } catch (e) {
    console.warn('[memoryLocalStore] awaitVideoPosterForBookMemory', id, e);
    return cur;
  }
}

/** Les 3 dérivés d’un coup — édition photo, export livre, chemins qui exigent print tout de suite. */
export async function ensureLocalPhotoDerivatives(params: {
  memoryId: string;
  localOriginalUri: string;
}): Promise<{
  localThumbUri: string | null;
  localDisplayUri: string | null;
  localPrintUri: string | null;
  originalPx: { w: number; h: number } | null;
  printPx: { w: number; h: number } | null;
}> {
  const thumb = await ensureLocalPhotoFeedThumbOnly(params);
  const heavy = await ensureLocalPhotoDisplayPrintDerivatives(params);
  return {
    localThumbUri: thumb.localThumbUri,
    localDisplayUri: heavy.localDisplayUri,
    localPrintUri: heavy.localPrintUri,
    originalPx: thumb.originalPx,
    printPx: heavy.printPx,
  };
}

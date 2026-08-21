import { DeviceEventEmitter, InteractionManager, Platform, Image } from 'react-native';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH } from '@/lib/limits';
import type { Memory } from '@/types/local';
import {
  collectVoiceCoverReadableSourceCandidates,
} from '@/utils/memoryPhotos';
import { pickFirstReadableLocalMediaUri } from '@/utils/localMediaReadable';
import {
  feedBooksHydrationSnapshot,
  feedChildHydrationSnapshot,
  feedMemoriesHydrationSnapshot,
  setFeedHydrationSnapshots,
} from '@/services/tabScreensCache';
import { ensureVideoPosterPrintForBookMemory } from '@/services/videoPosterLocal';

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
  const key = uri.trim();
  if (!key) throw new Error('URI vide');

  const fromRn = await new Promise<{ w: number; h: number } | null>(resolve => {
    let settled = false;
    const done = (v: { w: number; h: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    try {
      Image.getSize(
        key,
        (w, h) => {
          clearTimeout(timer);
          done(w > 0 && h > 0 ? { w, h } : null);
        },
        () => {
          clearTimeout(timer);
          done(null);
        },
      );
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
  if (fromRn) return fromRn;

  try {
    const { Image: ExpoImage } = await import('expo-image');
    const loaded = await Promise.race([
      ExpoImage.loadAsync(key),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    const scale = typeof loaded.scale === 'number' && loaded.scale > 0 ? loaded.scale : 1;
    const w = Math.round(loaded.width * scale);
    const h = Math.round(loaded.height * scale);
    if (w > 0 && h > 0) return { w, h };
  } catch {
    /* manipulateur */
  }

  const decoded = await ImageManipulator.manipulateAsync(key, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  if (!(decoded.width > 0 && decoded.height > 0)) {
    throw new Error('Dimensions image introuvables');
  }
  return { w: decoded.width, h: decoded.height };
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
/** File globale : un seul decode ImageManipulator lourds à la fois (évite OOM sur import lot). */
const HEAVY_DERIVATIVES_GLOBAL_CONCURRENCY = 1;
let heavyDerivativesActive = 0;
const heavyDerivativesWaitQueue: Array<() => void> = [];

function acquireHeavyDerivativesSlot(): Promise<void> {
  if (heavyDerivativesActive < HEAVY_DERIVATIVES_GLOBAL_CONCURRENCY) {
    heavyDerivativesActive += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    heavyDerivativesWaitQueue.push(() => {
      heavyDerivativesActive += 1;
      resolve();
    });
  });
}

function releaseHeavyDerivativesSlot(): void {
  heavyDerivativesActive = Math.max(0, heavyDerivativesActive - 1);
  const next = heavyDerivativesWaitQueue.shift();
  if (next) next();
}

/**
 * Génère display + print sans bloquer la navigation fil / favoris après capture.
 * Met à jour SQLite puis notifie le fil quand c’est prêt.
 * Concurrence globale = 1 pour éviter jetsam OOM sur import multi-photos.
 */
export function scheduleLocalPhotoHeavyDerivatives(memoryId: string, localOriginalUri: string): void {
  const id = memoryId.trim();
  const src = localOriginalUri.trim();
  if (!id || !src || Platform.OS === 'web') return;
  if (heavyDerivativesInFlight.has(id)) return;
  heavyDerivativesInFlight.add(id);

  void (async () => {
    await acquireHeavyDerivativesSlot();
    try {
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
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
        // Ne pas écraser print_url / display_url cloud par des chemins sandbox.
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
      releaseHeavyDerivativesSlot();
    }
  })();
}

/**
 * Génère ou télécharge le JPEG print livre + `print_px_*` (DPI).
 * Après réinstall : `print_url` cloud → sandbox, sans exiger l’original HD.
 */
export async function awaitPhotoPrintDerivativesForMemory(memoryId: string): Promise<Memory | null> {
  const id = memoryId.trim();
  let cur = getLocalMemoryById(id);
  if (!cur || cur.type !== 'photo' || Platform.OS === 'web') return cur;

  const { isLocalMediaUriReadable } = await import('@/utils/localMediaReadable');
  const { isDeviceLocalMediaUri } = await import('@/utils/memoryPhotos');

  const finish = (next: Memory): Memory => {
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
  };

  // Déjà OK en local.
  const existingPrint = (cur.local_print_path ?? '').trim();
  if (existingPrint && (await isLocalMediaUriReadable(existingPrint))) {
    let pw = typeof cur.print_px_w === 'number' ? cur.print_px_w : 0;
    let ph = typeof cur.print_px_h === 'number' ? cur.print_px_h : 0;
    if (!(pw > 0 && ph > 0)) {
      const measured = await getImagePx(existingPrint).catch(() => null);
      pw = measured?.w ?? 0;
      ph = measured?.h ?? 0;
      if (pw > 0 && ph > 0) {
        return finish({
          ...cur,
          print_px_w: pw,
          print_px_h: ph,
          updated_at: new Date().toISOString(),
        });
      }
    } else {
      return cur;
    }
  }

  // 1) Original local → dérivés display/print (ne jamais écraser print_url cloud).
  const orig = (cur.local_original_path ?? '').trim();
  if (orig && (await isLocalMediaUriReadable(orig))) {
    try {
      const heavy = await ensureLocalPhotoDisplayPrintDerivatives({
        memoryId: id,
        localOriginalUri: orig,
      });
      const display = heavy.localDisplayUri?.trim() || null;
      const print = heavy.localPrintUri?.trim() || null;
      if (print || display) {
        return finish({
          ...cur,
          local_display_path: display ?? cur.local_display_path,
          local_print_path: print ?? cur.local_print_path,
          // Garder l’URL cloud pour les futurs restores — ne pas y écrire le chemin sandbox.
          print_px_w: heavy.printPx?.w ?? cur.print_px_w,
          print_px_h: heavy.printPx?.h ?? cur.print_px_h,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[memoryLocalStore] awaitPhotoPrintDerivativesForMemory local', id, e);
    }
    cur = getLocalMemoryById(id) ?? cur;
  }

  // 2) Télécharger print cloud (display/media ensuite — jamais thumb 480 → faux ~68 DPI).
  const { downloadCloudFileToSandbox } = await import('@/services/memoryCloudMaterialize');
  const cloudCandidates = [cur.print_url, cur.display_url, cur.media_url]
    .map(u => (u ?? '').trim())
    .filter(u => u && !isDeviceLocalMediaUri(u));

  for (const remote of cloudCandidates) {
    const isCanonicalPrint = remote === (cur.print_url ?? '').trim();
    const destName = isCanonicalPrint ? 'print.jpg' : 'print_from_cloud.jpg';
    try {
      const local = await downloadCloudFileToSandbox(id, remote, destName);
      if (!local) continue;
      const printPx = await getImagePx(local).catch(() => null);
      return finish({
        ...cur,
        local_print_path: local,
        print_px_w: printPx?.w ?? cur.print_px_w,
        print_px_h: printPx?.h ?? cur.print_px_h,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(
        '[memoryLocalStore] awaitPhotoPrintDerivativesForMemory cloud',
        id,
        remote.slice(0, 48),
        e,
      );
    }
  }

  return getLocalMemoryById(id) ?? cur;
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

/** Génère `poster.jpg` + `poster_print.jpg` HQ si absents — livre / export PDF. */
export async function awaitVideoPosterForBookMemory(memoryId: string): Promise<Memory | null> {
  const next = await ensureVideoPosterPrintForBookMemory(memoryId);
  if (!next) return null;

  const id = memoryId.trim();
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
  return next;
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

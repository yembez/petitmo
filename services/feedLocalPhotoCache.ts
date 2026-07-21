import { Platform } from 'react-native';
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';

const SUBDIR = 'petitmo_feed_local_thumbs/';
const VIDEO_SUBDIR = 'petitmo_feed_local_videos/';

/** URLs fichier à afficher dès le 1er frame après import (évite flash réseau / swap d’URL). */
const bootstrapDisplayUrlsByMemoryId = new Map<string, string[]>();

/** URI locale (picker / caméra) pour lecture vidéo immédiate après insert, avant copie disque. */
const bootstrapVideoUriByMemoryId = new Map<string, string>();

export function setFeedBootstrapDisplayUrls(memoryId: string, slotFilePaths: string[]): void {
  if (!memoryId?.trim() || slotFilePaths.length === 0) return;
  bootstrapDisplayUrlsByMemoryId.set(memoryId.trim(), slotFilePaths.filter(Boolean));
}

/** Lecture sans consommation (safe StrictMode / double init useState). */
export function peekFeedBootstrapDisplayUrls(memoryId: string): string[] | undefined {
  const v = bootstrapDisplayUrlsByMemoryId.get(memoryId.trim());
  return v?.length ? [...v] : undefined;
}

export function takeFeedBootstrapDisplayUrls(memoryId: string): string[] | undefined {
  const id = memoryId.trim();
  const v = bootstrapDisplayUrlsByMemoryId.get(id);
  if (!v?.length) return undefined;
  bootstrapDisplayUrlsByMemoryId.delete(id);
  return [...v];
}

export function setFeedBootstrapVideoUri(memoryId: string, fileUri: string): void {
  if (!memoryId?.trim() || !fileUri?.trim()) return;
  bootstrapVideoUriByMemoryId.set(memoryId.trim(), fileUri.trim());
}

export function peekFeedBootstrapVideoUri(memoryId: string): string | undefined {
  const v = bootstrapVideoUriByMemoryId.get(memoryId.trim());
  return v?.trim() ? v.trim() : undefined;
}

export function takeFeedBootstrapVideoUri(memoryId: string): string | undefined {
  const id = memoryId.trim();
  const v = bootstrapVideoUriByMemoryId.get(id);
  if (!v?.trim()) return undefined;
  bootstrapVideoUriByMemoryId.delete(id);
  return v.trim();
}

function baseDir(): string | null {
  if (Platform.OS === 'web') return null;
  const d = documentDirectory;
  if (!d) return null;
  return `${d}${SUBDIR}`;
}

function filePathFor(memoryId: string, slotIndex: number): string {
  const root = baseDir();
  if (!root) return '';
  if (slotIndex === 0) return `${root}${memoryId}.jpg`;
  return `${root}${memoryId}_e${slotIndex - 1}.jpg`;
}

/**
 * Copie un JPEG **déjà compressé** (thumb 480 / display) pour affichage fil hors réseau.
 * Ne jamais passer l’original picker / `original.jpg` — risque OOM au scroll.
 * `slotIndex` : 0 = photo principale, 1+ = extras album (mosaïque).
 */
export async function persistFeedLocalThumbnail(
  memoryId: string,
  sourceUri: string | null | undefined,
  slotIndex: number
): Promise<string | null> {
  if (Platform.OS === 'web' || !sourceUri?.trim()) return null;
  const root = baseDir();
  if (!root) return null;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
  const dest = filePathFor(memoryId, slotIndex);
  if (!dest) return null;
  try {
    await copyAsync({ from: sourceUri.trim(), to: dest });
    return dest;
  } catch (e) {
    console.warn('[feedLocalPhotoCache] persist failed', memoryId, slotIndex, e);
    return null;
  }
}

export async function getFeedLocalThumbnail(
  memoryId: string,
  slotIndex: number
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const dest = filePathFor(memoryId, slotIndex);
  if (!dest) return null;
  try {
    const info = await getInfoAsync(dest);
    if (info.exists && !info.isDirectory) return dest;
  } catch {
    /* ignore */
  }
  return null;
}

export async function clearFeedLocalThumbnails(memoryId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await deleteAsync(filePathFor(memoryId, 0), { idempotent: true });
    for (let i = 0; i < 16; i++) {
      await deleteAsync(filePathFor(memoryId, i + 1), { idempotent: true });
    }
  } catch {
    /* ignore */
  }
}

function videoBaseDir(): string | null {
  if (Platform.OS === 'web') return null;
  const d = documentDirectory;
  if (!d) return null;
  return `${d}${VIDEO_SUBDIR}`;
}

function videoExtFromSourceUri(uri: string): string {
  const u = (uri.split('?')[0] ?? '').toLowerCase();
  const m = u.match(/\.([a-z0-9]+)$/);
  const e = m?.[1] ?? 'mp4';
  if (e === 'qt') return 'mov';
  return e;
}

const VIDEO_FILE_EXTS = ['mp4', 'mov', 'm4v', 'webm'] as const;

/**
 * Copie la vidéo source (picker / caméra) pour lecture dans le fil sans repasser par le CDN.
 */
export async function persistFeedLocalVideo(
  memoryId: string,
  sourceUri: string | null | undefined
): Promise<string | null> {
  if (Platform.OS === 'web' || !sourceUri?.trim()) return null;
  const root = videoBaseDir();
  if (!root) return null;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
  const ext = videoExtFromSourceUri(sourceUri);
  const dest = `${root}${memoryId.trim()}.${ext}`;
  try {
    await copyAsync({ from: sourceUri.trim(), to: dest });
    return dest;
  } catch (e) {
    console.warn('[feedLocalPhotoCache] persist video failed', memoryId, e);
    return null;
  }
}

export async function getFeedLocalVideoPath(memoryId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const root = videoBaseDir();
  if (!root) return null;
  const id = memoryId.trim();
  for (const ext of VIDEO_FILE_EXTS) {
    const dest = `${root}${id}.${ext}`;
    try {
      const info = await getInfoAsync(dest);
      if (info.exists && !info.isDirectory) return dest;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function clearFeedLocalVideo(memoryId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const root = videoBaseDir();
  if (!root) return;
  const id = memoryId.trim();
  bootstrapVideoUriByMemoryId.delete(id);
  for (const ext of VIDEO_FILE_EXTS) {
    await deleteAsync(`${root}${id}.${ext}`, { idempotent: true }).catch(() => {});
  }
}

/** Chemins disque possibles pour une vignette fil (slot 0 + extras album). */
export function feedLocalThumbnailPathCandidates(memoryId: string, maxExtras = 16): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(filePathFor(memoryId, 0));
  for (let i = 0; i < maxExtras; i++) {
    push(filePathFor(memoryId, i + 1));
  }
  return out;
}

/** Chemins disque possibles pour une copie vidéo fil. */
export function feedLocalVideoPathCandidates(memoryId: string): string[] {
  const root = videoBaseDir();
  if (!root) return [];
  const id = memoryId.trim();
  return VIDEO_FILE_EXTS.map(ext => `${root}${id}.${ext}`);
}

async function moveFileIfExists(from: string, to: string): Promise<boolean> {
  if (!from.trim() || !to.trim() || from === to) return false;
  try {
    const info = await getInfoAsync(from);
    if (!info.exists || info.isDirectory) return false;
    await makeDirectoryAsync(to.slice(0, to.lastIndexOf('/') + 1), { intermediates: true }).catch(() => {});
    const destInfo = await getInfoAsync(to);
    if (destInfo.exists) {
      await deleteAsync(to, { idempotent: true });
    }
    await copyAsync({ from, to });
    await deleteAsync(from, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lors du remapping `loc_*` → UUID : déplace aussi le cache fil (sinon le fil lit encore l’ancien id).
 */
export async function remapFeedLocalCacheForMemoryId(oldId: string, newId: string): Promise<void> {
  if (Platform.OS === 'web' || !oldId.trim() || !newId.trim() || oldId === newId) return;

  for (let slot = 0; slot < 17; slot++) {
    await moveFileIfExists(filePathFor(oldId, slot), filePathFor(newId, slot));
  }

  for (const ext of VIDEO_FILE_EXTS) {
    const root = videoBaseDir();
    if (!root) continue;
    await moveFileIfExists(`${root}${oldId}.${ext}`, `${root}${newId}.${ext}`);
  }

  const bootUrls = bootstrapDisplayUrlsByMemoryId.get(oldId);
  if (bootUrls?.length) {
    bootstrapDisplayUrlsByMemoryId.set(newId, bootUrls);
    bootstrapDisplayUrlsByMemoryId.delete(oldId);
  }
  const bootVideo = bootstrapVideoUriByMemoryId.get(oldId);
  if (bootVideo) {
    bootstrapVideoUriByMemoryId.set(newId, bootVideo);
    bootstrapVideoUriByMemoryId.delete(oldId);
  }
}

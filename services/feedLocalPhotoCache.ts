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
 * Copie le JPEG déjà compressé (post-manipulation) pour affichage fil hors réseau / avant dérivés worker.
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

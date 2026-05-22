import * as FileSystem from 'expo-file-system';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import { ensureLocalPhotoDerivatives, persistOriginalToSandbox } from '@/services/memoryLocalStore';
import {
  persistFeedLocalThumbnail,
  persistFeedLocalVideo,
  setFeedBootstrapDisplayUrls,
  setFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';
import * as VideoThumbnails from 'expo-video-thumbnails';

export type LocalCaptureMediaType = 'photo' | 'video' | 'voice';

export function newLocalMemoryId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function readBytesSize(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  }
  const file = new FileSystem.File(uri);
  const b = await file.bytes();
  return b.length;
}

async function createVideoThumbnailJpeg(uri: string): Promise<string | null> {
  try {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 0,
      quality: 0.7,
    });
    return thumbUri;
  } catch {
    return null;
  }
}

function emptyMemoryShell(params: {
  id: string;
  childId: string;
  userId: string;
  type: Memory['type'];
  createdAt: string;
  insertedAt: string;
  location: string | null;
}): Memory {
  const { id, childId, userId, type, createdAt, insertedAt, location } = params;
  return {
    id,
    child_id: childId,
    user_id: userId,
    type,
    content: null,
    media_url: null,
    media_path: null,
    extra_photo_urls: [],
    extra_photo_paths: [],
    extra_thumb_urls: [],
    extra_display_urls: [],
    favorite_photo_urls: [],
    voice_cover_url: null,
    voice_cover_path: null,
    voice_playback_start_sec: null,
    edited_media_url: null,
    is_favorite: false,
    duration: null,
    thumbnail_url: null,
    thumbnail_path: null,
    file_size: null,
    location,
    inserted_at: insertedAt,
    captured_overlay_ink: null,
    thumb_url: null,
    display_url: null,
    print_url: null,
    poster_url: null,
    poster_print_url: null,
    upload_status: 'full',
    created_at: createdAt,
    updated_at: insertedAt,
    local_media_path: null,
    local_original_path: null,
    local_thumb_path: null,
    local_display_path: null,
    local_print_path: null,
    original_px_w: null,
    original_px_h: null,
    print_px_w: null,
    print_px_h: null,
    synced_at: null,
    sync_status: 'local',
  };
}

/** Souvenir texte 100 % local (SQLite), sans insert Supabase. */
export function buildLocalTextMemory(params: {
  childId: string;
  userId: string;
  content: string;
  location: string | null;
}): Memory {
  const id = newLocalMemoryId();
  const now = new Date().toISOString();
  const mem = emptyMemoryShell({
    id,
    childId: params.childId,
    userId: params.userId,
    type: 'text',
    createdAt: now,
    insertedAt: now,
    location: params.location,
  });
  mem.content = params.content.trim();
  return mem;
}

/**
 * Création souvenir **uniquement** SQLite + sandbox (mode gratuit strict, hors web).
 */
export async function captureMemoryLocalOnly(params: {
  uri: string;
  type: LocalCaptureMediaType;
  childId: string;
  userId: string;
  duration?: number;
  voiceCoverUri?: string | null;
  /** Début de l’extrait (s) si le fichier local est la prise complète. */
  voicePlaybackStartSec?: number | null;
  capturedAtIso?: string;
  locationOverride?: string | null;
  importAssetId?: string | null;
}): Promise<Memory | null> {
  const {
    uri,
    type,
    childId,
    userId,
    duration,
    voiceCoverUri,
    voicePlaybackStartSec,
    capturedAtIso,
    locationOverride,
  } = params;

  const stampLibraryAsset = (mem: Memory): Memory => {
    mem.import_asset_id = params.importAssetId?.trim() ? params.importAssetId.trim() : null;
    return mem;
  };
  const id = newLocalMemoryId();
  const now = new Date().toISOString();
  const createdAt = capturedAtIso?.trim() || now;
  const insertedAt = now;
  const locationLabel = locationOverride !== undefined ? locationOverride : null;

  if (type === 'photo') {
    if (Platform.OS === 'web') {
      const src = uri.trim();
      const size = await readBytesSize(src).catch(() => 0);
      const mem = emptyMemoryShell({
        id,
        childId,
        userId,
        type: 'photo',
        createdAt,
        insertedAt,
        location: locationLabel,
      });
      mem.local_media_path = src;
      mem.thumb_url = src;
      mem.display_url = src;
      mem.file_size = size;
      setFeedBootstrapDisplayUrls(id, [src]);
      return stampLibraryAsset(mem);
    }

    const { localOriginalUri } = await persistOriginalToSandbox({ memoryId: id, type: 'photo', sourceUri: uri });
    const src = (localOriginalUri ?? uri).trim();
    const d = await ensureLocalPhotoDerivatives({ memoryId: id, localOriginalUri: src });
    await persistFeedLocalThumbnail(id, uri, 0);
    const size = await readBytesSize(src).catch(() => 0);
    const mem = emptyMemoryShell({
      id,
      childId,
      userId,
      type: 'photo',
      createdAt,
      insertedAt,
      location: locationLabel,
    });
    mem.local_media_path = d.localThumbUri ?? src;
    mem.local_original_path = localOriginalUri;
    mem.local_thumb_path = d.localThumbUri;
    mem.local_display_path = d.localDisplayUri;
    mem.local_print_path = d.localPrintUri;
    mem.original_px_w = d.originalPx?.w ?? null;
    mem.original_px_h = d.originalPx?.h ?? null;
    mem.print_px_w = d.printPx?.w ?? null;
    mem.print_px_h = d.printPx?.h ?? null;
    mem.file_size = size;
    mem.thumb_url = mem.local_thumb_path ?? mem.local_media_path;
    mem.display_url = mem.local_display_path ?? mem.thumb_url;
    return stampLibraryAsset(mem);
  }

  if (type === 'video') {
    if (Platform.OS === 'web') {
      const src = uri.trim();
      const size = await readBytesSize(src).catch(() => 0);
      const mem = emptyMemoryShell({
        id,
        childId,
        userId,
        type: 'video',
        createdAt,
        insertedAt,
        location: locationLabel,
      });
      mem.local_media_path = src;
      mem.media_url = src;
      mem.duration = typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
      mem.file_size = size;
      setFeedBootstrapVideoUri(id, src);
      return stampLibraryAsset(mem);
    }

    const { localOriginalUri } = await persistOriginalToSandbox({ memoryId: id, type: 'video', sourceUri: uri });
    const src = (localOriginalUri ?? uri).trim();
    const size = await readBytesSize(src).catch(() => 0);
    const feedPath = await persistFeedLocalVideo(id, uri);
    const thumbTmp = await createVideoThumbnailJpeg(feedPath ?? src);
    let thumbDest: string | null = null;
    if (thumbTmp?.trim() && documentDirectory) {
      const dir = `${documentDirectory}petitmo_memories/${id}/`;
      await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      thumbDest = `${dir}poster.jpg`;
      await copyAsync({ from: thumbTmp, to: thumbDest }).catch(() => {
        thumbDest = null;
      });
    }
    const mem = emptyMemoryShell({
      id,
      childId,
      userId,
      type: 'video',
      createdAt,
      insertedAt,
      location: locationLabel,
    });
    const mediaPathLocal = feedPath ?? src;
    setFeedBootstrapVideoUri(id, mediaPathLocal);
    mem.local_media_path = mediaPathLocal;
    mem.local_original_path = localOriginalUri;
    mem.media_url = mediaPathLocal;
    mem.duration = typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
    mem.file_size = size;
    mem.thumbnail_url = thumbDest;
    mem.poster_url = thumbDest;
    return stampLibraryAsset(mem);
  }

  if (Platform.OS === 'web') {
    const src = uri.trim();
    const size = await readBytesSize(src).catch(() => 0);
    let voiceCoverUrl: string | null = null;
    let voiceCoverPath: string | null = null;
    if (voiceCoverUri?.trim()) {
      voiceCoverUrl = voiceCoverUri.trim();
      voiceCoverPath = voiceCoverUri.trim();
    }
    const mem = emptyMemoryShell({
      id,
      childId,
      userId,
      type: 'voice',
      createdAt,
      insertedAt,
      location: locationLabel,
    });
    mem.local_media_path = src;
    mem.media_url = src;
    mem.duration = typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
    mem.file_size = size;
    mem.voice_cover_url = voiceCoverUrl;
    mem.voice_cover_path = voiceCoverPath;
    mem.voice_playback_start_sec =
      typeof voicePlaybackStartSec === 'number' && Number.isFinite(voicePlaybackStartSec)
        ? voicePlaybackStartSec
        : null;
    return stampLibraryAsset(mem);
  }

  const { localOriginalUri } = await persistOriginalToSandbox({ memoryId: id, type: 'voice', sourceUri: uri });
  const src = (localOriginalUri ?? uri).trim();
  const size = await readBytesSize(src).catch(() => 0);
  let voiceCoverUrl: string | null = null;
  let voiceCoverPath: string | null = null;
  if (voiceCoverUri?.trim() && documentDirectory) {
    const dir = `${documentDirectory}petitmo_memories/${id}/`;
    await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const ext = voiceCoverUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const dest = `${dir}voice_cover.${ext}`;
    try {
      await copyAsync({ from: voiceCoverUri.trim(), to: dest });
      voiceCoverUrl = dest;
      voiceCoverPath = dest;
    } catch {
      voiceCoverUrl = null;
      voiceCoverPath = null;
    }
  }
  const mem = emptyMemoryShell({
    id,
    childId,
    userId,
    type: 'voice',
    createdAt,
    insertedAt,
    location: locationLabel,
  });
  mem.local_media_path = src;
  mem.local_original_path = localOriginalUri;
  mem.media_url = src;
  mem.duration = typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
  mem.file_size = size;
  mem.voice_cover_url = voiceCoverUrl;
  mem.voice_cover_path = voiceCoverPath;
  mem.voice_playback_start_sec =
    typeof voicePlaybackStartSec === 'number' && Number.isFinite(voicePlaybackStartSec)
      ? voicePlaybackStartSec
      : null;
  return stampLibraryAsset(mem);
}

/**
 * Album multi-photos : une ligne souvenir locale, fichiers dans le sandbox (pas de Supabase).
 */
export async function capturePhotoAlbumLocalOnly(params: {
  uris: string[];
  childId: string;
  userId: string;
  capturedAtIso?: string;
  locationOverride?: string | null;
  importSourceFingerprint?: string | null;
}): Promise<Memory | null> {
  if (params.uris.length === 0) return null;

  const { uris, childId, userId, capturedAtIso, locationOverride } = params;

  const stampAlbumFp = (mem: Memory): Memory => {
    mem.import_source_fingerprint = params.importSourceFingerprint?.trim()
      ? params.importSourceFingerprint.trim()
      : null;
    return mem;
  };
  const id = newLocalMemoryId();
  const now = new Date().toISOString();
  const createdAt = capturedAtIso?.trim() || now;
  const insertedAt = now;
  const locationLabel = locationOverride !== undefined ? locationOverride : null;

  const first = uris[0]?.trim();
  if (!first) return null;

  if (Platform.OS === 'web') {
    const cleaned = uris.map(u => u.trim()).filter(Boolean);
    let totalSize = 0;
    for (const u of cleaned) {
      totalSize += await readBytesSize(u).catch(() => 0);
    }
    const extras = cleaned.slice(1);
    const mem = emptyMemoryShell({
      id,
      childId,
      userId,
      type: 'photo',
      createdAt,
      insertedAt,
      location: locationLabel,
    });
    mem.local_media_path = first;
    mem.extra_photo_urls = extras;
    mem.extra_thumb_urls = extras;
    mem.extra_display_urls = extras;
    mem.thumb_url = first;
    mem.display_url = first;
    mem.file_size = totalSize;
    setFeedBootstrapDisplayUrls(id, cleaned);
    return stampAlbumFp(mem);
  }

  const { localOriginalUri } = await persistOriginalToSandbox({ memoryId: id, type: 'photo', sourceUri: first });
  const src = (localOriginalUri ?? first).trim();
  const d = await ensureLocalPhotoDerivatives({ memoryId: id, localOriginalUri: src });
  await persistFeedLocalThumbnail(id, first, 0);

  const extraUris: string[] = [];
  const extraThumb: string[] = [];
  for (let i = 1; i < uris.length; i += 1) {
    const u = uris[i]?.trim();
    if (!u) continue;
    const slot = `${documentDirectory}petitmo_memories/${id}/album_${i}.jpg`;
    await makeDirectoryAsync(`${documentDirectory}petitmo_memories/${id}/`, { intermediates: true }).catch(() => {});
    await copyAsync({ from: u, to: slot }).catch(() => {});
    extraUris.push(slot);
    extraThumb.push(slot);
  }

  let totalSize = 0;
  totalSize += await readBytesSize(src).catch(() => 0);
  for (const u of extraUris) {
    totalSize += await readBytesSize(u).catch(() => 0);
  }

  const mem = emptyMemoryShell({
    id,
    childId,
    userId,
    type: 'photo',
    createdAt,
    insertedAt,
    location: locationLabel,
  });
  mem.extra_photo_urls = extraUris;
  mem.extra_thumb_urls = extraThumb;
  mem.extra_display_urls = extraThumb;
  mem.local_media_path = d.localThumbUri ?? src;
  mem.local_original_path = localOriginalUri;
  mem.local_thumb_path = d.localThumbUri;
  mem.local_display_path = d.localDisplayUri;
  mem.local_print_path = d.localPrintUri;
  mem.original_px_w = d.originalPx?.w ?? null;
  mem.original_px_h = d.originalPx?.h ?? null;
  mem.print_px_w = d.printPx?.w ?? null;
  mem.print_px_h = d.printPx?.h ?? null;
  mem.file_size = totalSize;
  mem.extra_photo_paths = extraUris;
  mem.thumb_url = mem.local_thumb_path ?? mem.local_media_path;
  mem.display_url = mem.local_display_path ?? mem.thumb_url;
  return stampAlbumFp(mem);
}

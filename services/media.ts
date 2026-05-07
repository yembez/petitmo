import { supabase } from '@/lib/supabase';
import { getCachedUserMode } from '@/lib/userMode';
import * as FileSystem from 'expo-file-system';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import { DeviceEventEmitter, Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { Database } from '@/types/database';
import type { Memory } from '@/types/local';
import type { UploadStatus } from '@/types/local';
import { ensureLocalPhotoDerivatives, persistOriginalToSandbox } from '@/services/memoryLocalStore';
import {
  mergeServerMemoryRowWithExistingLocal,
  withLocalFields,
  type MemoryRowDb,
} from '@/services/memoryRowMapping';
import { pullMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync';
import { checkMemoryLimit, checkVideoLimit, MEDIA_BOOK_PRINT_MAX_WIDTH } from '@/lib/limits';
import { getUserTier } from '@/lib/userTier';
import { deleteLocalMediaFiles } from '@/lib/localCleanup';
import {
  clearFeedLocalThumbnails,
  clearFeedLocalVideo,
  persistFeedLocalThumbnail,
  persistFeedLocalVideo,
  setFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';
import { IMPORT_DUPLICATE_ASSET } from '@/lib/importDuplicate';
import {
  deleteLocalMemory,
  findMemoryIdByImportAssetId,
  findMemoryIdByImportFingerprint,
  getLocalMemories,
  getLocalMemoryById,
  updateLocalMemoryContent,
  updateLocalMemoryFavorite,
  updateLocalMemoryFavoritePhotoUrls,
  updateLocalMemoryLocation,
  updateLocalMemoryUrls,
  upsertLocalMemories,
  upsertLocalMemory,
} from '@/lib/localDb';
import { captureMemoryLocalOnly, capturePhotoAlbumLocalOnly } from '@/services/localOnlyMemoryCapture';
import { getSignedUrlAfterMediaUpload } from '@/lib/mediaSignedUrl';

export type MemoryRow = Memory;

export type MediaType = 'photo' | 'video' | 'voice';

interface UploadMediaParams {
  uri: string;
  type: MediaType;
  childId: string;
  /** (temporaire) : payant = upload full ; gratuit = upload stratifié */
  isPaid?: boolean;
  duration?: number;
  /** Photo d’illustration optionnelle (souvenirs vocaux uniquement) */
  voiceCoverUri?: string | null;
  /** Début de l’extrait (s) quand le fichier uploadé est la prise complète (pas de découpe native). */
  voicePlaybackStartSec?: number | null;
  /** Date/heure de prise (ex. EXIF photothèque) — fixe `created_at` du souvenir */
  capturedAtIso?: string;
  /** Lieu issu des métadonnées (ex. EXIF + géocodage) ; sinon position actuelle ou null */
  locationOverride?: string | null;
  /** Issu du picker (vidéo) — bonne extension / Content-Type (ex. .mov, video/quicktime) */
  mimeType?: string | null;
  fileName?: string | null;
  /**
   * Import lot « un post par photo » : pas d’émission `memories-inserted` par image
   * (le lot émet une seule fois depuis le contexte pending → ordre stable, moins de re-renders).
   */
  suppressFeedEmit?: boolean;
  /** Photothèque uniquement — évite un second import du même média pour cet enfant. */
  importAssetId?: string | null;
}

function throwIfImportDuplicate(
  childId: string,
  keys: { importAssetId?: string | null; importSourceFingerprint?: string | null }
): void {
  const aid = keys.importAssetId?.trim();
  if (aid && findMemoryIdByImportAssetId(childId, aid)) {
    throw new Error(IMPORT_DUPLICATE_ASSET);
  }
  const fp = keys.importSourceFingerprint?.trim();
  if (fp && findMemoryIdByImportFingerprint(childId, fp)) {
    throw new Error(IMPORT_DUPLICATE_ASSET);
  }
}

async function readBytes(uri: string): Promise<{ bytes: Blob | Uint8Array; size: number }> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return { bytes: blob, size: blob.size };
  }
  const file = new FileSystem.File(uri);
  const b = await file.bytes();
  return { bytes: b, size: b.length };
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

async function generateAndUploadVideoThumb(params: {
  userId: string;
  childId: string;
  localPath: string;
  durationSec?: number;
}): Promise<{ url: string; size: number; path: string } | null> {
  try {
    const timeMs =
      typeof params.durationSec === 'number' && Number.isFinite(params.durationSec) && params.durationSec > 1
        ? Math.floor(params.durationSec * 0.2 * 1000)
        : 0;
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(params.localPath, {
      time: timeMs,
      quality: 0.7,
    });
    const ts = Date.now();
    const filePath = `${params.userId}/${params.childId}/derived/video_thumb_${ts}.jpg`;
    const { bytes, size } = await readBytes(thumbUri);
    const url = await uploadToMediaBucket({
      filePath,
      bytes,
      contentType: 'image/jpeg',
    });
    return { url, size, path: filePath };
  } catch {
    return null;
  }
}

async function uploadToMediaBucket(params: {
  filePath: string;
  bytes: Blob | Uint8Array;
  contentType: string;
}): Promise<string> {
  const { error } = await supabase.storage.from('media').upload(params.filePath, params.bytes, {
    contentType: params.contentType,
    upsert: false,
  });
  if (error) throw error;
  return getSignedUrlAfterMediaUpload(params.filePath);
}

export async function uploadFileToSupabase(localUri: string, storagePath: string): Promise<string> {
  const cleanPath = storagePath.replace(/^\/?media\//, '')
  const { bytes } = await readBytes(localUri)
  const ext = extensionFromUri(cleanPath, 'bin')
  const contentType = ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'mp4'
          ? 'video/mp4'
          : 'application/octet-stream'

  return await uploadToMediaBucket({
    filePath: cleanPath,
    bytes,
    contentType,
  })
}

async function createPhotoVariant(
  uri: string,
  resizeWidth: number,
  compress: number
): Promise<string> {
  if (Platform.OS === 'web') return uri;
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: resizeWidth } }],
    { compress, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipulated.uri;
}

/**
 * Upload stratifié selon gratuit/payant et type média.
 * Retourne les champs média pour l’insert Supabase et le `upload_status` côté client (local / withLocalFields).
 */
async function stratifiedUpload(params: {
  userId: string;
  childId: string;
  type: MediaType;
  uri: string;
  isPaid: boolean;
  durationSec?: number;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<{
  upload_status: UploadStatus;
  file_size: number;
  media_url: string | null;
  media_path: string | null;
  thumb_url: string | null;
  display_url: string | null;
  print_url: string | null;
  poster_url: string | null;
  thumbnail_url: string | null;
}> {
  const { userId, childId, type, uri, isPaid, durationSec, mimeType, fileName } = params;

  if (type === 'voice') {
    // Toujours uploader l’audio intégralement
    const fileExt = extensionFromUri(uri, 'm4a');
    const storageFileName = `${Date.now()}.${fileExt}`;
    const filePath = `${userId}/${childId}/voice/${storageFileName}`;
    const { bytes, size } = await readBytes(uri);
    const publicUrl = await uploadToMediaBucket({
      filePath,
      bytes,
      contentType: getContentType('voice', fileExt),
    });
    return {
      upload_status: 'full',
      file_size: size,
      media_url: publicUrl,
      media_path: filePath,
      thumb_url: null,
      display_url: null,
      print_url: null,
      poster_url: null,
      thumbnail_url: null,
    };
  }

  if (type === 'video') {
    const ts = Date.now();

    // Gratuit ET payant : uploader la vidéo (qualité originale, pas de compression).
    const fileExt = inferVideoExtension(uri, mimeType, fileName);
    const storageFileName = `${ts}.${fileExt}`;
    const filePath = `${userId}/${childId}/video/${storageFileName}`;
    const { bytes: videoBytes, size: videoSize } = await readBytes(uri);
    const mediaUrl = await uploadToMediaBucket({
      filePath,
      bytes: videoBytes,
      contentType: getVideoContentType(fileExt),
    });

    // Thumbnail toujours généré + uploadé (dérivé).
    const thumbUp = await generateAndUploadVideoThumb({
      userId,
      childId,
      localPath: uri,
      durationSec,
    });

    return {
      upload_status: 'full',
      file_size: videoSize + (thumbUp?.size ?? 0),
      media_url: mediaUrl,
      media_path: filePath,
      thumb_url: null,
      display_url: null,
      print_url: null,
      poster_url: null,
      thumbnail_url: thumbUp?.url ?? null,
    };
  }

  // PHOTO
  // Toujours uploader print + thumb. En payant : uploader aussi l’original.
  const ts = Date.now();
  const thumbLocal = await createPhotoVariant(uri, 480, 0.7);
  const printLocal = await createPhotoVariant(uri, MEDIA_BOOK_PRINT_MAX_WIDTH, 0.82);

  const thumbPath = `${userId}/${childId}/photo/thumb_${ts}.jpg`;
  const printPath = `${userId}/${childId}/photo/print_${ts}.jpg`;

  const [{ bytes: thumbBytes, size: thumbSize }, { bytes: printBytes, size: printSize }] =
    await Promise.all([readBytes(thumbLocal), readBytes(printLocal)]);

  const [thumbUrl, printUrl] = await Promise.all([
    uploadToMediaBucket({ filePath: thumbPath, bytes: thumbBytes, contentType: 'image/jpeg' }),
    uploadToMediaBucket({ filePath: printPath, bytes: printBytes, contentType: 'image/jpeg' }),
  ]);

  if (!isPaid) {
    return {
      upload_status: 'print_only',
      file_size: thumbSize + printSize,
      media_url: null,
      media_path: null,
      thumb_url: thumbUrl,
      display_url: thumbUrl,
      print_url: printUrl,
      poster_url: null,
      thumbnail_url: null,
    };
  }

  // Paid: upload original too (using existing compression path for photo)
  const up = await readAndUploadPhotoFile(uri, userId, childId);
  return {
    upload_status: 'full',
    file_size: up.size + thumbSize + printSize,
    media_url: up.publicUrl,
    media_path: up.path,
    thumb_url: thumbUrl,
    display_url: thumbUrl,
    print_url: printUrl,
    poster_url: null,
    thumbnail_url: null,
  };
}

/** Cover vocal : même cible que le dérivé photo `print_*` (livre A5 / PDF). */
async function prepareLocalUriForVoiceCoverUpload(coverUri: string): Promise<string> {
  const trimmed = coverUri.trim();
  if (!trimmed || Platform.OS === 'web') return trimmed;
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      trimmed,
      [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipulated?.uri?.trim() ? manipulated.uri : trimmed;
  } catch {
    return trimmed;
  }
}

async function uploadVoiceCoverToStorage(
  userId: string,
  childId: string,
  coverUri: string
): Promise<{ publicUrl: string; path: string } | null> {
  const sourceUri = await prepareLocalUriForVoiceCoverUpload(coverUri);
  let fileData: Blob | Uint8Array;
  let fileExt = sourceUri.split('.').pop()?.split('?')[0] || 'jpg';
  if (Platform.OS !== 'web' && sourceUri !== coverUri.trim()) {
    fileExt = 'jpg';
  } else if (!['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(fileExt.toLowerCase())) {
    fileExt = 'jpg';
  }

  if (Platform.OS === 'web') {
    const response = await fetch(sourceUri);
    fileData = await response.blob();
  } else {
    const file = new FileSystem.File(sourceUri);
    fileData = await file.bytes();
  }

  const fileName = `cover_${Date.now()}.${fileExt}`;
  const filePath = `${userId}/${childId}/voice/${fileName}`;
  const contentType =
    fileExt === 'png' ? 'image/png' : fileExt === 'webp' ? 'image/webp' : 'image/jpeg';

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, fileData, { contentType, upsert: false });

  if (uploadError) {
    console.error('Voice cover upload error:', uploadError);
    return null;
  }

  const publicUrl = await getSignedUrlAfterMediaUpload(filePath);
  return { publicUrl, path: filePath };
}

/** Upload cover vocal (image locale ou déjà optimisée) vers le bucket `media`. */
export async function uploadVoiceCoverToSupabaseFromLocal(
  userId: string,
  childId: string,
  localCoverUri: string
): Promise<{ publicUrl: string; path: string } | null> {
  return uploadVoiceCoverToStorage(userId, childId, localCoverUri);
}

/** Évite les rafales (backfill + requestMissing + refresh) sur le même souvenir. */
const processMemoryLastInvoke = new Map<string, number>();
/** Anti-spam par souvenir ; assez court pour ne pas bloquer les retries après backfill parallèle. */
const PROCESS_MEMORY_THROTTLE_MS = 3500;

function functionsHttpErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const ctx = (error as { context?: { status?: number } }).context;
  return typeof ctx?.status === 'number' ? ctx.status : undefined;
}

async function functionsHttpErrorBodyPreview(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return '';
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.clone !== 'function') return '';
  try {
    const t = await ctx.clone().text();
    return (t || '').trim().slice(0, 500);
  } catch {
    return '';
  }
}

async function triggerProcessMemory(memoryId: string): Promise<void> {
  const now = Date.now();
  const last = processMemoryLastInvoke.get(memoryId) ?? 0;
  if (now - last < PROCESS_MEMORY_THROTTLE_MS) return;
  processMemoryLastInvoke.set(memoryId, now);

  if ((await getCachedUserMode()) === 'local') return;

  try {
    const { data, error } = await supabase.functions.invoke('process-memory', { body: { memoryId } });
    if (error) {
      const status = functionsHttpErrorStatus(error);
      const body = await functionsHttpErrorBodyPreview(error);
      const hint =
        status === 500 && /Worker not configured|worker/i.test(body)
          ? ' → vérifier secrets Supabase MEDIA_WORKER_URL + MEDIA_WORKER_SECRET'
          : body.includes('UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM')
            ? ' → JWT ES256: supabase/config.toml verify_jwt = false sur la function puis supabase functions deploy'
            : status === 401 || status === 403
              ? ' → session / droits (Edge Function)'
              : '';
      console.warn(
        '[media] process-memory',
        memoryId,
        status != null ? `HTTP ${status}` : (error as Error).name,
        body || (error as Error).message || String(error),
        hint
      );
      return;
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
      console.warn('[media] process-memory body error', memoryId, (data as { error: unknown }).error);
    }
  } catch (e) {
    console.warn('[media] triggerProcessMemory exception', memoryId, e);
  }
}

/**
 * Redemande la génération des dérivés (thumb/display/poster) pour les lignes qui n’en ont pas encore.
 * Le fil n’affiche pas `media_url` : sans dérivés, l’utilisateur voit un placeholder alors que Favoris
 * pouvait encore retomber sur l’original via `thumbUri`.
 */
export async function requestMissingMediaDerivatives(
  rows: MemoryRow[],
  options?: { max?: number; batchSize?: number }
): Promise<void> {
  if ((await getCachedUserMode()) === 'local') return;

  const max = options?.max ?? 36;
  const batchSize = options?.batchSize ?? 8;
  const ids: string[] = [];

  for (const m of rows) {
    const path = (m.media_path ?? '').trim();
    if (!path) continue;

    if (m.type === 'photo') {
      const hasThumb = !!(m.thumb_url ?? '').trim();
      const hasDisplay = !!(m.display_url ?? '').trim();
      if (!hasThumb && !hasDisplay) ids.push(m.id);
      continue;
    }
    if (m.type === 'video') {
      const hasPoster = !!(m.poster_url ?? '').trim() || !!(m.thumbnail_url ?? '').trim();
      if (!hasPoster) ids.push(m.id);
    }
  }

  const slice = ids.slice(0, max);
  for (let i = 0; i < slice.length; i += batchSize) {
    const batch = slice.slice(i, i + batchSize);
    await Promise.all(batch.map(id => triggerProcessMemory(id)));
  }
}

async function triggerDeleteMemoryAssets(memoryId: string): Promise<void> {
  try {
    await supabase.functions.invoke('delete-memory-assets', { body: { memoryId } });
  } catch (e) {
    console.warn('[media] triggerDeleteMemoryAssets failed', e);
  }
}

function extensionFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0];
  const base = clean.split('/').pop() ?? clean;
  const dot = base.lastIndexOf('.');
  if (dot >= 0 && dot < base.length - 1) return base.slice(dot + 1).toLowerCase();
  return fallback;
}

function inferVideoExtension(uri: string, mimeType?: string | null, fileName?: string | null): string {
  const fromName = fileName?.split('/').pop()?.split('?')[0];
  if (fromName?.includes('.')) {
    const e = fromName.split('.').pop()?.toLowerCase();
    if (e && e.length <= 5 && /^[a-z0-9]+$/i.test(e)) return e;
  }
  const noQuery = uri.split('?')[0];
  const fromUri = noQuery.includes('.') ? noQuery.split('.').pop()?.toLowerCase() : undefined;
  if (fromUri && fromUri.length <= 5) return fromUri;
  const m = mimeType?.toLowerCase() ?? '';
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('m4v')) return 'm4v';
  return 'mp4';
}

function getVideoContentType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'mov' || e === 'qt') return 'video/quicktime';
  if (e === 'm4v') return 'video/x-m4v';
  if (e === 'webm') return 'video/webm';
  return 'video/mp4';
}

function storagePathFromPublicUrl(publicUrl: string | null | undefined): string | null {
  const u = (publicUrl ?? '').trim();
  if (!u) return null;
  try {
    const url = new URL(u);
    // Formats possibles:
    // - /storage/v1/object/public/media/<path>
    // - /storage/v1/object/media/<path>
    const m = url.pathname.match(/\/storage\/v1\/object\/(?:public\/)?media\/(.+)$/);
    if (!m?.[1]) return null;
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function jsonArrayStrings(value: unknown): string[] {
  const arr: unknown[] = Array.isArray(value) ? value : [];
  return arr
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(s => s.trim());
}

async function backfillStoragePathsBestEffort(rows: MemoryRow[]): Promise<void> {
  // On met à jour uniquement si on peut déduire un path stable depuis les URLs publiques.
  // Best-effort : pas de throw.
  try {
    if ((await getCachedUserMode()) === 'local') return;

    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const toTrigger: string[] = [];

    for (const m of rows) {
      const patch: Record<string, unknown> = {};

      if (!m.media_path && m.media_url) {
        const p = storagePathFromPublicUrl(m.media_url);
        if (p) patch.media_path = p;
      }

      if (!m.voice_cover_path && m.voice_cover_url) {
        const p = storagePathFromPublicUrl(m.voice_cover_url);
        if (p) patch.voice_cover_path = p;
      }

      if (!m.thumbnail_path && m.thumbnail_url) {
        const p = storagePathFromPublicUrl(m.thumbnail_url);
        if (p) patch.thumbnail_path = p;
      }

      if (Array.isArray(m.extra_photo_urls) && (!Array.isArray(m.extra_photo_paths) || m.extra_photo_paths.length === 0)) {
        const extraUrls = jsonArrayStrings(m.extra_photo_urls);
        const extraPaths = extraUrls.map(u => storagePathFromPublicUrl(u)).filter((p): p is string => !!p);
        if (extraPaths.length === extraUrls.length && extraPaths.length > 0) {
          patch.extra_photo_paths = extraPaths;
        }
      }

      if (Object.keys(patch).length > 0) {
        updates.push({ id: m.id, patch });
      }

      // Déclenchement dérivés (même si aucun patch): si on a un path mais pas encore de dérivés
      const needsVideoPoster =
        m.type === 'video' &&
        !!m.media_path &&
        !(m.poster_url?.trim() || m.thumbnail_url?.trim());

      const needsPhotoDerivatives =
        m.type === 'photo' &&
        !!m.media_path &&
        !(m.thumb_url?.trim() || m.display_url?.trim());

      if (needsVideoPoster || needsPhotoDerivatives) {
        toTrigger.push(m.id);
      }
    }

    // Mises à jour en parallèle (beaucoup plus rapide que 30 UPDATE séquentiels).
    const UPDATE_CAP = 40;
    const UPDATE_CONCURRENCY = 10;
    const updateSlice = updates.slice(0, UPDATE_CAP);
    const patchedIds = new Set<string>();

    for (let i = 0; i < updateSlice.length; i += UPDATE_CONCURRENCY) {
      const chunk = updateSlice.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(
        chunk.map(async u => {
          const { error: upErr } = await supabase.from('memories').update(u.patch).eq('id', u.id);
          if (upErr) {
            console.warn('[media] backfillStoragePaths update failed', u.id, upErr);
            return;
          }
          patchedIds.add(u.id);
          const row = rows.find(r => r.id === u.id);
          if (row) Object.assign(row as object, u.patch);
          void triggerProcessMemory(u.id);
        })
      );
    }

    // Déclenchements sans patch : éviter les doublons avec les lignes déjà patchées + traiter en parallèle.
    const TRIGGER_CAP = 40;
    const TRIGGER_CONCURRENCY = 8;
    const triggerIds = toTrigger.filter(id => !patchedIds.has(id)).slice(0, TRIGGER_CAP);
    for (let i = 0; i < triggerIds.length; i += TRIGGER_CONCURRENCY) {
      const chunk = triggerIds.slice(i, i + TRIGGER_CONCURRENCY);
      await Promise.all(chunk.map(id => triggerProcessMemory(id)));
    }
  } catch (e) {
    console.warn('[media] backfillStoragePaths failed', e);
  }
}

/** UUID v4 sans `crypto.randomUUID` (Hermes / RN : parfois absent alors que `crypto` existe). */
function randomUUIDv4Fallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Id UUID pour `memories` Supabase (évite le préfixe `loc_` du mode gratuit). */
function newCloudSyncMemoryId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return randomUUIDv4Fallback();
}

/**
 * Petitmo+ photo native : upload Storage + insert Supabase en arrière-plan après affichage local.
 */
async function syncCloudPhotoMemoryInBackground(params: {
  memoryId: string;
  childId: string;
  userId: string;
  localOriginalUri: string;
  isPaid: boolean;
  capturedAtIso?: string;
  locationLabel: string | null;
}): Promise<void> {
  const { memoryId, childId, userId, localOriginalUri, isPaid, capturedAtIso, locationLabel } = params;
  try {
    const uploaded = await stratifiedUpload({
      userId,
      childId,
      type: 'photo',
      uri: localOriginalUri,
      isPaid,
    });

    const insertedAt = new Date().toISOString();
    const insertPayload: Database['public']['Tables']['memories']['Insert'] = {
      id: memoryId,
      child_id: childId,
      user_id: userId,
      type: 'photo',
      content: null,
      media_url: uploaded.media_url,
      media_path: uploaded.media_path,
      thumb_url: uploaded.thumb_url,
      display_url: uploaded.display_url,
      print_url: uploaded.print_url,
      poster_url: uploaded.poster_url,
      thumbnail_url: uploaded.thumbnail_url,
      extra_photo_urls: [],
      extra_photo_paths: [],
      extra_thumb_urls: [],
      extra_display_urls: [],
      favorite_photo_urls: [],
      duration: null,
      file_size: uploaded.file_size,
      location: locationLabel,
      voice_cover_url: null,
      voice_cover_path: null,
      voice_playback_start_sec: null,
      edited_media_url: null,
      is_favorite: false,
      inserted_at: insertedAt,
      captured_overlay_ink: null,
    };
    if (capturedAtIso) {
      insertPayload.created_at = capturedAtIso;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('memories')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;
    if (!insertedRow?.id) return;

    void triggerProcessMemory(insertedRow.id);

    const prev = getLocalMemoryById(insertedRow.id);
    const base = withLocalFields(insertedRow, { clientUploadStatus: uploaded.upload_status });
    const out: Memory = {
      ...base,
      local_media_path: prev?.local_media_path ?? prev?.local_thumb_path ?? localOriginalUri,
      local_original_path: prev?.local_original_path ?? localOriginalUri,
      local_thumb_path: prev?.local_thumb_path ?? null,
      local_display_path: prev?.local_display_path ?? null,
      local_print_path: prev?.local_print_path ?? null,
      original_px_w: prev?.original_px_w ?? null,
      original_px_h: prev?.original_px_h ?? null,
      print_px_w: prev?.print_px_w ?? null,
      print_px_h: prev?.print_px_h ?? null,
      sync_status: 'synced',
      import_asset_id: prev?.import_asset_id ?? null,
      import_source_fingerprint: prev?.import_source_fingerprint ?? null,
    };
    upsertLocalMemory(out);
    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: insertedRow.id });
  } catch (e) {
    console.warn('[media] syncCloudPhotoMemoryInBackground', params.memoryId, e);
  }
}

/** Petitmo+ vidéo native : sandbox + fil immédiat, Storage + insert en arrière-plan. */
async function syncCloudVideoMemoryInBackground(params: {
  memoryId: string;
  childId: string;
  userId: string;
  localOriginalUri: string;
  isPaid: boolean;
  durationSec?: number;
  mimeType?: string | null;
  fileName?: string | null;
  capturedAtIso?: string;
  locationLabel: string | null;
}): Promise<void> {
  const {
    memoryId,
    childId,
    userId,
    localOriginalUri,
    isPaid,
    durationSec,
    mimeType,
    fileName,
    capturedAtIso,
    locationLabel,
  } = params;
  try {
    const uploaded = await stratifiedUpload({
      userId,
      childId,
      type: 'video',
      uri: localOriginalUri,
      isPaid,
      durationSec,
      mimeType,
      fileName,
    });

    const insertedAt = new Date().toISOString();
    const insertPayload: Database['public']['Tables']['memories']['Insert'] = {
      id: memoryId,
      child_id: childId,
      user_id: userId,
      type: 'video',
      content: null,
      media_url: uploaded.media_url,
      media_path: uploaded.media_path,
      thumb_url: uploaded.thumb_url,
      display_url: uploaded.display_url,
      print_url: uploaded.print_url,
      poster_url: uploaded.poster_url,
      thumbnail_url: uploaded.thumbnail_url,
      extra_photo_urls: [],
      extra_photo_paths: [],
      extra_thumb_urls: [],
      extra_display_urls: [],
      favorite_photo_urls: [],
      duration: typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : null,
      file_size: uploaded.file_size,
      location: locationLabel,
      voice_cover_url: null,
      voice_cover_path: null,
      voice_playback_start_sec: null,
      edited_media_url: null,
      is_favorite: false,
      inserted_at: insertedAt,
      captured_overlay_ink: null,
    };
    if (capturedAtIso) {
      insertPayload.created_at = capturedAtIso;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('memories')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;
    if (!insertedRow?.id) return;

    void triggerProcessMemory(insertedRow.id);

    const prev = getLocalMemoryById(insertedRow.id);
    const base = withLocalFields(insertedRow, { clientUploadStatus: uploaded.upload_status });
    const out: Memory = {
      ...base,
      local_media_path: prev?.local_media_path ?? null,
      local_original_path: prev?.local_original_path ?? localOriginalUri,
      local_thumb_path: prev?.local_thumb_path ?? null,
      local_display_path: prev?.local_display_path ?? null,
      local_print_path: prev?.local_print_path ?? null,
      original_px_w: prev?.original_px_w ?? null,
      original_px_h: prev?.original_px_h ?? null,
      print_px_w: prev?.print_px_w ?? null,
      print_px_h: prev?.print_px_h ?? null,
      sync_status: 'synced',
      import_asset_id: prev?.import_asset_id ?? null,
      import_source_fingerprint: prev?.import_source_fingerprint ?? null,
    };
    upsertLocalMemory(out);
    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: insertedRow.id });
  } catch (e) {
    console.warn('[media] syncCloudVideoMemoryInBackground', params.memoryId, e);
  }
}

/** Petitmo+ vocal native : sandbox + fil immédiat, cover + audio + insert en arrière-plan. */
async function syncCloudVoiceMemoryInBackground(params: {
  memoryId: string;
  childId: string;
  userId: string;
  localVoiceUri: string;
  localVoiceCoverUri: string | null;
  isPaid: boolean;
  durationSec?: number | null;
  voicePlaybackStartSec: number | null;
  capturedAtIso?: string;
  locationLabel: string | null;
}): Promise<void> {
  const {
    memoryId,
    childId,
    userId,
    localVoiceUri,
    localVoiceCoverUri,
    isPaid,
    durationSec,
    voicePlaybackStartSec,
    capturedAtIso,
    locationLabel,
  } = params;
  try {
    let voiceCoverPublicUrl: string | null = null;
    let voiceCoverPath: string | null = null;
    if (localVoiceCoverUri?.trim()) {
      const up = await uploadVoiceCoverToStorage(userId, childId, localVoiceCoverUri.trim());
      voiceCoverPublicUrl = up?.publicUrl ?? null;
      voiceCoverPath = up?.path ?? null;
    }

    const uploaded = await stratifiedUpload({
      userId,
      childId,
      type: 'voice',
      uri: localVoiceUri,
      isPaid,
    });

    const insertedAt = new Date().toISOString();
    const insertPayload: Database['public']['Tables']['memories']['Insert'] = {
      id: memoryId,
      child_id: childId,
      user_id: userId,
      type: 'voice',
      content: null,
      media_url: uploaded.media_url,
      media_path: uploaded.media_path,
      thumb_url: uploaded.thumb_url,
      display_url: uploaded.display_url,
      print_url: uploaded.print_url,
      poster_url: uploaded.poster_url,
      thumbnail_url: uploaded.thumbnail_url,
      extra_photo_urls: [],
      extra_photo_paths: [],
      extra_thumb_urls: [],
      extra_display_urls: [],
      favorite_photo_urls: [],
      duration:
        typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : null,
      file_size: uploaded.file_size,
      location: locationLabel,
      voice_cover_url: voiceCoverPublicUrl,
      voice_cover_path: voiceCoverPath,
      voice_playback_start_sec: voicePlaybackStartSec,
      edited_media_url: null,
      is_favorite: false,
      inserted_at: insertedAt,
      captured_overlay_ink: null,
    };
    if (capturedAtIso) {
      insertPayload.created_at = capturedAtIso;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('memories')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;
    if (!insertedRow?.id) return;

    void triggerProcessMemory(insertedRow.id);

    const prev = getLocalMemoryById(insertedRow.id);
    const base = withLocalFields(insertedRow, { clientUploadStatus: uploaded.upload_status });
    const out: Memory = {
      ...base,
      local_media_path: prev?.local_media_path ?? localVoiceUri,
      local_original_path: prev?.local_original_path ?? localVoiceUri,
      local_thumb_path: prev?.local_thumb_path ?? null,
      local_display_path: prev?.local_display_path ?? null,
      local_print_path: prev?.local_print_path ?? null,
      original_px_w: prev?.original_px_w ?? null,
      original_px_h: prev?.original_px_h ?? null,
      print_px_w: prev?.print_px_w ?? null,
      print_px_h: prev?.print_px_h ?? null,
      sync_status: 'synced',
      import_asset_id: prev?.import_asset_id ?? null,
      import_source_fingerprint: prev?.import_source_fingerprint ?? null,
    };
    upsertLocalMemory(out);
    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: insertedRow.id });
  } catch (e) {
    console.warn('[media] syncCloudVoiceMemoryInBackground', params.memoryId, e);
  }
}

export async function uploadMedia({
  uri,
  type,
  childId,
  isPaid,
  duration,
  voiceCoverUri,
  voicePlaybackStartSec,
  capturedAtIso,
  locationOverride,
  mimeType,
  fileName,
  suppressFeedEmit = false,
  importAssetId,
}: UploadMediaParams): Promise<MemoryRow | null> {
  console.log('[uploadMedia] called', { type, childId });
  try {
    const limitCheck = await checkMemoryLimit(childId);
    if (!limitCheck.canCreate) {
      throw new Error('LIMIT_REACHED');
    }

    if (type === 'video') {
      const videoLimitCheck = await checkVideoLimit(childId);
      if (!videoLimitCheck.canCreate) {
        throw new Error('VIDEO_LIMIT_REACHED');
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    throwIfImportDuplicate(childId, { importAssetId });

    if ((await getCachedUserMode()) === 'local') {
      const localMem = await captureMemoryLocalOnly({
        uri,
        type,
        childId,
        userId: user.id,
        duration,
        voiceCoverUri,
        voicePlaybackStartSec,
        capturedAtIso,
        locationOverride,
        importAssetId,
      });
      if (localMem) {
        upsertLocalMemory(localMem);
        if (!suppressFeedEmit) {
          DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [localMem] });
        }
        return localMem;
      }
      return null;
    }

    const paid = isPaid ?? (await getUserTier()) === 'paid';

    /** Import photothèque : lieu EXIF (peut être null). Sinon position actuelle approximative. */
    const locationLabel =
      locationOverride !== undefined ? locationOverride : null;

    // Petitmo+ photo (native) : sandbox + fil immédiat, sync Storage/Supabase en arrière-plan.
    if (type === 'photo' && Platform.OS !== 'web') {
      const insertedAt = new Date().toISOString();
      const createdAt = capturedAtIso?.trim() || insertedAt;
      const memoryId = newCloudSyncMemoryId();

      const { localOriginalUri } = await persistOriginalToSandbox({
        memoryId,
        type: 'photo',
        sourceUri: uri,
      });
      const src = (localOriginalUri ?? uri).trim();
      const d = await ensureLocalPhotoDerivatives({ memoryId, localOriginalUri: src });
      await persistFeedLocalThumbnail(memoryId, uri, 0);

      let fileSize = 0;
      try {
        fileSize = (await readBytes(src)).size;
      } catch {
        fileSize = 0;
      }

      const localThumb = d.localThumbUri ?? src;
      const mem: Memory = {
        id: memoryId,
        child_id: childId,
        user_id: user.id,
        type: 'photo',
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
        file_size: fileSize,
        location: locationLabel,
        inserted_at: insertedAt,
        captured_overlay_ink: null,
        thumb_url: localThumb,
        display_url: d.localDisplayUri ?? localThumb,
        print_url: null,
        poster_url: null,
        poster_print_url: null,
        upload_status: 'pending',
        created_at: createdAt,
        updated_at: insertedAt,
        local_media_path: localThumb,
        local_original_path: localOriginalUri,
        local_thumb_path: d.localThumbUri,
        local_display_path: d.localDisplayUri,
        local_print_path: d.localPrintUri,
        original_px_w: d.originalPx?.w ?? null,
        original_px_h: d.originalPx?.h ?? null,
        print_px_w: d.printPx?.w ?? null,
        print_px_h: d.printPx?.h ?? null,
        synced_at: null,
        sync_status: 'pending',
        import_asset_id: importAssetId?.trim() ? importAssetId.trim() : null,
      };

      upsertLocalMemory(mem);
      if (!suppressFeedEmit) {
        DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [mem] });
      }
      void syncCloudPhotoMemoryInBackground({
        memoryId,
        childId,
        userId: user.id,
        localOriginalUri: src,
        isPaid: paid,
        capturedAtIso,
        locationLabel,
      });
      return mem;
    }

    // Petitmo+ vidéo (native) : sandbox + copie fil + poster local, sync en arrière-plan.
    if (type === 'video' && Platform.OS !== 'web') {
      const insertedAt = new Date().toISOString();
      const createdAt = capturedAtIso?.trim() || insertedAt;
      const memoryId = newCloudSyncMemoryId();

      const { localOriginalUri } = await persistOriginalToSandbox({
        memoryId,
        type: 'video',
        sourceUri: uri,
      });
      const src = (localOriginalUri ?? uri).trim();

      let fileSize = 0;
      try {
        fileSize = (await readBytes(src)).size;
      } catch {
        fileSize = 0;
      }

      const feedPath = await persistFeedLocalVideo(memoryId, uri);
      const mediaPathLocal = feedPath ?? src;

      let thumbDest: string | null = null;
      try {
        const { uri: thumbTmp } = await VideoThumbnails.getThumbnailAsync(mediaPathLocal, {
          time: 0,
          quality: 0.7,
        });
        if (thumbTmp?.trim() && documentDirectory) {
          const dir = `${documentDirectory}petitmo_memories/${memoryId}/`;
          await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
          thumbDest = `${dir}poster.jpg`;
          await copyAsync({ from: thumbTmp.trim(), to: thumbDest }).catch(() => {
            thumbDest = null;
          });
        }
      } catch {
        thumbDest = null;
      }

      setFeedBootstrapVideoUri(memoryId, mediaPathLocal);

      const mem: Memory = {
        id: memoryId,
        child_id: childId,
        user_id: user.id,
        type: 'video',
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
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
        thumbnail_url: thumbDest,
        thumbnail_path: null,
        file_size: fileSize,
        location: locationLabel,
        inserted_at: insertedAt,
        captured_overlay_ink: null,
        thumb_url: null,
        display_url: null,
        print_url: null,
        poster_url: thumbDest,
        poster_print_url: null,
        upload_status: 'pending',
        created_at: createdAt,
        updated_at: insertedAt,
        local_media_path: mediaPathLocal,
        local_original_path: localOriginalUri,
        local_thumb_path: null,
        local_display_path: null,
        local_print_path: null,
        original_px_w: null,
        original_px_h: null,
        print_px_w: null,
        print_px_h: null,
        synced_at: null,
        sync_status: 'pending',
        import_asset_id: importAssetId?.trim() ? importAssetId.trim() : null,
      };

      upsertLocalMemory(mem);
      if (!suppressFeedEmit) {
        DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [mem] });
      }
      void syncCloudVideoMemoryInBackground({
        memoryId,
        childId,
        userId: user.id,
        localOriginalUri: src,
        isPaid: paid,
        durationSec: duration,
        mimeType,
        fileName,
        capturedAtIso,
        locationLabel,
      });
      return mem;
    }

    // Petitmo+ vocal (native) : sandbox + couverture locale, sync en arrière-plan.
    if (type === 'voice' && Platform.OS !== 'web') {
      const insertedAt = new Date().toISOString();
      const createdAt = capturedAtIso?.trim() || insertedAt;
      const memoryId = newCloudSyncMemoryId();

      const { localOriginalUri } = await persistOriginalToSandbox({
        memoryId,
        type: 'voice',
        sourceUri: uri,
      });
      const src = (localOriginalUri ?? uri).trim();

      let fileSize = 0;
      try {
        fileSize = (await readBytes(src)).size;
      } catch {
        fileSize = 0;
      }

      let voiceCoverLocal: string | null = null;
      if (voiceCoverUri?.trim() && documentDirectory) {
        const dir = `${documentDirectory}petitmo_memories/${memoryId}/`;
        await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const ext = voiceCoverUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
        const dest = `${dir}voice_cover.${ext}`;
        try {
          await copyAsync({ from: voiceCoverUri.trim(), to: dest });
          voiceCoverLocal = dest;
        } catch {
          voiceCoverLocal = null;
        }
      }

      const vStart =
        typeof voicePlaybackStartSec === 'number' && Number.isFinite(voicePlaybackStartSec)
          ? voicePlaybackStartSec
          : null;

      const mem: Memory = {
        id: memoryId,
        child_id: childId,
        user_id: user.id,
        type: 'voice',
        content: null,
        media_url: src,
        media_path: null,
        extra_photo_urls: [],
        extra_photo_paths: [],
        extra_thumb_urls: [],
        extra_display_urls: [],
        favorite_photo_urls: [],
        voice_cover_url: voiceCoverLocal,
        voice_cover_path: voiceCoverLocal,
        voice_playback_start_sec: vStart,
        edited_media_url: null,
        is_favorite: false,
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
        thumbnail_url: null,
        thumbnail_path: null,
        file_size: fileSize,
        location: locationLabel,
        inserted_at: insertedAt,
        captured_overlay_ink: null,
        thumb_url: null,
        display_url: null,
        print_url: null,
        poster_url: null,
        poster_print_url: null,
        upload_status: 'pending',
        created_at: createdAt,
        updated_at: insertedAt,
        local_media_path: src,
        local_original_path: localOriginalUri,
        local_thumb_path: null,
        local_display_path: null,
        local_print_path: null,
        original_px_w: null,
        original_px_h: null,
        print_px_w: null,
        print_px_h: null,
        synced_at: null,
        sync_status: 'pending',
        import_asset_id: importAssetId?.trim() ? importAssetId.trim() : null,
      };

      upsertLocalMemory(mem);
      if (!suppressFeedEmit) {
        DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [mem] });
      }
      void syncCloudVoiceMemoryInBackground({
        memoryId,
        childId,
        userId: user.id,
        localVoiceUri: src,
        localVoiceCoverUri: voiceCoverLocal,
        isPaid: paid,
        durationSec: duration,
        voicePlaybackStartSec: vStart,
        capturedAtIso,
        locationLabel,
      });
      return mem;
    }

    const uploaded = await stratifiedUpload({
      userId: user.id,
      childId,
      type,
      uri,
      isPaid: paid,
      durationSec: duration,
      mimeType,
      fileName,
    });

    const memoryType = type === 'voice' ? 'voice' : type === 'video' ? 'video' : 'photo';

    let voiceCoverPublicUrl: string | null = null;
    let voiceCoverPath: string | null = null;
    if (type === 'voice' && voiceCoverUri) {
      const up = await uploadVoiceCoverToStorage(user.id, childId, voiceCoverUri);
      voiceCoverPublicUrl = up?.publicUrl ?? null;
      voiceCoverPath = up?.path ?? null;
    }

    const insertPayload: Database['public']['Tables']['memories']['Insert'] = {
      child_id: childId,
      user_id: user.id,
      type: memoryType,
      media_url: uploaded.media_url,
      media_path: uploaded.media_path,
      thumb_url: uploaded.thumb_url,
      display_url: uploaded.display_url,
      print_url: uploaded.print_url,
      poster_url: uploaded.poster_url,
      thumbnail_url: uploaded.thumbnail_url,
      extra_photo_urls: [],
      extra_photo_paths: [],
      extra_thumb_urls: [],
      extra_display_urls: [],
      duration: duration || null,
      file_size: uploaded.file_size,
      location: locationLabel,
      voice_cover_url: voiceCoverPublicUrl,
      voice_cover_path: voiceCoverPath,
      voice_playback_start_sec:
        type === 'voice' &&
        typeof voicePlaybackStartSec === 'number' &&
        Number.isFinite(voicePlaybackStartSec)
          ? voicePlaybackStartSec
          : null,
      inserted_at: new Date().toISOString(),
    };

    if (capturedAtIso) {
      insertPayload.created_at = capturedAtIso;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('memories')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;
    if (!insertedRow?.id) return null;

    if (memoryType === 'photo' && Platform.OS !== 'web') {
      await persistFeedLocalThumbnail(insertedRow.id, uri, 0);
    }
    if (memoryType === 'video' && Platform.OS !== 'web') {
      await persistFeedLocalVideo(insertedRow.id, uri);
    }
    void triggerProcessMemory(insertedRow.id);

    // Offline-first: conserver une copie durable dans le sandbox + dérivés locaux (qualité impression).
    let localOriginal: string | null = null;
    let localThumb: string | null = null;
    let localDisplay: string | null = null;
    let localPrint: string | null = null;
    let originalPxW: number | null = null;
    let originalPxH: number | null = null;
    let printPxW: number | null = null;
    let printPxH: number | null = null;
    if (Platform.OS !== 'web' && (memoryType === 'photo' || memoryType === 'video' || memoryType === 'voice')) {
      const persisted = await persistOriginalToSandbox({
        memoryId: insertedRow.id,
        type: memoryType,
        sourceUri: uri,
      });
      localOriginal = persisted.localOriginalUri;
      if (memoryType === 'photo' && localOriginal) {
        const d = await ensureLocalPhotoDerivatives({ memoryId: insertedRow.id, localOriginalUri: localOriginal });
        localThumb = d.localThumbUri;
        localDisplay = d.localDisplayUri;
        localPrint = d.localPrintUri;
        originalPxW = d.originalPx?.w ?? null;
        originalPxH = d.originalPx?.h ?? null;
        printPxW = d.printPx?.w ?? null;
        printPxH = d.printPx?.h ?? null;
      }
    }

    const out: Memory = {
      ...withLocalFields(insertedRow, { clientUploadStatus: uploaded.upload_status }),
      // Offline-first: pointer vers les fichiers durables en local.
      local_media_path: localOriginal ?? uri,
      local_original_path: localOriginal,
      local_thumb_path: localThumb,
      local_display_path: localDisplay,
      local_print_path: localPrint,
      original_px_w: originalPxW,
      original_px_h: originalPxH,
      print_px_w: printPxW,
      print_px_h: printPxH,
      sync_status: 'synced',
      import_asset_id: importAssetId?.trim() ? importAssetId.trim() : null,
    };
    upsertLocalMemory(out);
    return out;
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message === 'LIMIT_REACHED' ||
        error.message === 'VIDEO_LIMIT_REACHED' ||
        error.message === IMPORT_DUPLICATE_ASSET
      ) {
        throw error;
      }
    }
    console.error('Upload error:', error);
    return null;
  }
}

function getContentType(type: MediaType, ext: string): string {
  if (type === 'photo') {
    return ext === 'png' ? 'image/png' : 'image/jpeg';
  }
  if (type === 'video') {
    return 'video/mp4';
  }
  return 'audio/m4a';
}

/**
 * Upload une image locale vers le bucket `media`, retourne l’URL publique et la taille.
 */
async function readAndUploadPhotoFile(
  uri: string,
  userId: string,
  childId: string
): Promise<{ publicUrl: string; size: number; path: string; compressedLocalUri?: string }> {
  let fileData: Blob | Uint8Array;
  let fileSize = 0;
  let compressedLocalUri: string | undefined;

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    fileData = blob;
    fileSize = blob.size;
  } else {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    compressedLocalUri = manipulated.uri;
    const file = new FileSystem.File(manipulated.uri);
    fileData = await file.bytes();
    fileSize = fileData.length;
  }

  const fileExt = Platform.OS === 'web'
    ? (uri.split('.').pop()?.split('?')[0] || 'jpg')
    : 'jpg';
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${fileExt}`;
  const filePath = `${userId}/${childId}/photo/${fileName}`;
  const contentType = getContentType('photo', fileExt);

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, fileData, {
      contentType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const publicUrl = await getSignedUrlAfterMediaUpload(filePath);
  return { publicUrl, size: fileSize, path: filePath, compressedLocalUri };
}

export interface UploadPhotoAlbumParams {
  uris: string[];
  childId: string;
  capturedAtIso?: string;
  locationOverride?: string | null;
  importSourceFingerprint?: string | null;
}

/** Plusieurs photos en un seul souvenir (mosaïque dans le fil) — max conseillé côté UI */
export async function uploadPhotoAlbum({
  uris,
  childId,
  capturedAtIso,
  locationOverride,
  importSourceFingerprint,
}: UploadPhotoAlbumParams): Promise<MemoryRow | null> {
  try {
    if (uris.length === 0) return null;

    const limitCheck = await checkMemoryLimit(childId);
    if (!limitCheck.canCreate) {
      throw new Error('LIMIT_REACHED');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    throwIfImportDuplicate(childId, { importSourceFingerprint });

    if ((await getCachedUserMode()) === 'local') {
      const localMem = await capturePhotoAlbumLocalOnly({
        uris,
        childId,
        userId: user.id,
        capturedAtIso,
        locationOverride,
        importSourceFingerprint,
      });
      if (localMem) {
        upsertLocalMemory(localMem);
        DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [localMem] });
        return localMem;
      }
      return null;
    }

    const results = await Promise.all(
      uris.map(uri => readAndUploadPhotoFile(uri, user.id, childId))
    );
    const publicUrls = results.map(r => r.publicUrl);
    const paths = results.map(r => r.path);
    const totalSize = results.reduce((s, r) => s + r.size, 0);

    const locationLabel =
      locationOverride !== undefined ? locationOverride : null;

    const extras = publicUrls.slice(1);
    const memoryId = newCloudSyncMemoryId();
    const insertedAtIso = new Date().toISOString();
    const insertPayload: Database['public']['Tables']['memories']['Insert'] = {
      id: memoryId,
      child_id: childId,
      user_id: user.id,
      type: 'photo',
      media_url: publicUrls[0],
      media_path: paths[0] ?? null,
      extra_photo_urls: extras,
      extra_photo_paths: paths.slice(1),
      // Même principe que l’upload simple : vignettes = URLs uploadées jusqu’au passage du worker.
      thumb_url: publicUrls[0],
      display_url: publicUrls[0],
      extra_thumb_urls: extras,
      extra_display_urls: extras,
      duration: null,
      file_size: totalSize,
      location: locationLabel,
      voice_cover_url: null,
      voice_cover_path: null,
      inserted_at: insertedAtIso,
    };

    if (capturedAtIso) {
      insertPayload.created_at = capturedAtIso;
    }

    const { data: insertedRows, error: insertError } = await supabase
      .from('memories')
      .insert(insertPayload)
      .select('*');

    if (insertError) throw insertError;

    const nowIso = new Date().toISOString();
    let insertedRow = insertedRows?.[0] as MemoryRowDb | undefined;
    if (!insertedRow) {
      // RLS / returning vide : l’insert peut réussir sans ligne renvoyée — on reconstruit la ligne (id connu).
      insertedRow = {
        id: memoryId,
        child_id: childId,
        user_id: user.id,
        type: 'photo',
        content: null,
        media_url: publicUrls[0] ?? null,
        media_path: paths[0] ?? null,
        extra_photo_urls: extras as MemoryRowDb['extra_photo_urls'],
        extra_photo_paths: paths.slice(1) as MemoryRowDb['extra_photo_paths'],
        extra_thumb_urls: extras as MemoryRowDb['extra_thumb_urls'],
        extra_display_urls: extras as MemoryRowDb['extra_display_urls'],
        favorite_photo_urls: [] as MemoryRowDb['favorite_photo_urls'],
        voice_cover_url: null,
        voice_cover_path: null,
        voice_playback_start_sec: null,
        edited_media_url: null,
        is_favorite: false,
        duration: null,
        thumbnail_url: null,
        thumbnail_path: null,
        file_size: totalSize,
        location: locationLabel,
        inserted_at: insertedAtIso,
        captured_overlay_ink: null,
        thumb_url: publicUrls[0] ?? null,
        display_url: publicUrls[0] ?? null,
        print_url: null,
        poster_url: null,
        poster_print_url: null,
        upload_status: 'full',
        created_at: insertPayload.created_at ?? nowIso,
        updated_at: nowIso,
      };
    }

    if (!insertedRow?.id) return null;

    for (let i = 0; i < results.length; i++) {
      const loc = results[i].compressedLocalUri;
      if (loc) await persistFeedLocalThumbnail(insertedRow.id, loc, i);
    }
    void triggerProcessMemory(insertedRow.id);

    const out: Memory = {
      ...withLocalFields(insertedRow, { clientUploadStatus: 'full' }),
      sync_status: 'synced',
      import_source_fingerprint: importSourceFingerprint?.trim() ? importSourceFingerprint.trim() : null,
    };
    upsertLocalMemory(out);
    return out;
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message === 'LIMIT_REACHED' ||
        error.message === 'VIDEO_LIMIT_REACHED' ||
        error.message === IMPORT_DUPLICATE_ASSET
      ) {
        throw error;
      }
    }
    console.error('uploadPhotoAlbum error:', error);
    return null;
  }
}

export async function getFavoriteMemories(childId: string): Promise<MemoryRow[]> {
  try {
    if ((await getCachedUserMode()) === 'local') {
      return getLocalMemories(childId)
        .filter(m => m.is_favorite)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)) as unknown as MemoryRow[];
    }

    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('child_id', childId)
      .eq('is_favorite', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(row =>
      mergeServerMemoryRowWithExistingLocal(row, getLocalMemoryById(row.id))
    );
  } catch (error) {
    console.error('Get favorite memories error:', error);
    return [];
  }
}

export async function getMemories(childId: string): Promise<MemoryRow[]> {
  const localBefore = getLocalMemories(childId) as unknown as MemoryRow[];

  if ((await getCachedUserMode()) === 'local') {
    return localBefore;
  }

  // Cloud : attendre le pull pour mettre à jour SQLite (URLs signées / worker).
  // IMPORTANT : renvoyer **tout** `getLocalMemories` après coup — pas seulement les lignes du JSON
  // serveur. Sinon les souvenirs encore locaux (import / upload non terminé) disparaissent du fil
  // et les doublons « déjà importés » laissent une base incohérente pour l’UI.
  try {
    await pullMemoriesFromRemoteToLocal(childId);
  } catch {
    /* hors ligne ou erreur réseau */
  }
  return getLocalMemories(childId) as unknown as MemoryRow[];
}

export async function getMemoryById(memoryId: string) {
  const id = memoryId?.trim();
  if (!id) return null;

  try {
    if ((await getCachedUserMode()) === 'local') {
      return getLocalMemoryById(id);
    }

    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (data) return mergeServerMemoryRowWithExistingLocal(data, getLocalMemoryById(id));

    // Le fil / Favoris lisent souvent SQLite en premier ; la ligne peut ne pas être (encore) lisible via PostgREST.
    return getLocalMemoryById(id);
  } catch (error) {
    console.error('getMemoryById error:', error);
    return getLocalMemoryById(id);
  }
}

const FETCH_MEMORIES_BY_IDS_CHUNK = 40;

/** Recharge uniquement des lignes par id (évite de remplacer tout le fil pour les dérivés worker). */
export async function fetchMemoriesByIds(ids: string[]): Promise<MemoryRow[]> {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const out: MemoryRow[] = [];
  try {
    if ((await getCachedUserMode()) === 'local') {
      for (const id of unique) {
        const row = getLocalMemoryById(id);
        if (row) out.push(row);
      }
      return out;
    }

    for (let i = 0; i < unique.length; i += FETCH_MEMORIES_BY_IDS_CHUNK) {
      const chunk = unique.slice(i, i + FETCH_MEMORIES_BY_IDS_CHUNK);
      const { data, error } = await supabase.from('memories').select('*').in('id', chunk);
      if (error) throw error;
      if (data?.length) {
        out.push(
          ...data.map(row =>
            mergeServerMemoryRowWithExistingLocal(row, getLocalMemoryById(row.id))
          )
        );
      }
    }
    return out;
  } catch (error) {
    console.warn('[media] fetchMemoriesByIds failed', error);
    return [];
  }
}

export async function toggleFavorite(memoryId: string, isFavorite: boolean) {
  try {
    if ((await getCachedUserMode()) === 'local') {
      updateLocalMemoryFavorite(memoryId, isFavorite);
      return true;
    }

    // Mise à jour optimiste locale AVANT Supabase
    updateLocalMemoryFavorite(memoryId, isFavorite);

    const updateData: { is_favorite: boolean } = { is_favorite: isFavorite };
    const { error } = await supabase
      .from('memories')
      .update(updateData)
      .eq('id', memoryId);

    if (error) throw error;
    // Après succès Supabase : touche le local (synced_at) sans changer le status
    updateLocalMemoryUrls(memoryId, {
      upload_status: undefined,
    });
    return true;
  } catch (error) {
    console.error('Toggle favorite error:', error);
    return false;
  }
}

/**
 * Ajoute ou retire une URL de photo dans `favorite_photo_urls` (favoris par image).
 * @returns le nouveau tableau d’URLs, ou null si erreur
 */
export async function toggleFavoritePhotoUrl(memoryId: string, photoUrl: string): Promise<string[] | null> {
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;
  try {
    if ((await getCachedUserMode()) === 'local') {
      const row = getLocalMemoryById(memoryId);
      if (!row) return null;
      const raw = row.favorite_photo_urls;
      const current: string[] = Array.isArray(raw)
        ? raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
        : [];
      const eq = (a: string, b: string) => a.trim() === b.trim();
      const idx = current.findIndex(u => eq(u, trimmed));
      const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, trimmed];
      updateLocalMemoryFavoritePhotoUrls(memoryId, next);
      return next;
    }

    const { data: row, error: fetchError } = await supabase
      .from('memories')
      .select('favorite_photo_urls')
      .eq('id', memoryId)
      .single();

    if (fetchError || !row) {
      console.error('toggleFavoritePhotoUrl fetch:', fetchError);
      return null;
    }

    const raw = row.favorite_photo_urls;
    const current: string[] = Array.isArray(raw)
      ? raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
      : [];

    const eq = (a: string, b: string) => a.trim() === b.trim();
    const idx = current.findIndex(u => eq(u, trimmed));
    const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, trimmed];

    const { error: updateError } = await supabase
      .from('memories')
      .update({ favorite_photo_urls: next })
      .eq('id', memoryId);

    if (updateError) {
      console.error('toggleFavoritePhotoUrl update:', updateError);
      return null;
    }
    return next;
  } catch (e) {
    console.error('toggleFavoritePhotoUrl error:', e);
    return null;
  }
}

/**
 * Retire une URL des favoris photo sans la rajouter si elle était absente.
 */
export async function removeFavoritePhotoUrl(memoryId: string, photoUrl: string): Promise<boolean> {
  const trimmed = photoUrl.trim();
  if (!trimmed) return false;
  try {
    if ((await getCachedUserMode()) === 'local') {
      const row = getLocalMemoryById(memoryId);
      if (!row) return false;
      const raw = row.favorite_photo_urls;
      const current: string[] = Array.isArray(raw)
        ? raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
        : [];
      const eq = (a: string, b: string) => a.trim() === b.trim();
      const next = current.filter(u => !eq(u, trimmed));
      if (next.length === current.length) return true;
      updateLocalMemoryFavoritePhotoUrls(memoryId, next);
      return true;
    }

    const { data: row, error: fetchError } = await supabase
      .from('memories')
      .select('favorite_photo_urls')
      .eq('id', memoryId)
      .single();

    if (fetchError || !row) return false;

    const raw = row.favorite_photo_urls;
    const current: string[] = Array.isArray(raw)
      ? raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
      : [];

    const eq = (a: string, b: string) => a.trim() === b.trim();
    const next = current.filter(u => !eq(u, trimmed));
    if (next.length === current.length) return true;

    const { error: updateError } = await supabase
      .from('memories')
      .update({ favorite_photo_urls: next })
      .eq('id', memoryId);

    if (updateError) return false;
    return true;
  } catch {
    return false;
  }
}

export async function updateMemoryContent(memoryId: string, content: string) {
  try {
    /**
     * Offline-first: on persiste localement *tout de suite* pour éviter une perte de saisie.
     * La sync Supabase peut échouer (réseau, session, RLS) mais l’utilisateur ne doit pas perdre son texte.
     */
    updateLocalMemoryContent(memoryId, content);

    if ((await getCachedUserMode()) === 'local') {
      return true;
    }

    const { error } = await supabase.from('memories').update({ content }).eq('id', memoryId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Update memory content error:', error);
    return false;
  }
}

export async function updateMemoryLocation(memoryId: string, location: string | null) {
  try {
    /**
     * Offline-first: persister localement tout de suite.
     * La sync Supabase peut échouer, mais l’app (fil + livre) doit rester cohérente.
     */
    const next = location?.trim() ? location.trim() : null;
    updateLocalMemoryLocation(memoryId, next);

    if ((await getCachedUserMode()) === 'local') {
      return true;
    }

    const { error } = await supabase
      .from('memories')
      .update({ location: next })
      .eq('id', memoryId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Update memory location error:', error);
    return false;
  }
}

export async function deleteMemory(memoryId: string) {
  try {
    // Supprimer localement en premier (optimiste)
    const local = getLocalMemoryById(memoryId);
    if (local) {
      await deleteLocalMediaFiles(local);
    }
    deleteLocalMemory(memoryId);

    await clearFeedLocalThumbnails(memoryId);
    await clearFeedLocalVideo(memoryId);

    if ((await getCachedUserMode()) === 'local') {
      return true;
    }

    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', memoryId);

    if (error) throw error;
    void triggerDeleteMemoryAssets(memoryId);
    return true;
  } catch (error) {
    console.error('Delete memory error:', error);
    return false;
  }
}

/**
 * Export PDF serveur : envoie la cover locale vers le bucket `media` et met à jour la ligne
 * `memories`, **même en mode gratuit (`local`)** — le rendu Playwright lit Supabase, pas SQLite.
 */
export async function persistVoiceCoverToCloudForPdfExport(
  memoryId: string,
  childId: string,
  localCoverUri: string
): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const up = await uploadVoiceCoverToStorage(user.id, childId, localCoverUri.trim());
    if (!up) return null;

    const { error } = await supabase
      .from('memories')
      .update({ voice_cover_url: up.publicUrl, voice_cover_path: up.path })
      .eq('id', memoryId);

    if (error) {
      console.error('persistVoiceCoverToCloudForPdfExport:', error);
      return null;
    }
    const existing = getLocalMemoryById(memoryId);
    if (existing) {
      upsertLocalMemory({
        ...existing,
        voice_cover_url: up.publicUrl,
        voice_cover_path: up.path,
        updated_at: new Date().toISOString(),
      });
    }
    void triggerProcessMemory(memoryId);
    return up.publicUrl;
  } catch (e) {
    console.error('persistVoiceCoverToCloudForPdfExport', e);
    return null;
  }
}

/**
 * Met à jour la photo de fond d’un souvenir vocal (upload + `voice_cover_url`).
 * @returns URL publique ou null si échec
 */
export async function updateVoiceMemoryCover(
  memoryId: string,
  childId: string,
  localCoverUri: string
): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    if ((await getCachedUserMode()) === 'local') {
      if (Platform.OS === 'web') {
        const trimmed = localCoverUri.trim();
        if (!trimmed) return null;
        const existing = getLocalMemoryById(memoryId);
        if (!existing) return null;
        const next: Memory = {
          ...existing,
          voice_cover_url: trimmed,
          voice_cover_path: trimmed,
          updated_at: new Date().toISOString(),
        };
        upsertLocalMemory(next);
        return trimmed;
      }
      if (!documentDirectory) return null;
      const dir = `${documentDirectory}petitmo_memories/${memoryId}/`;
      await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const ext = localCoverUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
      const dest = `${dir}voice_cover.${ext}`;
      await copyAsync({ from: localCoverUri.trim(), to: dest }).catch(() => null);
      const existing = getLocalMemoryById(memoryId);
      if (!existing) return null;
      const next: Memory = {
        ...existing,
        voice_cover_url: dest,
        voice_cover_path: dest,
        updated_at: new Date().toISOString(),
      };
      upsertLocalMemory(next);
      return dest;
    }

    const up = await uploadVoiceCoverToStorage(user.id, childId, localCoverUri);
    if (!up) return null;

    const { error } = await supabase
      .from('memories')
      .update({ voice_cover_url: up.publicUrl, voice_cover_path: up.path })
      .eq('id', memoryId);

    if (error) {
      console.error('updateVoiceMemoryCover:', error);
      return null;
    }
    const existing = getLocalMemoryById(memoryId);
    if (existing) {
      upsertLocalMemory({
        ...existing,
        voice_cover_url: up.publicUrl,
        voice_cover_path: up.path,
        updated_at: new Date().toISOString(),
      });
    }
    void triggerProcessMemory(memoryId);
    return up.publicUrl;
  } catch (error) {
    console.error('updateVoiceMemoryCover:', error);
    return null;
  }
}

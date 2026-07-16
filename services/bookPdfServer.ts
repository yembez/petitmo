/**
 * Export PDF livre — **uniquement** via le service distant (Playwright / Chromium).
 * Aucune génération PDF sur l’appareil (expo-print) : voir AGENTS.md / `.cursor/rules/architecture.mdc`.
 */
import { downloadAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { uploadAsync as uploadAsyncLegacy } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import {
  isIosBackgroundSignedPutUploadAvailable,
  uploadFileToSignedPutUrlIosBackground,
} from '@/services/signedUrlIosBackgroundUpload';
import { persistQrTokensFromPdfResponse } from '@/services/bookQrPreview';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getInfoAsync } from 'expo-file-system/legacy';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type {
  GenerateBookPdfPayload,
  GenerateBookPdfResponse,
  GuestMemoryForPdfPayload,
} from '@/types/shared';
import { supabase } from '@/lib/supabase';
import { getLocalMemoryById } from '@/lib/localDb';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  ensureChildRowExistsOnSupabaseForExport,
  ensureLocalChildrenSyncedToSupabase,
} from '@/services/children';
import { ensureVoiceMemoryCloudForBookExport } from '@/services/migration';
import { persistVideoPosterToCloudForPdfExport, persistVoiceCoverToCloudForPdfExport, uploadFileToSupabase } from '@/services/media';
import {
  collectPhotoLocalUploadUriCandidates,
  collectVideoPosterLocalUploadUriCandidates,
  collectVoiceCoverLocalUploadUriCandidates,
  getBookPhotoPrintUri,
  getPhotoUriForBookMaquetteDisplay,
  getVideoPosterUriForBookPreview,
  getVoiceCoverUriForBookPreview,
  indexOfPhotoUrlInFeed,
  inferLocalDisplayPathFromPrint,
  memoryPhotoMatchesUrl,
  normalizePhotoUrlForCompare,
} from '@/utils/memoryPhotos';
import { dedicatedBookCoverUriForBook, findPhotoMemoryByCoverRef } from '@/services/books';
import { pickFirstReadableLocalMediaUri } from '@/utils/localMediaReadable';
import { resolveServerPdfEntitlements } from '@/lib/digitalExportPurchase';
import {
  MEDIA_BOOK_PRINT_MAX_WIDTH,
  MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
  MEDIA_BOOK_PDF_JPEG_QUALITY,
  MEDIA_BOOK_PDF_COVER_JPEG_QUALITY,
} from '@/lib/limits';
import { isInitExportConfigured, postInitExport, postGuestUploadUrls } from '@/services/initExportApi';
import { enqueueGuestRawUpload } from '@/services/pendingRawGuestUploads';
import { publicMediaBaseUrl } from '@/lib/publicMediaBaseUrl';

/** Erreur HTTP / téléchargement après appel au service PDF. */
export const EXPORT_SERVER_FAILED_CONTACT_MESSAGE =
  'L’export PDF a échoué (service indisponible ou erreur serveur). Réessaie plus tard. Si le problème persiste, contacte le support Petitmo depuis les Réglages de l’app.';

/** URL serveur absente ou export sans passer par le service — PDF livre impossible depuis l’app. */
export const PDF_EXPORT_REQUIRES_SERVER_MESSAGE =
  'L’export PDF livre n’est disponible que via le service Petitmo (même rendu que la commande). Ce service n’est pas configuré dans cette version de l’app : vérifie la configuration build (EXPO_PUBLIC_PDF_SERVER_URL) ou réessaie plus tard.';

function pdfServerBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_PDF_SERVER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

function errorMessageFromPdfServerJson(
  j: { error?: string; detail?: string },
  fallback: string
): string {
  const d = typeof j.detail === 'string' ? j.detail.trim() : '';
  if (d) return d;
  const e = typeof j.error === 'string' ? j.error.trim() : '';
  if (e) return e;
  return fallback;
}

/** Logs Expo / Xcode — indispensable quand l’UI ne montre que le message générique contact support. */
function logPdfExportFailure(phase: string, info: Record<string, unknown>): void {
  console.warn(`[bookPdfServer] ${phase}`, JSON.stringify(info));
}

function appendDevExportHint(message: string, hint: string): string {
  if (!__DEV__) return message;
  return `${message}\n\n[Débug] ${hint}`;
}

/**
 * Corps d’erreur lu une seule fois (502 Railway renvoie souvent du HTML : `res.json()` échouait et on perdait le détail).
 */
async function parseGeneratePdfErrorBody(res: Response): Promise<string> {
  let detail = res.statusText || '';
  const raw = await res.text();
  const trimmed = raw.trim();
  if (!trimmed) return detail;
  try {
    const j = JSON.parse(trimmed) as { error?: string; detail?: string };
    return errorMessageFromPdfServerJson(j, detail);
  } catch {
    const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 280);
    return snippet || detail;
  }
}

export function isBookPdfServerConfigured(): boolean {
  return pdfServerBaseUrl() != null;
}

export type GuestPdfExportConsent = {
  email: string;
  /** ISO-8601 (ex. `new Date().toISOString()` au moment du consentement). */
  gdprConsentAtIso: string;
  fullName?: string | null;
  marketingOptIn?: boolean;
};

export type InitExportPdfResponse = {
  exportRequestId: string;
  crmContactId: string;
  /** Présent uniquement pour `type: "pdf_export"` côté Edge. */
  pdfTicket?: string;
  expiresInSeconds?: number;
  flow?: 'pdf_export' | 'print_order';
};

export { isInitExportConfigured } from '@/services/initExportApi';

function countAudioVideoPages(pages: BookPage[]): number {
  return pages.filter(p => p.type === 'audio' || p.type === 'video').length;
}

/**
 * Export PDF avec session : le serveur lit `memories` dans Supabase.
 * Même logique que la maquette (`getVoiceCoverUriForBookPreview`) : `voice_cover_path` (souvent
 * fichier sandbox) prime sur `voice_cover_url`. Ne pas court-circuiter dès que l’URL est https :
 * l’aperçu peut encore utiliser un fichier local alors que la ligne Supabase n’a pas la cover.
 */
function mergeMemoryWithLocalRowForVoiceCover(m: Memory): Memory {
  if (m.type !== 'voice') return m;
  if (Platform.OS === 'web') return m;
  try {
    const row = getLocalMemoryById(m.id);
    if (!row) return m;
    return {
      ...m,
      voice_cover_path: m.voice_cover_path ?? row.voice_cover_path ?? null,
      voice_cover_url: m.voice_cover_url ?? row.voice_cover_url ?? null,
      local_print_path: m.local_print_path ?? row.local_print_path ?? null,
      print_px_w: m.print_px_w ?? row.print_px_w ?? null,
      print_px_h: m.print_px_h ?? row.print_px_h ?? null,
    };
  } catch {
    return m;
  }
}

function mergeMemoryWithLocalRowForVideoPoster(m: Memory): Memory {
  if (m.type !== 'video') return m;
  if (Platform.OS === 'web') return m;
  try {
    const row = getLocalMemoryById(m.id);
    if (!row) return m;
    return {
      ...m,
      local_thumb_path: m.local_thumb_path ?? row.local_thumb_path ?? null,
      poster_url: m.poster_url ?? row.poster_url ?? null,
      thumbnail_url: m.thumbnail_url ?? row.thumbnail_url ?? null,
      poster_print_url: m.poster_print_url ?? row.poster_print_url ?? null,
      local_original_path: m.local_original_path ?? row.local_original_path ?? null,
      local_media_path: m.local_media_path ?? row.local_media_path ?? null,
      media_url: m.media_url ?? row.media_url ?? null,
      edited_media_url: m.edited_media_url ?? row.edited_media_url ?? null,
      duration: m.duration ?? row.duration ?? null,
    };
  } catch {
    return m;
  }
}

/** Vocal : chemins audio + cover depuis SQLite (export livre). */
function mergeVoiceMemoryForBookExportFromSqlite(m: Memory): Memory {
  if (m.type !== 'voice') return m;
  return mergeMemoryWithLocalRowForVoiceCover(mergeMemoryWithLocalRowForAv(m));
}

async function ensureVoiceRowsCloudSyncedForSessionPdf(
  pages: BookPage[],
  localEdits: Record<string, Partial<Memory>>,
  userId: string,
  childId: string
): Promise<void> {
  await ensureChildRowExistsOnSupabaseForExport(childId);
  await ensureLocalChildrenSyncedToSupabase();
  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  for (const m of memories) {
    if (m.type !== 'voice') continue;
    const ed = localEdits[m.id];
    const base = ed ? { ...m, ...ed } : m;
    try {
      await ensureVoiceMemoryCloudForBookExport(mergeVoiceMemoryForBookExportFromSqlite(base), userId);
    } catch (e) {
      console.warn('[bookPdfServer] ensureVoiceRowsCloudSyncedForSessionPdf', m.id, e);
    }
  }
}

/** Retourne des entrées `guestMemories` minimales pour fusion côté serveur (cover HTTPS fraîche). */
async function ensureVoiceCoversPersistedForServerPdf(
  pages: BookPage[],
  localEdits: Record<string, Partial<Memory>>,
  childId: string
): Promise<GuestMemoryForPdfPayload[]> {
  const overrides: GuestMemoryForPdfPayload[] = [];
  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  for (const m of memories) {
    if (m.type !== 'voice') continue;
    const ed = localEdits[m.id];
    const merged = mergeMemoryWithLocalRowForVoiceCover(ed ? { ...m, ...ed } : m);
    const coverUri = getVoiceCoverUriForBookPreview(merged).trim();
    if (!coverUri || isHttps(coverUri)) continue;
    if (isBareMediaBucketPath(coverUri)) continue;
    try {
      const url = await persistVoiceCoverToCloudForPdfExport(m.id, childId, coverUri);
      if (url) {
        overrides.push({ id: m.id, type: 'voice', voice_cover_url: url, created_at: m.created_at });
      }
    } catch (e) {
      console.warn('[bookPdfServer] ensureVoiceCoversPersistedForServerPdf', m.id, e);
    }
  }
  return overrides;
}

/** Retourne des entrées `guestMemories` pour fusion côté serveur (poster vidéo HTTPS frais). */
async function ensureVideoPostersPersistedForServerPdf(
  pages: BookPage[],
  localEdits: Record<string, Partial<Memory>>,
  childId: string
): Promise<GuestMemoryForPdfPayload[]> {
  const overrides: GuestMemoryForPdfPayload[] = [];
  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  for (const m of memories) {
    if (m.type !== 'video') continue;
    const ed = localEdits[m.id];
    const merged = mergeMemoryWithLocalRowForVideoPoster(ed ? { ...m, ...ed } : m);
    const existingHttps = [merged.poster_url, merged.thumbnail_url].find(u => isHttps((u ?? '').trim()));
    if (existingHttps) continue;
    const posterUri = getVideoPosterUriForBookPreview(merged).trim();
    if (posterUri && isHttps(posterUri)) continue;
    if (posterUri && isBareMediaBucketPath(posterUri)) continue;
    try {
      const url = await persistVideoPosterToCloudForPdfExport(m.id, childId, posterUri);
      if (url) {
        overrides.push({
          id: m.id,
          type: 'video',
          poster_url: url,
          thumbnail_url: url,
          created_at: m.created_at,
        });
      }
    } catch (e) {
      console.warn('[bookPdfServer] ensureVideoPostersPersistedForServerPdf', m.id, e);
    }
  }
  return overrides;
}

/** Upload slot album (sans écraser `print_url` principal en base) — export PDF session premium. */
async function resolveAlbumPhotoHttpsUrlForSessionPdf(
  m: Memory,
  photoRef: string,
  childId: string,
): Promise<string | null> {
  const slotUri = getBookPhotoPrintUri(m, photoRef).trim();
  if (slotUri && isHttps(slotUri)) return slotUri;
  if (Platform.OS === 'web') return null;

  const local = await pickFirstReadableLocalMediaUri(
    slotUri
      ? [slotUri, ...collectPhotoLocalUploadUriCandidates(m)]
      : collectPhotoLocalUploadUriCandidates(m),
  );
  if (!local) return null;

  const compressed = await compressLocalJpegForGuestUpload(local, {
    maxWidth: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
    quality: MEDIA_BOOK_PDF_JPEG_QUALITY,
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const slotKey =
    normalizePhotoUrlForCompare(photoRef)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 24) || 'slot';
  const path = `${user.id}/${childId}/pdf-export/${m.id}-${slotKey}.jpg`;
  return await uploadFileToSupabase(compressed, path, { upsert: true });
}

/** Upload slot album (session premium) → Map pour `photoRef` HTTPS par page. */
async function buildPagePhotoRefHttpsMapSession(
  pages: BookPage[],
  childId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of pages) {
    if (p.type !== 'photo-full' && p.type !== 'photo-note') continue;
    const m = p.memory;
    const ref = p.photoRef?.trim();
    if (!m || m.type !== 'photo' || !ref) continue;
    const mapKey = `${m.id}::${normalizePhotoUrlForCompare(ref)}`;
    if (out.has(mapKey)) continue;
    if (isHttps(ref)) {
      out.set(mapKey, ref);
      continue;
    }
    try {
      const url = await resolveAlbumPhotoHttpsUrlForSessionPdf(m, ref, childId);
      if (url) out.set(mapKey, url);
    } catch (e) {
      if (__DEV__) console.warn('[bookPdfServer] album slot session', m.id, e);
    }
  }
  return out;
}

/** Overrides `guestMemories` : URL print HTTPS pour le slot album choisi dans le livre. */
async function ensurePhotoPrintUrlsForServerPdf(
  pages: BookPage[],
  localEdits: Record<string, Partial<Memory>>,
  childId: string,
  memoryPhotoRefs?: Record<string, string>,
): Promise<GuestMemoryForPdfPayload[]> {
  if (!memoryPhotoRefs || Object.keys(memoryPhotoRefs).length === 0) return [];
  const overrides: GuestMemoryForPdfPayload[] = [];
  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  for (const m of memories) {
    if (m.type !== 'photo') continue;
    const ref = memoryPhotoRefs[m.id]?.trim();
    if (!ref) continue;
    const ed = localEdits[m.id];
    const merged = ed ? { ...m, ...ed } : m;
    try {
      const url = await resolveAlbumPhotoHttpsUrlForSessionPdf(merged, ref, childId);
      if (url) {
        overrides.push({
          id: merged.id,
          type: 'photo',
          print_url: url,
          display_url: url,
          media_url: url,
          created_at: merged.created_at,
        });
      }
    } catch (e) {
      console.warn('[bookPdfServer] ensurePhotoPrintUrlsForServerPdf', m.id, e);
    }
  }
  return overrides;
}

export function collectMemoriesFromPagesForPdf(
  pages: BookPage[],
  localEdits: Record<string, Partial<Memory>>
): Memory[] {
  const seen = new Set<string>();
  const out: Memory[] = [];
  for (const p of pages) {
    if (p.type === 'cover' || p.type === 'chapter' || p.type === 'back-cover') continue;
    const m = p.memory;
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    const e = localEdits[m.id];
    out.push(e ? { ...m, ...e } : m);
  }
  return out;
}

function memoryToGuestPayload(m: Memory): GuestMemoryForPdfPayload {
  return {
    id: m.id,
    type: m.type,
    content: m.content ?? null,
    text_title: m.text_title?.trim() ? m.text_title.trim() : null,
    location: m.location ?? null,
    media_url: m.media_url ?? null,
    media_path: m.media_path ?? null,
    edited_media_url: m.edited_media_url ?? null,
    duration: m.duration ?? null,
    thumbnail_url: m.thumbnail_url ?? null,
    display_url: m.display_url ?? null,
    print_url: m.print_url ?? null,
    poster_url: m.poster_url ?? null,
    poster_print_url: m.poster_print_url ?? null,
    voice_cover_url: m.voice_cover_url ?? null,
    created_at: m.created_at,
  };
}

/** Upload chaque slot album des pages → Map `memoryId::photoRefNorm` → URL HTTPS. */
async function buildPagePhotoRefHttpsMap(
  pages: BookPage[],
  pdfTicket: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (Platform.OS === 'web') return out;

  for (const p of pages) {
    if (p.type !== 'photo-full' && p.type !== 'photo-note') continue;
    const m = p.memory;
    const ref = p.photoRef?.trim();
    if (!m || m.type !== 'photo' || !ref) continue;
    const mapKey = `${m.id}::${normalizePhotoUrlForCompare(ref)}`;
    if (out.has(mapKey)) continue;
    if (isHttps(ref)) {
      out.set(mapKey, ref);
      continue;
    }
    const slotPrint = getBookPhotoPrintUri(m, ref).trim();
    const local = await pickFirstReadableLocalMediaUri(
      [slotPrint, ref, inferLocalDisplayPathFromPrint(slotPrint || ref)].filter(u => u.trim().length > 0),
    );
    if (!local) continue;
    try {
      const compressed = await compressLocalJpegForGuestUpload(local, {
        maxWidth: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
        quality: MEDIA_BOOK_PDF_JPEG_QUALITY,
      });
      const slotKey =
        normalizePhotoUrlForCompare(ref).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20) || 'slot';
      const { readUrl } = await guestUploadMediaImageThenReadUrl({
        pdfTicket,
        asset: { kind: 'photo', memoryId: `${m.id}_${slotKey}` },
        localUri: compressed,
        mimeType: 'image/jpeg',
      });
      out.set(mapKey, readUrl);
    } catch (e) {
      if (__DEV__) console.warn('[bookPdfServer] album slot upload', m.id, e);
    }
  }
  return out;
}

function applyHttpsPhotoRefsToServerPages(
  pages: GenerateBookPdfPayload['pages'],
  slotHttps: Map<string, string>,
): GenerateBookPdfPayload['pages'] {
  if (slotHttps.size === 0) return pages;
  return pages.map(p => {
    if (p.type !== 'photo-full' && p.type !== 'photo-note') return p;
    const mid = (p.memoryId ?? '').trim();
    const ref = (p.photoRef ?? '').trim();
    if (!mid || !ref) return p;
    const https = slotHttps.get(`${mid}::${normalizePhotoUrlForCompare(ref)}`);
    return https ? { ...p, photoRef: https } : p;
  });
}

function isHttps(u: string | null | undefined): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim());
}

async function compressLocalJpegForGuestUpload(
  localUri: string,
  opts?: { maxWidth?: number; quality?: number }
): Promise<string> {
  if (Platform.OS === 'web') return localUri;
  const maxWidth = opts?.maxWidth ?? MEDIA_BOOK_PRINT_MAX_WIDTH;
  const quality = opts?.quality ?? MEDIA_BOOK_PDF_JPEG_QUALITY;
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: maxWidth } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipulated?.uri || localUri;
  } catch {
    return localUri;
  }
}

/** Même règle que le bucket `media` côté serveur : ce n’est pas un fichier local à ré-uploader. */
const BARE_MEDIA_PATH_RE =
  /^(guest\/exports\/|exports\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)/i;

function isBareMediaBucketPath(s: string): boolean {
  return BARE_MEDIA_PATH_RE.test(s.trim());
}

async function uploadGuestPhotoToPdfServer(params: {
  base: string;
  pdfTicket: string;
  memoryId: string;
  localJpegUri: string;
}): Promise<{ url: string; path: string }> {
  const readable = await pickFirstReadableLocalMediaUri([params.localJpegUri]);
  if (!readable) throw new Error('GUEST_PHOTO_NOT_READABLE');
  const src = await compressLocalJpegForGuestUpload(readable);
  const b64 = await readAsStringAsync(src, { encoding: EncodingType.Base64 });
  const res = await fetch(`${params.base}/v1/books/upload-guest-photo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.pdfTicket}`,
    },
    body: JSON.stringify({ memoryId: params.memoryId, base64Jpeg: b64 }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`GUEST_UPLOAD_FAILED (${res.status}) ${detail}`);
  }
  const j = (await res.json()) as { url?: string; path?: string };
  if (!j.url || !j.path) throw new Error('GUEST_UPLOAD_FAILED (invalid response)');
  return { url: j.url, path: j.path };
}

async function uploadGuestAssetMultipart(params: {
  base: string;
  pdfTicket: string;
  kind: 'photo' | 'cover' | 'audio' | 'video' | 'video_thumb';
  memoryId: string;
  localUri: string;
  filename: string;
}): Promise<{ url: string; path: string }> {
  if (params.kind === 'video' || params.kind === 'audio') {
    try {
      const info = await getInfoAsync(params.localUri);
      const size = info.exists && typeof (info as { size?: unknown }).size === 'number' ? (info as { size: number }).size : 0;
      // Garde-fou UX: au-delà, on risque de timeouts + RAM côté serveur (memoryStorage).
      const MAX = params.kind === 'video' ? 240 * 1024 * 1024 : 40 * 1024 * 1024;
      if (size > MAX) {
        throw new Error(params.kind === 'video' ? 'GUEST_VIDEO_TOO_LARGE' : 'GUEST_AUDIO_TOO_LARGE');
      }
    } catch (e) {
      if (e instanceof Error) throw e;
    }
  }
  // Expo SDK 54+: prefer legacy API to avoid deprecation warning in runtime.
  const res = await uploadAsyncLegacy(`${params.base}/v1/books/upload-guest-asset`, params.localUri, {
    httpMethod: 'POST',
    uploadType: 1 as unknown as number, // MULTIPART (legacy enum value)
    headers: {
      Authorization: `Bearer ${params.pdfTicket}`,
    },
    fieldName: 'file',
    parameters: {
      kind: params.kind,
      memoryId: params.memoryId,
    },
    mimeType:
      params.kind === 'audio'
        ? 'audio/mp4'
        : params.kind === 'video'
          ? 'video/mp4'
          : 'image/jpeg',
  });
  if (res.status !== 200) {
    throw new Error(`GUEST_UPLOAD_FAILED (${res.status}) ${res.body || ''}`.trim());
  }
  const j = JSON.parse(res.body || '{}') as { url?: string; path?: string };
  if (!j.url || !j.path) throw new Error('GUEST_UPLOAD_FAILED (invalid response)');
  return { url: j.url, path: j.path };
}

async function uploadFileToSignedUrl(params: {
  signedUrl: string;
  localUri: string;
  mimeType: string;
}): Promise<void> {
  if (isIosBackgroundSignedPutUploadAvailable()) {
    await uploadFileToSignedPutUrlIosBackground(params);
    return;
  }

  const res = await uploadAsyncLegacy(params.signedUrl, params.localUri, {
    httpMethod: 'PUT',
    uploadType: 0 as unknown as number, // BINARY_CONTENT (legacy enum value)
    headers: {
      'Content-Type': params.mimeType,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`SIGNED_UPLOAD_FAILED (${res.status}) ${res.body || ''}`.trim());
  }
}

type GuestImageAssetForUploadUrls =
  | { kind: 'cover' }
  | { kind: 'photo'; memoryId: string }
  | { kind: 'voice_cover'; memoryId: string }
  | { kind: 'video_thumb'; memoryId: string };

type GuestSignedUploadRow = {
  kind: 'cover' | 'photo' | 'voice_cover' | 'audio' | 'video' | 'video_thumb';
  memoryId: string | null;
  bucket: string;
  path: string;
  signedUrl: string;
  token?: string;
  publicUrl?: string;
};

function guestUploadRowFromJson(json: Record<string, unknown>): GuestSignedUploadRow | undefined {
  const uploads = json.uploads;
  if (!Array.isArray(uploads) || uploads.length < 1) return undefined;
  return uploads[0] as GuestSignedUploadRow;
}

/**
 * Bucket `media` privé : l’URL de **lecture** signée n’est disponible qu’après le PUT.
 * `guest-upload-urls` peut donc ne pas renvoyer `publicUrl` au premier appel.
 */
async function guestUploadMediaImageThenReadUrl(params: {
  pdfTicket: string;
  asset: GuestImageAssetForUploadUrls;
  localUri: string;
  mimeType: string;
}): Promise<{ readUrl: string; path: string }> {
  const { pdfTicket, asset, localUri, mimeType } = params;
  const first = await postGuestUploadUrls({ pdfTicket, assets: [asset] });
  const row = guestUploadRowFromJson(first.json);
  if (first.status !== 200 || !row?.signedUrl?.trim() || !row.path?.trim()) {
    throw new Error('PREP_NOT_READY');
  }
  await uploadFileToSignedUrl({ signedUrl: row.signedUrl, localUri, mimeType });
  const readFromFirst = (row.publicUrl ?? '').trim();
  if (readFromFirst) {
    return { readUrl: readFromFirst, path: row.path };
  }
  const second = await postGuestUploadUrls({ pdfTicket, assets: [asset] });
  const row2 = guestUploadRowFromJson(second.json);
  const readUrl = (row2?.publicUrl ?? '').trim();
  if (second.status !== 200 || !readUrl) {
    throw new Error('PREP_NOT_READY');
  }
  return { readUrl, path: row.path };
}

/** URI fichier local pour upload brut (sandbox / repli `file:` après JSON AsyncStorage). */
function localUriForAvRawUpload(m: Memory, kind: 'audio' | 'video'): string {
  const fromLocal = (m.local_original_path ?? m.local_media_path ?? '').trim();
  if (fromLocal) return fromLocal;
  const fallback = (m.media_url ?? m.edited_media_url ?? '').trim();
  if (fallback.toLowerCase().startsWith('file:')) return fallback;
  return '';
}

function mimeTypeForVideoUpload(uri: string): string {
  const u = uri.toLowerCase();
  if (u.endsWith('.mov') || u.includes('.mov?')) return 'video/quicktime';
  return 'video/mp4';
}

/**
 * Le payload commande passe par AsyncStorage : les champs locaux peuvent être incomplets.
 * On réhydrate depuis SQLite quand c’est possible (native).
 */
function mergeMemoryWithLocalRowForAv(m: Memory): Memory {
  if (m.type !== 'voice' && m.type !== 'video') return m;
  const kind = m.type === 'voice' ? 'audio' : 'video';
  if (localUriForAvRawUpload(m, kind)) return m;
  if (Platform.OS === 'web') return m;
  try {
    const row = getLocalMemoryById(m.id);
    if (!row) return m;
    return {
      ...m,
      local_original_path: m.local_original_path ?? row.local_original_path ?? null,
      local_media_path: m.local_media_path ?? row.local_media_path ?? null,
      media_url: m.media_url ?? row.media_url ?? null,
      edited_media_url: m.edited_media_url ?? row.edited_media_url ?? null,
    };
  } catch {
    return m;
  }
}

/** Dernier recours : vidéo déjà en HTTPS (ex. sync) → fichier temporaire puis PUT signé. */
async function downloadHttpsVideoToTempIfNeeded(m: Memory): Promise<string | null> {
  const direct = localUriForAvRawUpload(m, 'video');
  if (direct) return direct;
  const httpsUrl = httpsOrNull(m.media_url) ?? httpsOrNull(m.edited_media_url);
  if (!httpsUrl || Platform.OS === 'web') return null;
  const baseDir = documentDirectory ?? '';
  if (!baseDir) return null;
  const safeId = m.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const dest = `${baseDir}petitmo-video-raw-${safeId}-${Date.now()}.mp4`;
  try {
    const dl = await downloadAsync(httpsUrl, dest);
    if (dl.status !== 200) return null;
    return dl.uri;
  } catch {
    return null;
  }
}

/**
 * Archi cible : PDF immédiat (QR déjà créé côté serveur) ; fichiers audio/vidéo bruts uploadés après succès generate-pdf.
 * Best-effort : ne bloque pas l’UX si échec réseau (le QR reste « en préparation » jusqu’au worker).
 */
async function guestAvRawUploadAfterPdf(params: { pdfTicket: string; memories: Memory[] }): Promise<void> {
  const { pdfTicket, memories } = params;
  const tasks: Promise<void>[] = [];

  for (const m of memories) {
    if (m.type === 'voice') {
      const merged = mergeMemoryWithLocalRowForAv(m);
      const local = localUriForAvRawUpload(merged, 'audio');
      if (!local) {
        if (__DEV__) console.warn('[guestAvRawUploadAfterPdf] audio: no uri', m.id);
        continue;
      }
      tasks.push(
        (async () => {
          try {
            const { status, json } = await postGuestUploadUrls({
              pdfTicket,
              assets: [{ kind: 'audio', memoryId: m.id }],
            });
            const row = (json as { uploads?: Array<{ signedUrl?: string }> })?.uploads?.[0];
            if (status === 200 && row?.signedUrl) {
              const key = `audio:${m.id}`;
              await enqueueGuestRawUpload({
                pdfTicket,
                kind: 'audio',
                memoryId: m.id,
                localUri: local,
                mimeType: 'audio/mp4',
                policy: 'finalize_only',
              });
              // Ne force pas l’upload ici : le plan gratuit le fait à la finalisation de commande.
              // Les plans payants peuvent toujours finaliser en arrière-plan via `processPendingGuestRawUploads`.
            } else if (__DEV__) {
              console.warn('[guestAvRawUploadAfterPdf] audio signed URL failed', m.id, status, json);
            }
          } catch (e) {
            if (__DEV__) console.warn('[guestAvRawUploadAfterPdf] audio', m.id, e);
          }
        })()
      );
    }
    // Vidéos : upload brut après PDF (QR activé à la finalisation commande, comme l’audio).
    if (m.type === 'video') {
      const merged = mergeMemoryWithLocalRowForAv(m);
      tasks.push(
        (async () => {
          try {
            let local = localUriForAvRawUpload(merged, 'video');
            if (!local) {
              local = (await downloadHttpsVideoToTempIfNeeded(merged)) ?? '';
            }
            if (!local) {
              if (__DEV__) console.warn('[guestAvRawUploadAfterPdf] video: no uri', m.id);
              return;
            }
            const { status, json } = await postGuestUploadUrls({
              pdfTicket,
              assets: [{ kind: 'video', memoryId: m.id }],
            });
            const row = (json as { uploads?: Array<{ signedUrl?: string }> })?.uploads?.[0];
            if (status === 200 && row?.signedUrl) {
              await enqueueGuestRawUpload({
                pdfTicket,
                kind: 'video',
                memoryId: m.id,
                localUri: local,
                mimeType: mimeTypeForVideoUpload(local),
                policy: 'finalize_only',
              });
            } else if (__DEV__) {
              console.warn('[guestAvRawUploadAfterPdf] video signed URL failed', m.id, status, json);
            }
          } catch (e) {
            if (__DEV__) console.warn('[guestAvRawUploadAfterPdf] video', m.id, e);
          }
        })(),
      );
    }
  }

  await Promise.all(tasks);
}

function httpsOrNull(u: string | null | undefined): string | null {
  const t = (u ?? '').trim();
  return t && isHttps(t) ? t : null;
}

function photoMainForGuest(m: Memory): string {
  return (
    (m.print_url ?? m.display_url ?? m.edited_media_url ?? m.media_url ?? '').trim() || ''
  );
}

/**
 * Le rendu Playwright côté serveur charge les images en HTTPS ; sans compte il faut des URLs publiques (ou dérivés sync).
 */
export function validateGuestExportMedia(params: {
  pages: BookPage[];
  localEdits: Record<string, Partial<Memory>>;
  coverPhotoUrl?: string | null;
  child: Child;
}): void {
  const { pages, localEdits, coverPhotoUrl, child } = params;
  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  // NOTE: flux "guest" = rendu serveur → images accessibles, pas de `file://`.
  // La cover est optionnelle : si elle n'est pas en https, elle sera rendue en placeholder.
  void (httpsOrNull(coverPhotoUrl) ?? httpsOrNull(child.photo_url) ?? null);

  const byId = new Map(memories.map(m => [m.id, m]));
  for (const p of pages) {
    if (p.type !== 'photo-full' && p.type !== 'photo-note' && p.type !== 'video' && p.type !== 'audio') continue;
    const m = byId.get(p.memory.id);
    if (!m) continue;
    if (p.type === 'video') {
      const thumb = (m.thumbnail_url ?? m.poster_url ?? '').trim();
      if (thumb && !isHttps(thumb)) {
        throw new Error('PREP_NOT_READY');
      }
      // Export PDF non-bloquant AV: la page vidéo nécessite la vignette https, le média peut arriver plus tard.
    } else if (p.type === 'audio') {
      // Export PDF non-bloquant AV: on n'exige pas que l'audio soit déjà uploadé.
    } else {
      const main = photoMainForGuest(m);
      if (main && !isHttps(main)) {
        throw new Error('PREP_NOT_READY');
      }
    }
  }
}

async function callInitExportPdf(body: Record<string, unknown>): Promise<InitExportPdfResponse> {
  const { status, json } = await postInitExport(body);

  if (status === 400 && json.error === 'BOOK_AV_LIMIT_EXCEEDED') {
    const max = typeof json.maxAllowed === 'number' ? json.maxAllowed : 10;
    const cur = typeof json.current === 'number' ? json.current : 0;
    throw new Error(
      `Limite audio/vidéo atteinte (offre gratuite) : ${cur}/${max} pages cumulées sur tous tes livres.`
    );
  }

  if (status === 429) {
    throw new Error(
      typeof json.error === 'string' ? json.error : 'Trop de demandes. Réessaie plus tard.'
    );
  }

  if (status !== 200) {
    const msg = typeof json.error === 'string' ? json.error : `init-export (${status})`;
    throw new Error(msg);
  }

  const exportRequestId = typeof json.exportRequestId === 'string' ? json.exportRequestId : '';
  const crmContactId = typeof json.crmContactId === 'string' ? json.crmContactId : '';
  const pdfTicket = typeof json.pdfTicket === 'string' ? json.pdfTicket : '';
  const expiresInSeconds = typeof json.expiresInSeconds === 'number' ? json.expiresInSeconds : 0;
  const flow = json.flow === 'print_order' ? 'print_order' : 'pdf_export';
  if (!exportRequestId || (flow === 'pdf_export' && !pdfTicket)) {
    throw new Error('Réponse init-export invalide.');
  }
  return { exportRequestId, crmContactId, pdfTicket, expiresInSeconds, flow };
}

/** Mappe les pages livre → payload serveur (champs stabilisés). */
export function mapBookPagesToServerPayload(
  pages: BookPage[],
  rotations: Record<string, number>,
  photoCrops: Record<string, { xPct: number; yPct: number; scale: number }>,
  localEdits: Record<string, Partial<Memory>>,
  memoryPhotoRefs?: Record<string, string>,
): GenerateBookPdfPayload['pages'] {
  return pages.map(p => {
    switch (p.type) {
      case 'cover': {
        const c = photoCrops.cover;
        return { type: 'cover' as const, ...(c ? { crop: c } : {}) };
      }
      case 'chapter':
        return { type: 'chapter', month: p.month, chapterNum: p.chapterNum };
      case 'back-cover':
        return { type: 'back-cover' };
      case 'photo-full': {
        const m = p.memory;
        const ed = localEdits[m.id];
        const textOverride = typeof ed?.content === 'string' ? ed.content : undefined;
        const rot = rotations[m.id] ?? 0;
        const crop = photoCrops[m.id];
        const photoRef = p.photoRef?.trim() || memoryPhotoRefs?.[m.id]?.trim();
        return {
          type: p.type,
          memoryId: m.id,
          variant: p.variant,
          ...(rot !== 0 ? { rotation: rot } : {}),
          ...(crop ? { crop } : {}),
          ...(textOverride !== undefined ? { textOverride } : {}),
          ...(photoRef ? { photoRef } : {}),
        };
      }
      case 'photo-note':
      case 'quote':
      case 'audio':
      case 'video': {
        const m = p.memory;
        const ed = localEdits[m.id];
        const textOverride = typeof ed?.content === 'string' ? ed.content : undefined;
        const rot = rotations[m.id] ?? 0;
        const crop = photoCrops[m.id];
        const photoRef =
          p.type === 'photo-note'
            ? p.photoRef?.trim() || memoryPhotoRefs?.[m.id]?.trim()
            : undefined;
        return {
          type: p.type,
          memoryId: m.id,
          ...(rot !== 0 ? { rotation: rot } : {}),
          ...(crop ? { crop } : {}),
          ...(textOverride !== undefined ? { textOverride } : {}),
          ...(photoRef ? { photoRef } : {}),
        };
      }
    }
  });
}

export type GenerateBookPdfServerInput = {
  bookId: string;
  childId: string;
  child: Child;
  coverPhotoUrl?: string | null;
  coverPhotoImgPxW?: number;
  coverPhotoImgPxH?: number;
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  pages: BookPage[];
  rotations: Record<string, number>;
  photoCrops: Record<string, { xPct: number; yPct: number; scale: number }>;
  localEdits: Record<string, Partial<Memory>>;
  /** Slot photo album par souvenir — parité aperçu livre / SQLite `memoryPhotoRefs`. */
  memoryPhotoRefs?: Record<string, string>;
  /** `screen` → digital, `print` → print */
  exportMode: 'screen' | 'print';
};

function pdfServerHttpErrorMessage(status: number, detail: string): string {
  const d = detail.trim();
  const gateway = status === 502 || status === 503 || status === 504;
  if (gateway) {
    if (d) {
      return appendDevExportHint(
        `${d}\n\n${EXPORT_SERVER_FAILED_CONTACT_MESSAGE}`,
        `HTTP ${status}`
      );
    }
    return appendDevExportHint(
      EXPORT_SERVER_FAILED_CONTACT_MESSAGE,
      `HTTP ${status} (souvent service PDF Railway arrêté, timeout Playwright ou proxy). Voir logs serveur [generate-pdf].`
    );
  }
  if (d) return appendDevExportHint(d, `HTTP ${status}`);
  return appendDevExportHint(
    `${EXPORT_SERVER_FAILED_CONTACT_MESSAGE} (code ${status}).`,
    `HTTP ${status}`
  );
}

/**
 * Appelle POST /v1/books/generate-pdf, télécharge le PDF signé vers le cache local, retourne l’URI fichier.
 */
export async function generateBookPdfViaServer(input: GenerateBookPdfServerInput): Promise<{
  localUri: string;
  response: GenerateBookPdfResponse;
}> {
  const base = pdfServerBaseUrl();
  if (!base) {
    throw new Error('Service PDF non configuré (EXPO_PUBLIC_PDF_SERVER_URL).');
  }

  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  const userId = sess.session?.user?.id;
  if (!accessToken || !userId) {
    throw new Error('Session requise pour exporter via le serveur.');
  }

  await ensureVoiceRowsCloudSyncedForSessionPdf(input.pages, input.localEdits, userId, input.childId);

  const voiceCoverOverrides = await ensureVoiceCoversPersistedForServerPdf(
    input.pages,
    input.localEdits,
    input.childId
  );
  const videoPosterOverrides = await ensureVideoPostersPersistedForServerPdf(
    input.pages,
    input.localEdits,
    input.childId
  );
  const photoPrintOverrides = await ensurePhotoPrintUrlsForServerPdf(
    input.pages,
    input.localEdits,
    input.childId,
    input.memoryPhotoRefs,
  );
  const guestMemoryOverrides = [...voiceCoverOverrides, ...videoPosterOverrides, ...photoPrintOverrides];

  const { subscriptionTier, digitalExportPaid } = await resolveServerPdfEntitlements();

  const slotHttpsSession = await buildPagePhotoRefHttpsMapSession(input.pages, input.childId);
  const pagesPayload = applyHttpsPhotoRefsToServerPages(
    mapBookPagesToServerPayload(
      input.pages,
      input.rotations,
      input.photoCrops,
      input.localEdits,
      input.memoryPhotoRefs,
    ),
    slotHttpsSession,
  );

  const payload: GenerateBookPdfPayload = {
    bookId: input.bookId,
    childId: input.childId,
    coverPhotoUrl: input.coverPhotoUrl ?? null,
    coverPhotoImgPxW: input.coverPhotoImgPxW,
    coverPhotoImgPxH: input.coverPhotoImgPxH,
    coverTitle: input.coverTitle,
    coverYearLabel: input.coverYearLabel,
    chapterTitle: input.chapterTitle,
    // QR stable public : `https://petitmo.app/m/{token}` (pas le serveur PDF).
    qrBaseUrl: publicMediaBaseUrl(),
    exportMode: input.exportMode === 'print' ? 'print' : 'digital',
    pages: pagesPayload,
    subscriptionTier,
    ...(subscriptionTier === 'free' ? { digitalExportPaid } : {}),
    ...(guestMemoryOverrides.length > 0 ? { guestMemories: guestMemoryOverrides } : {}),
  };

  const res = await fetch(`${base}/v1/books/generate-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 402) {
    throw new Error('EXPORT_PAYMENT_REQUIRED');
  }

  if (!res.ok) {
    const detail = await parseGeneratePdfErrorBody(res);
    logPdfExportFailure('generate-pdf (session)', {
      httpStatus: res.status,
      detailPreview: detail.slice(0, 400),
      pdfServerHost: base.replace(/^https?:\/\//i, '').split('/')[0],
    });
    throw new Error(pdfServerHttpErrorMessage(res.status, detail));
  }

  const json = (await res.json()) as GenerateBookPdfResponse;
  if (!json.pdfUrlSigned?.trim()) {
    logPdfExportFailure('generate-pdf (session) réponse 200 sans pdfUrlSigned', {
      keys: json && typeof json === 'object' ? Object.keys(json) : [],
    });
    throw new Error(
      appendDevExportHint(
        EXPORT_SERVER_FAILED_CONTACT_MESSAGE,
        'Réponse 200 mais pdfUrlSigned vide — voir logs serveur / bucket books-pdf.'
      )
    );
  }
  persistQrTokensFromPdfResponse(json);

  const safeBook = input.bookId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const mode = input.exportMode === 'print' ? 'print' : 'digital';
  const baseDir = documentDirectory ?? '';
  const exportDir = `${baseDir}petitmo-book-exports`;
  try {
    await makeDirectoryAsync(exportDir, { intermediates: true });
  } catch {
    /* exists */
  }
  const dest = `${exportDir}/book-${safeBook}-${mode}-${Date.now()}.pdf`;

  const dl = await downloadAsync(json.pdfUrlSigned, dest);
  if (dl.status !== 200) {
    logPdfExportFailure('téléchargement pdfUrlSigned (session)', {
      downloadStatus: dl.status,
      urlHost: json.pdfUrlSigned.replace(/^https?:\/\//i, '').split('/')[0],
    });
    throw new Error(
      appendDevExportHint(
        EXPORT_SERVER_FAILED_CONTACT_MESSAGE,
        `Téléchargement du PDF signé : statut ${dl.status}`
      )
    );
  }

  return { localUri: dl.uri, response: json };
}

export type GenerateBookPdfViaGuestInput = GenerateBookPdfServerInput & {
  consent: GuestPdfExportConsent;
};

export type GenerateBookPdfWithExportTicketInput = GenerateBookPdfServerInput & {
  exportTicket: string;
  subscriptionTier: 'free' | 'premium';
  /** Export PDF numérique gratuit : achat IAP à l’acte. Ignoré pour `print_order`. */
  digitalExportPaid?: boolean;
};

/**
 * `generate-pdf` avec un ticket JWT existant (`export_pdf` ou `export_print`).
 * Upload médias invité + téléchargement PDF local.
 */
export async function generateBookPdfWithExportTicket(
  input: GenerateBookPdfWithExportTicketInput,
): Promise<{ localUri: string; response: GenerateBookPdfResponse }> {
  const base = pdfServerBaseUrl();
  if (!base) {
    throw new Error('Service PDF non configuré (EXPO_PUBLIC_PDF_SERVER_URL).');
  }

  const pdfTicket = input.exportTicket.trim();
  if (!pdfTicket) {
    throw new Error('Ticket export manquant.');
  }

  const { subscriptionTier, digitalExportPaid = false } = input;
  const memories = collectMemoriesFromPagesForPdf(input.pages, input.localEdits);

  let coverPhotoUrlOut: string | null = input.coverPhotoUrl ?? null;
  const coverLocal = (coverPhotoUrlOut ?? '').trim();
  if (coverLocal && !isHttps(coverLocal) && Platform.OS !== 'web') {
    try {
      /**
       * Local-first (règle d’or) : le spread affiche déjà la cover → bytes en sandbox
       * (`book_covers/{bookId}.jpg`, print/display du slot). Cloud = repli sécurité seulement
       * si aucun fichier local lisible (autre appareil / purge).
       */
      const coverIsCloudPath = isBareMediaBucketPath(coverLocal) || isHttps(coverLocal);
      const photoIds = memories.filter(m => m.type === 'photo').map(m => m.id);
      const coverMem =
        findPhotoMemoryByCoverRef(coverLocal, photoIds) ??
        memories.find(m => m.type === 'photo' && memoryPhotoMatchesUrl(m, coverLocal)) ??
        null;

      const coverCandidates: string[] = [];

      if (coverMem && coverMem.type === 'photo') {
        const idx = indexOfPhotoUrlInFeed(coverMem, coverLocal);
        // Slot connu seulement : jamais dump primaire / autres photos d’album.
        if (idx >= 0) {
          const printSlot = getBookPhotoPrintUri(coverMem, coverLocal).trim();
          if (printSlot && !isHttps(printSlot) && !isBareMediaBucketPath(printSlot)) {
            coverCandidates.push(printSlot, inferLocalDisplayPathFromPrint(printSlot));
          }
          const displaySlot = getPhotoUriForBookMaquetteDisplay(coverMem, coverLocal).trim();
          if (displaySlot && !isHttps(displaySlot) && !isBareMediaBucketPath(displaySlot)) {
            coverCandidates.push(displaySlot);
          }
        }
      }

      // Copie persistée après choix de cover (souvent = ce que le spread a affiché).
      const dedicated = dedicatedBookCoverUriForBook(input.bookId);
      if (dedicated) coverCandidates.push(dedicated);

      if (!coverIsCloudPath) {
        coverCandidates.push(coverLocal, inferLocalDisplayPathFromPrint(coverLocal));
      }

      const localOnly = coverCandidates.filter(
        u => u.trim().length > 0 && !isHttps(u) && !isBareMediaBucketPath(u),
      );
      const readableCover = await pickFirstReadableLocalMediaUri(localOnly);

      if (readableCover) {
        const compressedCover = await compressLocalJpegForGuestUpload(readableCover, {
          maxWidth: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
          quality: MEDIA_BOOK_PDF_COVER_JPEG_QUALITY,
        });
        const { readUrl } = await guestUploadMediaImageThenReadUrl({
          pdfTicket,
          asset: { kind: 'cover' },
          localUri: compressedCover,
          mimeType: 'image/jpeg',
        });
        coverPhotoUrlOut = readUrl;
      } else if (coverIsCloudPath) {
        if (__DEV__) {
          console.warn(
            '[bookPdfServer] cover: aucun fichier local lisible — repli cloud (hors local-first idéal)',
            coverLocal.slice(0, 96),
          );
        }
        const signed = await getSignedMediaDisplayUrl(coverLocal);
        if (!signed || !isHttps(signed)) {
          // Service role côté serveur saura signer (chemin Storage nu).
          coverPhotoUrlOut = coverLocal;
        } else {
          try {
            const baseDir = documentDirectory ?? '';
            const tmpDir = `${baseDir}petitmo-cover-tmp`;
            try {
              await makeDirectoryAsync(tmpDir, { intermediates: true });
            } catch {
              /* exists */
            }
            const dest = `${tmpDir}/cover-${Date.now()}.jpg`;
            const dl = await downloadAsync(signed, dest);
            if (dl.status !== 200 || !dl.uri) {
              coverPhotoUrlOut = signed;
            } else {
              const compressedCover = await compressLocalJpegForGuestUpload(dl.uri, {
                maxWidth: MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH,
                quality: MEDIA_BOOK_PDF_COVER_JPEG_QUALITY,
              });
              const { readUrl } = await guestUploadMediaImageThenReadUrl({
                pdfTicket,
                asset: { kind: 'cover' },
                localUri: compressedCover,
                mimeType: 'image/jpeg',
              });
              coverPhotoUrlOut = readUrl;
            }
          } catch {
            coverPhotoUrlOut = signed;
          }
        }
      } else {
        throw new Error(
          `COVER_NOT_READABLE cover=${coverLocal.slice(0, 96)} candidates=${localOnly.length}`,
        );
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (__DEV__) console.warn('[bookPdfServer] cover upload failed', detail);
      throw new Error(
        appendDevExportHint(
          'Impossible d’envoyer la couverture du livre pour le PDF. Rouvre l’aperçu, vérifie la photo de couverture, puis réessaie.',
          detail,
        ),
      );
    }
  }

  const guestMemories = await Promise.all(
    memories.map(async m => {
      const merged = m.type === 'voice' ? mergeMemoryWithLocalRowForVoiceCover(m) : m;
      const g = memoryToGuestPayload(merged);
      if (merged.type === 'voice') {
        const coverUri = getVoiceCoverUriForBookPreview(merged).trim();
        let voiceCoverUrl: string | null = httpsOrNull(merged.voice_cover_url);
        if (
          !voiceCoverUrl &&
          coverUri &&
          !isHttps(coverUri) &&
          !isBareMediaBucketPath(coverUri) &&
          Platform.OS !== 'web'
        ) {
          try {
            const readableCover = await pickFirstReadableLocalMediaUri(
              collectVoiceCoverLocalUploadUriCandidates(merged),
            );
            if (!readableCover) throw new Error('VOICE_COVER_NOT_READABLE');
            const compressed = await compressLocalJpegForGuestUpload(readableCover);
            const { readUrl } = await guestUploadMediaImageThenReadUrl({
              pdfTicket,
              asset: { kind: 'voice_cover', memoryId: m.id },
              localUri: compressed,
              mimeType: 'image/jpeg',
            });
            voiceCoverUrl = readUrl;
          } catch {
            /* ignore */
          }
        }
        return { ...g, voice_cover_url: voiceCoverUrl };
      }
      if (m.type === 'video') {
        const mergedVideo = mergeMemoryWithLocalRowForVideoPoster(m);
        const local = (mergedVideo.local_original_path ?? mergedVideo.local_media_path ?? '').trim();

        let thumbLocal = getVideoPosterUriForBookPreview(mergedVideo).trim();
        if (thumbLocal && isHttps(thumbLocal)) {
          /* ok */
        } else if (Platform.OS !== 'web' && local && !thumbLocal) {
          try {
            const { uri: t } = await VideoThumbnails.getThumbnailAsync(local, { time: 0, quality: 0.7 });
            thumbLocal = t;
          } catch {
            thumbLocal = '';
          }
        }

        let thumbPublicUrl: string | null = isHttps(thumbLocal) ? thumbLocal : null;
        try {
          if (thumbLocal && !isHttps(thumbLocal)) {
            const posterCandidates = collectVideoPosterLocalUploadUriCandidates(mergedVideo);
            const readableThumb = await pickFirstReadableLocalMediaUri(
              posterCandidates.length > 0 ? posterCandidates : [thumbLocal],
            );
            if (!readableThumb) throw new Error('VIDEO_THUMB_NOT_READABLE');
            const compressed = await compressLocalJpegForGuestUpload(readableThumb);
            const { readUrl } = await guestUploadMediaImageThenReadUrl({
              pdfTicket,
              asset: { kind: 'video_thumb', memoryId: m.id },
              localUri: compressed,
              mimeType: 'image/jpeg',
            });
            thumbPublicUrl = readUrl;
          }
        } catch {
          /* ignore */
        }
        return {
          ...g,
          thumbnail_url: thumbPublicUrl ?? g.thumbnail_url ?? null,
          poster_url: thumbPublicUrl ?? g.poster_url ?? null,
          poster_print_url: thumbPublicUrl ?? g.poster_print_url ?? null,
        };
      }
      if (m.type !== 'photo') return g;

      const photoRef = input.memoryPhotoRefs?.[m.id]?.trim();
      const slotPrint = getBookPhotoPrintUri(m, photoRef).trim();
      const main = (
        slotPrint ||
        m.print_url ||
        m.display_url ||
        m.edited_media_url ||
        m.media_url ||
        ''
      ).trim();
      if (main && isHttps(main)) {
        return { ...g, print_url: main, display_url: main, media_url: main };
      }
      if (!main || isHttps(main)) return g;

      const local = await pickFirstReadableLocalMediaUri(
        slotPrint
          ? [slotPrint, ...collectPhotoLocalUploadUriCandidates(m)]
          : collectPhotoLocalUploadUriCandidates(m),
      );
      if (!local) throw new Error('PREP_NOT_READY');

      const compressed = await compressLocalJpegForGuestUpload(local);
      const { readUrl, path } = await guestUploadMediaImageThenReadUrl({
        pdfTicket,
        asset: { kind: 'photo', memoryId: m.id },
        localUri: compressed,
        mimeType: 'image/jpeg',
      });
      return { ...g, print_url: readUrl, display_url: readUrl, media_url: readUrl, media_path: path };
    }),
  );

  const slotHttps = await buildPagePhotoRefHttpsMap(input.pages, pdfTicket);
  const pagesPayload = applyHttpsPhotoRefsToServerPages(
    mapBookPagesToServerPayload(
      input.pages,
      input.rotations,
      input.photoCrops,
      input.localEdits,
      input.memoryPhotoRefs,
    ),
    slotHttps,
  );

  const payload: GenerateBookPdfPayload = {
    bookId: input.bookId,
    childId: input.childId,
    coverPhotoUrl: coverPhotoUrlOut,
    coverPhotoImgPxW: input.coverPhotoImgPxW,
    coverPhotoImgPxH: input.coverPhotoImgPxH,
    coverTitle: input.coverTitle,
    coverYearLabel: input.coverYearLabel,
    chapterTitle: input.chapterTitle,
    qrBaseUrl: publicMediaBaseUrl(),
    exportMode: input.exportMode === 'print' ? 'print' : 'digital',
    pages: pagesPayload,
    subscriptionTier,
    ...(subscriptionTier === 'free' ? { digitalExportPaid } : {}),
    guestChild: {
      name: input.child.name,
      photo_url: input.child.photo_url ?? null,
      birthdate: input.child.birthdate ?? null,
    },
    guestMemories,
  };

  const res = await fetch(`${base}/v1/books/generate-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pdfTicket}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 402) {
    throw new Error('EXPORT_PAYMENT_REQUIRED');
  }

  if (!res.ok) {
    const detail = await parseGeneratePdfErrorBody(res);
    logPdfExportFailure('generate-pdf (export ticket)', {
      httpStatus: res.status,
      detailPreview: detail.slice(0, 400),
      pdfServerHost: base.replace(/^https?:\/\//i, '').split('/')[0],
      bookId: input.bookId,
    });
    throw new Error(pdfServerHttpErrorMessage(res.status, detail));
  }

  const json = (await res.json()) as GenerateBookPdfResponse;
  if (!json.pdfUrlSigned?.trim()) {
    logPdfExportFailure('generate-pdf (export ticket) réponse 200 sans pdfUrlSigned', {
      keys: json && typeof json === 'object' ? Object.keys(json) : [],
      bookId: input.bookId,
    });
    throw new Error(
      appendDevExportHint(
        EXPORT_SERVER_FAILED_CONTACT_MESSAGE,
        'Réponse 200 mais pdfUrlSigned vide — voir export_requests / logs Railway.'
      )
    );
  }
  persistQrTokensFromPdfResponse(json);

  const avUploadPromise = guestAvRawUploadAfterPdf({ pdfTicket, memories });

  const safeBook = input.bookId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const mode = input.exportMode === 'print' ? 'print' : 'digital';
  const baseDir = documentDirectory ?? '';
  const exportDir = `${baseDir}petitmo-book-exports`;
  try {
    await makeDirectoryAsync(exportDir, { intermediates: true });
  } catch {
    /* exists */
  }
  const dest = `${exportDir}/book-${safeBook}-${mode}-${Date.now()}.pdf`;

  const dl = await downloadAsync(json.pdfUrlSigned, dest);
  if (dl.status !== 200) {
    logPdfExportFailure('téléchargement pdfUrlSigned (export ticket)', {
      downloadStatus: dl.status,
      urlHost: json.pdfUrlSigned.replace(/^https?:\/\//i, '').split('/')[0],
      bookId: input.bookId,
    });
    throw new Error(
      appendDevExportHint(
        EXPORT_SERVER_FAILED_CONTACT_MESSAGE,
        `Téléchargement du PDF signé : statut ${dl.status}`
      )
    );
  }

  await avUploadPromise;

  return { localUri: dl.uri, response: json };
}

/**
 * Export serveur **sans session Supabase** : `init-export` (ticket) puis `generate-pdf` avec médias inline.
 * Exige des URLs **https** pour couverture / photos / vignettes vidéo (Playwright sur Railway).
 */
export async function generateBookPdfViaServerAsGuest(input: GenerateBookPdfViaGuestInput): Promise<{
  localUri: string;
  response: GenerateBookPdfResponse;
  init: InitExportPdfResponse;
}> {
  const base = pdfServerBaseUrl();
  if (!base) {
    throw new Error('Service PDF non configuré (EXPO_PUBLIC_PDF_SERVER_URL).');
  }
  if (!isInitExportConfigured()) {
    throw new Error('init-export indisponible (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY).');
  }

  const { subscriptionTier, digitalExportPaid } = await resolveServerPdfEntitlements();
  if (subscriptionTier === 'free' && !digitalExportPaid) {
    throw new Error('EXPORT_PAYMENT_REQUIRED');
  }

  const subscriptionTierInit = subscriptionTier === 'premium' || digitalExportPaid ? 'paid' : 'free';
  const avCount = countAudioVideoPages(input.pages);

  const email = input.consent.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse e-mail invalide.');
  }

  const init = await callInitExportPdf({
    type: 'pdf_export',
    export_mode: input.exportMode === 'print' ? 'print' : 'digital',
    book_id: input.bookId,
    child_local_id: input.childId,
    subscription_tier: subscriptionTierInit,
    audio_video_page_count: avCount,
    email,
    gdpr_consent_at: input.consent.gdprConsentAtIso,
    full_name: input.consent.fullName ?? null,
    marketing_opt_in: input.consent.marketingOptIn === true,
  });

  const pdfTicket = init.pdfTicket;
  if (!pdfTicket) {
    throw new Error('Réponse init-export invalide (ticket manquant).');
  }

  const result = await generateBookPdfWithExportTicket({
    ...input,
    exportTicket: pdfTicket,
    subscriptionTier,
    digitalExportPaid,
  });

  return { ...result, init };
}

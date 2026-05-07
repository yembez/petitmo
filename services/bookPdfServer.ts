/**
 * Export PDF via le service Railway (Playwright) — spec « PDF server ».
 * Preview locale : toujours `services/bookPdf.ts` + expo-print.
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
import { enqueueGuestRawUpload, markGuestRawUploadDone } from '@/services/pendingRawGuestUploads';
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
import {
  ensureChildRowExistsOnSupabaseForExport,
  ensureLocalChildrenSyncedToSupabase,
} from '@/services/children';
import { ensureVoiceMemoryCloudForBookExport } from '@/services/migration';
import { persistVoiceCoverToCloudForPdfExport } from '@/services/media';
import { getVoiceCoverUriForBookPreview } from '@/utils/memoryPhotos';
import { resolveServerPdfEntitlements } from '@/lib/digitalExportPurchase';
import { MEDIA_BOOK_PRINT_MAX_WIDTH } from '@/lib/limits';
import { isInitExportConfigured, postInitExport, postGuestUploadUrls } from '@/services/initExportApi';

function pdfServerBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_PDF_SERVER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

function publicMediaBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL?.trim();
  const base = raw ? raw.replace(/\/$/, '') : 'https://petitmo.app/m';
  return base;
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
        overrides.push({ id: m.id, type: 'voice', voice_cover_url: url });
      }
    } catch (e) {
      console.warn('[bookPdfServer] ensureVoiceCoversPersistedForServerPdf', m.id, e);
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
  };
}

function isHttps(u: string | null | undefined): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim());
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
  let src = params.localJpegUri;
  // Pour éviter les payloads énormes en base64 (413), on downscale/compresse avant upload guest.
  if (Platform.OS !== 'web') {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        params.localJpegUri,
        [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      if (manipulated?.uri) src = manipulated.uri;
    } catch {
      // fallback: on tente l'original
    }
  }
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
    // Vidéos : non prises en charge en QR médias sur le plan gratuit (et bloquées côté commande).
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
  localEdits: Record<string, Partial<Memory>>
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
      case 'photo-full':
      case 'photo-note':
      case 'quote':
      case 'audio':
      case 'video': {
        const m = p.memory;
        const ed = localEdits[m.id];
        const textOverride = typeof ed?.content === 'string' ? ed.content : undefined;
        const rot = rotations[m.id] ?? 0;
        const crop = photoCrops[m.id];
        return {
          type: p.type,
          memoryId: m.id,
          ...(rot !== 0 ? { rotation: rot } : {}),
          ...(crop ? { crop } : {}),
          ...(textOverride !== undefined ? { textOverride } : {}),
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
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  pages: BookPage[];
  rotations: Record<string, number>;
  photoCrops: Record<string, { xPct: number; yPct: number; scale: number }>;
  localEdits: Record<string, Partial<Memory>>;
  /** `screen` → digital, `print` → print */
  exportMode: 'screen' | 'print';
};

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

  const { subscriptionTier, digitalExportPaid } = await resolveServerPdfEntitlements();

  const payload: GenerateBookPdfPayload = {
    bookId: input.bookId,
    childId: input.childId,
    coverPhotoUrl: input.coverPhotoUrl ?? null,
    coverTitle: input.coverTitle,
    coverYearLabel: input.coverYearLabel,
    chapterTitle: input.chapterTitle,
    // QR stable public : `https://petitmo.app/m/{token}` (pas le serveur PDF).
    qrBaseUrl: publicMediaBaseUrl(),
    exportMode: input.exportMode === 'print' ? 'print' : 'digital',
    pages: mapBookPagesToServerPayload(
      input.pages,
      input.rotations,
      input.photoCrops,
      input.localEdits
    ),
    subscriptionTier,
    ...(subscriptionTier === 'free' ? { digitalExportPaid } : {}),
    ...(voiceCoverOverrides.length > 0 ? { guestMemories: voiceCoverOverrides } : {}),
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
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = errorMessageFromPdfServerJson(j, detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Erreur serveur PDF (${res.status})`);
  }

  const json = (await res.json()) as GenerateBookPdfResponse;
  if (!json.pdfUrlSigned?.trim()) {
    throw new Error('Réponse serveur invalide (pdfUrlSigned manquant).');
  }

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
    throw new Error(`Téléchargement PDF échoué (${dl.status})`);
  }

  return { localUri: dl.uri, response: json };
}

export type GenerateBookPdfViaGuestInput = GenerateBookPdfServerInput & {
  consent: GuestPdfExportConsent;
};

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
  const memories = collectMemoriesFromPagesForPdf(input.pages, input.localEdits);

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

  // Cover: si locale, upload direct Supabase (`media`) via signed URL et injecter l'URL de lecture signée.
  let coverPhotoUrlOut: string | null = input.coverPhotoUrl ?? null;
  const coverLocal = (coverPhotoUrlOut ?? '').trim();
  if (coverLocal && !isHttps(coverLocal) && Platform.OS !== 'web') {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        coverLocal,
        [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      const { readUrl } = await guestUploadMediaImageThenReadUrl({
        pdfTicket,
        asset: { kind: 'cover' },
        localUri: manipulated?.uri || coverLocal,
        mimeType: 'image/jpeg',
      });
      coverPhotoUrlOut = readUrl;
    } catch {
      // fallback: pas de cover (placeholder)
      coverPhotoUrlOut = null;
    }
  }

  // Guest: si des photos sont encore locales, on les uploade via le serveur PDF (ticket) puis on remplace les URLs.
  // Cela évite de dépendre d'une session Supabase pour obtenir des URLs https.
  const guestMemories = await Promise.all(
    memories.map(async m => {
      const merged = m.type === 'voice' ? mergeMemoryWithLocalRowForVoiceCover(m) : m;
      const g = memoryToGuestPayload(merged);
      if (merged.type === 'voice') {
        // PDF immédiat : pas d’upload du fichier audio avant generate-pdf.
        // Photo de fond vocal (voice_cover) : même besoin que la vignette vidéo — petite image HTTPS pour Playwright.
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
            const manipulated = await ImageManipulator.manipulateAsync(
              coverUri,
              [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
              { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
            );
            const { readUrl } = await guestUploadMediaImageThenReadUrl({
              pdfTicket,
              asset: { kind: 'voice_cover', memoryId: m.id },
              localUri: manipulated?.uri || coverUri,
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
        const local = (m.local_original_path ?? m.local_media_path ?? '').trim();

        // Thumbnail: générer si absent, puis upload (seul prérequis lourd acceptable avant PDF pour Playwright).
        let thumbLocal = (m.thumbnail_url ?? m.poster_url ?? '').trim();
        if (thumbLocal && isHttps(thumbLocal)) {
          // ok
        } else if (Platform.OS !== 'web' && local) {
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
            const manipulated = await ImageManipulator.manipulateAsync(
              thumbLocal,
              [{ resize: { width: 1200 } }],
              { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
            );
            const { readUrl } = await guestUploadMediaImageThenReadUrl({
              pdfTicket,
              asset: { kind: 'video_thumb', memoryId: m.id },
              localUri: manipulated?.uri || thumbLocal,
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
        };
      }
      if (m.type !== 'photo') return g;

      const main = (m.print_url ?? m.display_url ?? m.edited_media_url ?? m.media_url ?? '').trim();
      if (!main || isHttps(main)) return g;

      const local =
        (m.local_print_path ?? m.local_original_path ?? m.local_media_path ?? '').trim();
      if (!local) throw new Error('PREP_NOT_READY');

      const manipulated = await ImageManipulator.manipulateAsync(
        local,
        [{ resize: { width: MEDIA_BOOK_PRINT_MAX_WIDTH } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      const { readUrl, path } = await guestUploadMediaImageThenReadUrl({
        pdfTicket,
        asset: { kind: 'photo', memoryId: m.id },
        localUri: manipulated?.uri || local,
        mimeType: 'image/jpeg',
      });
      return { ...g, print_url: readUrl, display_url: readUrl, media_url: readUrl, media_path: path };
    })
  );
  const payload: GenerateBookPdfPayload = {
    bookId: input.bookId,
    childId: input.childId,
    coverPhotoUrl: coverPhotoUrlOut,
    coverTitle: input.coverTitle,
    coverYearLabel: input.coverYearLabel,
    chapterTitle: input.chapterTitle,
    qrBaseUrl: publicMediaBaseUrl(),
    exportMode: input.exportMode === 'print' ? 'print' : 'digital',
    pages: mapBookPagesToServerPayload(
      input.pages,
      input.rotations,
      input.photoCrops,
      input.localEdits
    ),
    subscriptionTier,
    ...(subscriptionTier === 'free' ? { digitalExportPaid } : {}),
    guestChild: {
      name: input.child.name,
      photo_url: input.child.photo_url ?? null,
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
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = errorMessageFromPdfServerJson(j, detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Erreur serveur PDF (${res.status})`);
  }

  const json = (await res.json()) as GenerateBookPdfResponse;
  if (!json.pdfUrlSigned?.trim()) {
    throw new Error('Réponse serveur invalide (pdfUrlSigned manquant).');
  }

  // Upload AV brut après succès PDF : lancé tout de suite pour chevaucher le téléchargement du PDF,
  // puis on attend la fin avant de retourner — sinon `void` laisse souvent la vidéo inachevée (raw vide).
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
    throw new Error(`Téléchargement PDF échoué (${dl.status})`);
  }

  await avUploadPromise;

  return { localUri: dl.uri, response: json, init };
}

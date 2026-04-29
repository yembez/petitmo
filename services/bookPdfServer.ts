/**
 * Export PDF via le service Railway (Playwright) — spec « PDF server ».
 * Preview locale : toujours `services/bookPdf.ts` + expo-print.
 */
import { downloadAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { uploadAsync as uploadAsyncLegacy } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
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
import { resolveServerPdfEntitlements } from '@/lib/digitalExportPurchase';
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
    media_url: m.media_url ?? null,
    media_path: m.media_path ?? null,
    edited_media_url: m.edited_media_url ?? null,
    duration: m.duration ?? null,
    thumbnail_url: m.thumbnail_url ?? null,
    display_url: m.display_url ?? null,
    print_url: m.print_url ?? null,
    poster_url: m.poster_url ?? null,
    poster_print_url: m.poster_print_url ?? null,
  };
}

function isHttps(u: string | null | undefined): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim());
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
        [{ resize: { width: 1600 } }],
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
  if (!accessToken) {
    throw new Error('Session requise pour exporter via le serveur.');
  }

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
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
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

  type SignedUploadRow = {
    kind: 'cover' | 'photo' | 'audio' | 'video' | 'video_thumb';
    memoryId: string | null;
    bucket: string;
    path: string;
    signedUrl: string;
    token?: string;
    publicUrl?: string;
  };

  // Cover: si locale, upload direct Supabase (`media`) via signed URL et injecter l'URL publique.
  let coverPhotoUrlOut: string | null = input.coverPhotoUrl ?? null;
  const coverLocal = (coverPhotoUrlOut ?? '').trim();
  if (coverLocal && !isHttps(coverLocal) && Platform.OS !== 'web') {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        coverLocal,
        [{ resize: { width: 1600 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      const { status, json } = await postGuestUploadUrls({ pdfTicket, assets: [{ kind: 'cover' }] });
      const row = (json as any)?.uploads?.[0] as SignedUploadRow | undefined;
      if (status === 200 && row?.signedUrl && row.publicUrl) {
        await uploadFileToSignedUrl({
          signedUrl: row.signedUrl,
          localUri: manipulated?.uri || coverLocal,
          mimeType: 'image/jpeg',
        });
        coverPhotoUrlOut = row.publicUrl;
      } else {
        coverPhotoUrlOut = null;
      }
    } catch {
      // fallback: pas de cover (placeholder)
      coverPhotoUrlOut = null;
    }
  }

  // Guest: si des photos sont encore locales, on les uploade via le serveur PDF (ticket) puis on remplace les URLs.
  // Cela évite de dépendre d'une session Supabase pour obtenir des URLs https.
  const guestMemories = await Promise.all(
    memories.map(async m => {
      const g = memoryToGuestPayload(m);
      if (m.type === 'voice') {
        // PDF non-bloquant audio: on peut uploader raw en fond pour le QR, sinon on laisse vide.
        const local = (m.local_original_path ?? m.local_media_path ?? '').trim();
        if (!local) return g;
        try {
          const { status, json } = await postGuestUploadUrls({
            pdfTicket,
            assets: [{ kind: 'audio', memoryId: m.id }],
          });
          const row = (json as any)?.uploads?.[0] as SignedUploadRow | undefined;
          if (status === 200 && row?.signedUrl) {
            await uploadFileToSignedUrl({ signedUrl: row.signedUrl, localUri: local, mimeType: 'audio/mp4' });
            return { ...g, media_path: row.path };
          }
        } catch {
          /* ignore */
        }
        return g;
      }
      if (m.type === 'video') {
        const local = (m.local_original_path ?? m.local_media_path ?? '').trim();

        // Thumbnail: générer si absent, puis upload
        let thumbLocal = (m.thumbnail_url ?? m.poster_url ?? '').trim();
        if (thumbLocal && isHttps(thumbLocal)) {
          // ok
        } else if (Platform.OS !== 'web') {
          try {
            const { uri: t } = await VideoThumbnails.getThumbnailAsync(local, { time: 0, quality: 0.7 });
            thumbLocal = t;
          } catch {
            thumbLocal = '';
          }
        }

        // PDF: on a besoin d'une vignette https. Le fichier vidéo raw est optionnel (QR async).
        let thumbPublicUrl: string | null = isHttps(thumbLocal) ? thumbLocal : null;
        try {
          const assets: Array<{ kind: string; memoryId?: string }> = [];
          if (thumbLocal && !isHttps(thumbLocal)) assets.push({ kind: 'video_thumb', memoryId: m.id });
          if (local) assets.push({ kind: 'video', memoryId: m.id });
          if (assets.length) {
            const { status, json } = await postGuestUploadUrls({ pdfTicket, assets });
            const uploads = ((json as any)?.uploads ?? []) as SignedUploadRow[];
            const thumbRow = uploads.find(u => u.kind === 'video_thumb');
            const vidRow = uploads.find(u => u.kind === 'video');
            if (status === 200 && thumbRow?.signedUrl && thumbRow.publicUrl && thumbLocal && !isHttps(thumbLocal)) {
              const manipulated = await ImageManipulator.manipulateAsync(
                thumbLocal,
                [{ resize: { width: 1200 } }],
                { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
              );
              await uploadFileToSignedUrl({
                signedUrl: thumbRow.signedUrl,
                localUri: manipulated?.uri || thumbLocal,
                mimeType: 'image/jpeg',
              });
              thumbPublicUrl = thumbRow.publicUrl;
            }
            if (status === 200 && vidRow?.signedUrl && local) {
              await uploadFileToSignedUrl({ signedUrl: vidRow.signedUrl, localUri: local, mimeType: 'video/mp4' });
              return {
                ...g,
                thumbnail_url: thumbPublicUrl ?? g.thumbnail_url ?? null,
                poster_url: thumbPublicUrl ?? g.poster_url ?? null,
                media_path: vidRow.path,
              };
            }
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
        [{ resize: { width: 1600 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      const { status, json } = await postGuestUploadUrls({
        pdfTicket,
        assets: [{ kind: 'photo', memoryId: m.id }],
      });
      const row = (json as any)?.uploads?.[0] as SignedUploadRow | undefined;
      if (status !== 200 || !row?.signedUrl || !row.publicUrl) throw new Error('PREP_NOT_READY');
      await uploadFileToSignedUrl({
        signedUrl: row.signedUrl,
        localUri: manipulated?.uri || local,
        mimeType: 'image/jpeg',
      });
      return { ...g, print_url: row.publicUrl, display_url: row.publicUrl, media_url: row.publicUrl, media_path: row.path };
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
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
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

  return { localUri: dl.uri, response: json, init };
}

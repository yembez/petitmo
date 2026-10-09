import type { SupabaseClient } from '@supabase/supabase-js';
import { buildBookHtml, buildGelatoSpreadHtml, buildGelatoBlockHtml } from '../pdf/htmlBook';
import { renderGelatoPhotobookPdf } from '../pdf/gelatoPhotobookPdf';
import { countRenderedBookPages } from '../pdf/bookPageCount';
import { htmlToPdfBuffer } from '../pdf/renderPdf';
import { saveBookPdfForExportRequest } from '../pdf/pdfStorage';
import { preparePublicTokensForExportRequest } from '../pdf/preparePublicTokens';
import { ensureQrTokensReady } from '../worker/publicMediaWorkerOnce';
import type { MemoryRow, ChildRow } from '../pdf/memoryRow';
import {
  signChildRowForPdfRender,
  signMemoriesMapForPdfRender,
  signUrlForPdfRender,
} from '../pdf/signSupabaseMediaForPdf';
import { submitGelatoPrintOrder } from '../gelato/placePrintOrder';
import { fetchGelatoCoverLayout, assertGelatoCoverLayoutMatchesPetitmo } from '../gelato/coverDimensions';
import { gelatoCatalogPageCount, validateGelatoInnerPageCount } from '../gelato/photobookLayout';
import { loadGelatoConfig } from '../gelato/config';
import { countPdfPages } from '../pdf/countPdfPages';
import type {
  GenerateBookPdfPayload,
  GenerateBookPdfResponse,
  GuestMemoryForPdfPayload,
} from '../types/contracts';
import { assertPrintGuestPayload, isGenerateBookPdfPayload } from './isGenerateBookPdfPayload';
import { triggerPrintOrderConfirmationEmail } from '../email/triggerPrintOrderConfirmation';
import {
  clearPrintFulfillRetryState,
  recordPrintFulfillFailure,
} from './recordPrintFulfillFailure';

const PLACEHOLDER_CHILD_UUID = '00000000-0000-4000-8000-000000000001';

type ExportPrintRow = {
  id: string;
  crm_contact_id: string;
  type: string;
  export_mode: string;
  status: string;
  book_id: string;
  subscription_tier: string;
  payment_status?: string | null;
  pdf_payload_json?: unknown;
  pdf_storage_path?: string | null;
  printer_order_id?: string | null;
  last_error?: string | null;
  fulfill_failed_kind?: string | null;
};

export type FulfillPrintResult =
  | {
      ok: true;
      already?: boolean;
      response: GenerateBookPdfResponse;
    }
  | {
      ok: false;
      status: number;
      code?: string;
      error: string;
      detail?: string;
    };

function mapGuestMemories(list: GuestMemoryForPdfPayload[], exportRequestId: string): Map<string, MemoryRow> {
  const map = new Map<string, MemoryRow>();
  const now = new Date().toISOString();
  for (const g of list) {
    const createdRaw = typeof g.created_at === 'string' ? g.created_at.trim() : '';
    map.set(g.id, {
      id: g.id,
      child_id: PLACEHOLDER_CHILD_UUID,
      user_id: exportRequestId,
      type: g.type,
      content: g.content ?? null,
      text_title: g.text_title?.trim() ? g.text_title.trim() : null,
      media_url: g.media_url ?? null,
      media_path: g.media_path ?? null,
      edited_media_url: g.edited_media_url ?? null,
      duration: g.duration ?? null,
      thumbnail_url: g.thumbnail_url ?? null,
      display_url: g.display_url ?? null,
      print_url: g.print_url ?? null,
      poster_url: g.poster_url ?? null,
      poster_print_url: g.poster_print_url ?? null,
      voice_cover_url: g.voice_cover_url ?? null,
      voice_cover_path: null,
      location: g.location?.trim() ? g.location.trim() : null,
      created_at: createdRaw.length > 0 ? createdRaw : now,
    });
  }
  return map;
}

function qrTokenList(tokensByMemoryId: Map<string, string>): string[] {
  return [...new Set([...tokensByMemoryId.values()].map(t => t.trim()).filter(Boolean))];
}

function qrTokensRecord(tokensByMemoryId: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [memoryId, token] of tokensByMemoryId.entries()) {
    const t = token.trim();
    if (t) out[memoryId] = t;
  }
  return out;
}

function startBookQrWorkers(
  supabase: SupabaseClient,
  tokensByMemoryId: Map<string, string>,
): Promise<void> {
  const tokens = qrTokenList(tokensByMemoryId);
  if (tokens.length === 0) return Promise.resolve();
  return ensureQrTokensReady({ supabase, tokens, timeoutMs: 120_000 });
}

function resolveFamilyChildrenForPdf(
  body: GenerateBookPdfPayload,
  fallbackChild: { name: string; birthdate?: string | null },
): Array<{ name: string; birthdate: string | null }> {
  const fromPayload = body.guestFamilyChildren;
  if (Array.isArray(fromPayload) && fromPayload.length > 0) {
    return fromPayload
      .filter(c => typeof c?.name === 'string' && c.name.trim().length > 0)
      .map(c => ({
        name: c.name.trim(),
        birthdate: c.birthdate?.trim() ? c.birthdate.trim() : null,
      }));
  }
  return [
    {
      name: fallbackChild.name,
      birthdate: fallbackChild.birthdate?.trim() ? fallbackChild.birthdate.trim() : null,
    },
  ];
}

async function loadPrintExportRow(
  supabase: SupabaseClient,
  exportRequestId: string,
): Promise<ExportPrintRow | null> {
  const { data, error } = await supabase
    .from('export_requests')
    .select(
      'id, crm_contact_id, type, export_mode, status, book_id, subscription_tier, payment_status, pdf_payload_json, pdf_storage_path, printer_order_id, last_error, fulfill_failed_kind',
    )
    .eq('id', exportRequestId)
    .maybeSingle();
  if (error) {
    console.error('[fulfillPrint] select', error.message);
    return null;
  }
  return (data as ExportPrintRow | null) ?? null;
}

/** Succès Gelato réel uniquement — jamais `done` / `rendering` sans `printer_order_id`. */
export function isPrintSentToGelato(row: {
  status?: string | null;
  printer_order_id?: string | null;
}): boolean {
  const printerId = typeof row.printer_order_id === 'string' ? row.printer_order_id.trim() : '';
  return row.status === 'sent_to_printer' && printerId.length > 0;
}

function isRemoteMediaUrl(u: string): boolean {
  const t = u.trim();
  if (!t) return true;
  if (/^https:\/\//i.test(t)) return true;
  // Chemin Storage nu (signé côté serveur).
  if (/^(guest\/exports\/|exports\/|[0-9a-f]{8}-)/i.test(t)) return true;
  return false;
}

/** Détecte file:// / chemins locaux restés dans le payload (bug upload partiel). */
export function findLocalFileUrlInPrintPayload(body: GenerateBookPdfPayload): string | null {
  const check = (raw: string | null | undefined, label: string): string | null => {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) return null;
    if (isRemoteMediaUrl(t)) return null;
    return `${label}:${t.slice(0, 64)}`;
  };
  const cover = check(body.coverPhotoUrl ?? null, 'cover');
  if (cover) return cover;
  for (const m of body.guestMemories ?? []) {
    for (const [k, v] of Object.entries({
      print: m.print_url,
      display: m.display_url,
      media: m.media_url,
      thumb: m.thumbnail_url,
      poster: m.poster_url,
      poster_print: m.poster_print_url,
      voice_cover: m.voice_cover_url,
    })) {
      const hit = check(typeof v === 'string' ? v : null, `mem:${m.id}:${k}`);
      if (hit) return hit;
    }
  }
  for (const p of body.pages) {
    if (p && typeof p === 'object' && 'photoRef' in p) {
      const hit = check((p as { photoRef?: string }).photoRef, `page:${p.memoryId}:photoRef`);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * PDF + Gelato à partir d’un payload déjà validé (body generate-pdf ou stash).
 * Prérequis : ligne `created`, `payment_status=paid`. Lock → rendering.
 */
export async function runPrintPdfAndGelato(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
  exportRequestId: string;
  body: GenerateBookPdfPayload;
  subscriptionTierRow: string;
}): Promise<FulfillPrintResult> {
  const { supabase, projectOrigin, exportRequestId, body, subscriptionTierRow } = params;

  const guestErr = assertPrintGuestPayload(body);
  if (guestErr) {
    return { ok: false, status: 400, error: guestErr };
  }

  const guestChild = body.guestChild!;
  const guestMemories = body.guestMemories!;

  const memoryIds = [
    ...new Set(
      body.pages.flatMap((p): string[] => (typeof p.memoryId === 'string' && p.memoryId ? [p.memoryId] : []))
    ),
  ];

  const memoriesById = mapGuestMemories(guestMemories, exportRequestId);
  for (const id of memoryIds) {
    if (!memoriesById.has(id)) {
      return { ok: false, status: 400, error: 'guestMemories missing entry', detail: id };
    }
  }

  if (countRenderedBookPages(body.pages, memoriesById) < 1) {
    return {
      ok: false,
      status: 400,
      error: 'Aucune page livre à rendre (pages vides ou souvenirs manquants).',
    };
  }

  const { data: lockRows, error: lockErr } = await supabase
    .from('export_requests')
    .update({ status: 'rendering' })
    .eq('id', exportRequestId)
    .eq('status', 'created')
    .select('id');

  if (lockErr) {
    console.error('[fulfillPrint] lock', lockErr.message);
    return { ok: false, status: 500, error: 'Database error' };
  }
  if (!lockRows?.length) {
    return {
      ok: false,
      status: 409,
      code: 'EXPORT_STATE',
      error: 'Export request already used or in progress',
    };
  }

  const qrTier = subscriptionTierRow === 'paid' ? 'premium' : 'free';

  try {
    const qrResult = await preparePublicTokensForExportRequest({
      supabase,
      exportRequestId,
      bookId: body.bookId,
      pages: body.pages,
      memoriesById,
      subscriptionTier: qrTier,
      childBirthdate: guestChild.birthdate ?? null,
    });

    if (!qrResult.ok) {
      await recordPrintFulfillFailure({
        supabase,
        projectOrigin,
        exportRequestId,
        error: qrResult.message,
      });
      return { ok: false, status: qrResult.status, error: qrResult.message };
    }

    const qrWorkerPromise = startBookQrWorkers(supabase, qrResult.tokensByMemoryId);

    const child: ChildRow = {
      id: body.childId,
      user_id: exportRequestId,
      name: guestChild.name,
      photo_url: guestChild.photo_url ?? null,
      birthdate: guestChild.birthdate ?? null,
    };

    const memoriesForHtmlPrint = await signMemoriesMapForPdfRender(supabase, projectOrigin, memoriesById);
    const childForHtmlPrint = await signChildRowForPdfRender(supabase, projectOrigin, child);
    const coverRawPrint = body.coverPhotoUrl ?? null;
    const coverForHtmlPrint =
      typeof coverRawPrint === 'string' && coverRawPrint.trim()
        ? ((await signUrlForPdfRender(supabase, projectOrigin, coverRawPrint)) ?? coverRawPrint)
        : null;

    const gelatoConfig = loadGelatoConfig();
    const gelatoLayoutError = gelatoConfig ? validateGelatoInnerPageCount(body.pages) : null;
    if (gelatoLayoutError) {
      await recordPrintFulfillFailure({
        supabase,
        projectOrigin,
        exportRequestId,
        error: gelatoLayoutError,
        forceKind: 'permanent',
      });
      return { ok: false, status: 400, error: gelatoLayoutError };
    }

    const bookHtmlInput = {
      coverTitle: body.coverTitle,
      coverYearLabel: body.coverYearLabel,
      coverColorId: body.coverColorId ?? null,
      chapterTitle: body.chapterTitle,
      backCoverTagline: body.backCoverTagline ?? null,
      qrBaseUrl: body.qrBaseUrl,
      exportMode: 'print' as const,
      pages: body.pages,
      child: childForHtmlPrint,
      coverPhotoUrl: coverForHtmlPrint,
      coverPhotoImgPxW: body.coverPhotoImgPxW,
      coverPhotoImgPxH: body.coverPhotoImgPxH,
      memoriesById: memoriesForHtmlPrint,
      qrTokensByMemoryId: qrResult.tokensByMemoryId,
      familyChildren: resolveFamilyChildrenForPdf(body, guestChild),
    };

    let pdf: Buffer;
    if (gelatoConfig) {
      const catalogPageCount = gelatoCatalogPageCount(body.pages);
      const coverLayout = await fetchGelatoCoverLayout(gelatoConfig, catalogPageCount);
      assertGelatoCoverLayoutMatchesPetitmo(coverLayout);
      console.log(
        '[fulfillPrint] gelato product',
        coverLayout.productUid,
        `front ${coverLayout.contentFront.widthMm.toFixed(0)}×${coverLayout.contentFront.heightMm.toFixed(0)} mm`,
        `spread ${coverLayout.spreadWidthMm.toFixed(0)}×${coverLayout.spreadHeightMm.toFixed(0)} mm`,
      );
      const spreadHtml = buildGelatoSpreadHtml(bookHtmlInput, coverLayout);
      const blockHtml = buildGelatoBlockHtml(bookHtmlInput);
      pdf = await renderGelatoPhotobookPdf(spreadHtml, blockHtml, coverLayout);
    } else {
      pdf = await htmlToPdfBuffer(buildBookHtml(bookHtmlInput));
    }
    await qrWorkerPromise;
    const pdfPageCount = await countPdfPages(pdf);
    const saved = await saveBookPdfForExportRequest(supabase, {
      exportRequestId,
      bookId: body.bookId,
      exportMode: 'print',
      subscriptionPaid: true,
      pdfBytes: pdf,
    });

    // PDF stocké pendant `rendering` — on ne passe à `done`/`sent_to_printer`
    // qu’après Gelato OK (sinon le client confirme un livre fantôme).
    await supabase
      .from('export_requests')
      .update({
        pdf_storage_path: saved.pdfStoragePath,
        last_error: null,
      })
      .eq('id', exportRequestId);

    const gelatoResult = await submitGelatoPrintOrder(supabase, {
      exportRequestId,
      bookId: body.bookId,
      pdfStoragePath: saved.uploadedStoragePath,
      pdfPageCount,
      catalogPageCount: gelatoCatalogPageCount(body.pages),
    });
    const gelatoOrderType = gelatoConfig?.orderType;
    if (!gelatoResult.ok) {
      console.error('[fulfillPrint] gelato', exportRequestId, gelatoResult.message);
      await recordPrintFulfillFailure({
        supabase,
        projectOrigin,
        exportRequestId,
        error: gelatoResult.message || 'gelato_failed',
      });
      return {
        ok: false,
        status: 502,
        code: 'GELATO_FAILED',
        error: gelatoResult.message || 'Gelato order failed',
      };
    }
    if (gelatoResult.skipped) {
      console.warn('[fulfillPrint] gelato skipped', exportRequestId, gelatoResult.reason);
      await recordPrintFulfillFailure({
        supabase,
        projectOrigin,
        exportRequestId,
        error: gelatoResult.reason || 'gelato_skipped',
        // GELATO_NOT_CONFIGURED / PAYMENT_REQUIRED = ops, pas un flaky réseau.
        forceKind: /GELATO_NOT_CONFIGURED|PAYMENT_REQUIRED/i.test(gelatoResult.reason || '')
          ? 'permanent'
          : undefined,
      });
      return {
        ok: false,
        status: 502,
        code: 'GELATO_SKIPPED',
        error: gelatoResult.reason || 'Gelato skipped',
      };
    }

    console.log(
      '[fulfillPrint] gelato ok',
      exportRequestId,
      gelatoResult.gelatoOrderId,
      gelatoOrderType === 'draft' ? '(draft)' : '',
    );
    await clearPrintFulfillRetryState(supabase, exportRequestId);
    // Mail récap (livre, adresse, prix) — seulement une fois l’imprimeur OK.
    triggerPrintOrderConfirmationEmail({ projectOrigin, exportRequestId });

    return {
      ok: true,
      response: {
        pdfUrlSigned: saved.pdfUrlSigned,
        pdfStoragePath: saved.pdfStoragePath,
        qrTokensByMemoryId: qrTokensRecord(qrResult.tokensByMemoryId),
        gelato: {
          ok: true,
          orderId: gelatoResult.gelatoOrderId,
          ...(gelatoOrderType ? { orderType: gelatoOrderType } : {}),
        },
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[fulfillPrint] run', msg, e instanceof Error ? e.stack : '');
    await recordPrintFulfillFailure({
      supabase,
      projectOrigin,
      exportRequestId,
      error: msg,
    });
    return {
      ok: false,
      status: 500,
      error: 'PDF generation or storage failed',
      detail: msg,
    };
  }
}

/**
 * Fulfill depuis `pdf_payload_json` stashé (webhook / filet client).
 * Idempotent si déjà rendering / done / sent_to_printer / failed après lock.
 */
export async function fulfillPrintOrderFromStoredPayload(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
  exportRequestId: string;
}): Promise<FulfillPrintResult> {
  const { supabase, projectOrigin, exportRequestId } = params;
  const row = await loadPrintExportRow(supabase, exportRequestId);
  if (!row || row.type !== 'print_order') {
    return { ok: false, status: 404, error: 'Export request not found' };
  }
  if (row.export_mode !== 'print') {
    return { ok: false, status: 400, error: 'export_mode must be print' };
  }
  if (row.payment_status !== 'paid') {
    return { ok: false, status: 402, code: 'PAYMENT_REQUIRED', error: 'Payment required' };
  }

  // Seul `sent_to_printer` + printer_order_id = commande réelle chez Gelato.
  // `done` / `rendering` sans Gelato ne doivent JAMAIS être présentés comme succès.
  if (isPrintSentToGelato(row)) {
    return {
      ok: true,
      already: true,
      response: {
        pdfUrlSigned: '',
        pdfStoragePath: row.pdf_storage_path ?? null,
        gelato: {
          ok: true,
          skipped: true,
          message: 'already_fulfilled',
          orderId: row.printer_order_id!.trim(),
        },
      },
    };
  }

  if (row.status === 'rendering') {
    return {
      ok: false,
      status: 409,
      code: 'IN_PROGRESS',
      error: 'PDF + Gelato already in progress',
    };
  }

  // Échec permanent : pas de rejeu auto (sauf re-stash qui remet kind=null).
  if (row.status === 'failed' && row.fulfill_failed_kind === 'permanent') {
    return {
      ok: false,
      status: 409,
      code: 'PERMANENT_FAIL',
      error: (row.last_error || 'permanent fulfill failure').slice(0, 500),
    };
  }

  // Rejouer : `failed` retryable, ou ancien `done` sans Gelato (régression soft-fail).
  let runnableStatus = row.status;
  if (runnableStatus === 'done' || runnableStatus === 'failed') {
    const fromStatus = runnableStatus;
    const { data: resetRows, error: resetErr } = await supabase
      .from('export_requests')
      .update({ status: 'created', last_error: null, fulfill_next_retry_at: null })
      .eq('id', exportRequestId)
      .eq('status', fromStatus)
      .select('id');
    if (resetErr || !resetRows?.length) {
      return {
        ok: false,
        status: 409,
        code: 'EXPORT_STATE',
        error: `Unable to reset ${fromStatus} export for retry`,
      };
    }
    runnableStatus = 'created';
  }

  if (runnableStatus !== 'created') {
    return {
      ok: false,
      status: 409,
      code: 'EXPORT_STATE',
      error: `Export request status=${runnableStatus}`,
    };
  }

  if (!isGenerateBookPdfPayload(row.pdf_payload_json)) {
    // Course webhook vs stash : retryable court, escalade ~45 min (recordPrintFulfillFailure).
    const err = 'PAYLOAD_MISSING: pdf_payload_json missing or invalid — stash before checkout';
    await recordPrintFulfillFailure({
      supabase,
      projectOrigin,
      exportRequestId,
      error: err,
    });
    return { ok: false, status: 409, code: 'PAYLOAD_MISSING', error: err };
  }

  const body = row.pdf_payload_json;
  if (body.bookId !== row.book_id) {
    const err = 'bookId does not match export request';
    await recordPrintFulfillFailure({
      supabase,
      projectOrigin,
      exportRequestId,
      error: err,
      forceKind: 'permanent',
    });
    return { ok: false, status: 403, error: err };
  }

  // file:// = stash incomplet ; retryable en attendant re-stash client (escalade ~45 min).
  const localLeak = findLocalFileUrlInPrintPayload(body);
  if (localLeak) {
    const err = `PAYLOAD_LOCAL: pdf_payload contains local URL (${localLeak}) — re-stash after upload`;
    await recordPrintFulfillFailure({
      supabase,
      projectOrigin,
      exportRequestId,
      error: err,
    });
    return { ok: false, status: 409, code: 'PAYLOAD_LOCAL_URLS', error: err };
  }

  const tierOk =
    (row.subscription_tier === 'paid' && body.subscriptionTier === 'premium') ||
    (row.subscription_tier === 'free' && body.subscriptionTier === 'free');
  if (!tierOk) {
    const err = 'subscriptionTier does not match export request';
    await recordPrintFulfillFailure({
      supabase,
      projectOrigin,
      exportRequestId,
      error: err,
      forceKind: 'permanent',
    });
    return { ok: false, status: 400, error: err };
  }

  return runPrintPdfAndGelato({
    supabase,
    projectOrigin,
    exportRequestId,
    body,
    subscriptionTierRow: row.subscription_tier,
  });
}

/** Stash payload avant Checkout (ticket print, status created). */
export async function stashPrintPayload(params: {
  supabase: SupabaseClient;
  exportRequestId: string;
  bookId: string;
  crmContactId: string;
  body: GenerateBookPdfPayload;
}): Promise<{ ok: true; alreadyPaid: boolean } | { ok: false; status: number; error: string }> {
  const { supabase, exportRequestId, bookId, crmContactId, body } = params;
  const guestErr = assertPrintGuestPayload(body);
  if (guestErr) {
    return { ok: false, status: 400, error: guestErr };
  }
  if (body.bookId !== bookId) {
    return { ok: false, status: 403, error: 'bookId does not match ticket' };
  }

  const row = await loadPrintExportRow(supabase, exportRequestId);
  if (!row || row.type !== 'print_order') {
    return { ok: false, status: 404, error: 'Export request not found' };
  }
  if (row.crm_contact_id !== crmContactId || row.book_id !== bookId) {
    return { ok: false, status: 403, error: 'Ticket does not match export request' };
  }
  // `created` (normal) ou `failed` (re-stash après file:// / payload pourri).
  if (row.status !== 'created' && row.status !== 'failed') {
    return { ok: false, status: 409, error: 'Export already in progress' };
  }
  // Allow stash while unpaid or already paid (re-stash before fulfill).
  if (row.payment_status === 'refunded') {
    return { ok: false, status: 409, error: 'Order refunded' };
  }

  const tierOk =
    (row.subscription_tier === 'paid' && body.subscriptionTier === 'premium') ||
    (row.subscription_tier === 'free' && body.subscriptionTier === 'free');
  if (!tierOk) {
    return { ok: false, status: 400, error: 'subscriptionTier does not match export request' };
  }

  // Relit `payment_status` **après** l’écriture : le webhook Stripe a pu passer entre le
  // select initial et l’update (il aurait alors répondu PAYLOAD_MISSING).
  // Remet `created` si on était en `failed` pour permettre un nouveau kick Gelato.
  // Re-stash (ex. après file://) : remet le compteur retry à zéro.
  const { data: updated, error } = await supabase
    .from('export_requests')
    .update({
      pdf_payload_json: body,
      pdf_payload_stashed_at: new Date().toISOString(),
      last_error: null,
      status: 'created',
      fulfill_failed_kind: null,
      fulfill_next_retry_at: null,
      fulfill_attempt_count: 0,
      print_ops_alert_sent_at: null,
    })
    .eq('id', exportRequestId)
    .in('status', ['created', 'failed'])
    .select('payment_status')
    .maybeSingle();

  if (error) {
    console.error('[stashPrintPayload]', error.message);
    return { ok: false, status: 500, error: 'Database error' };
  }
  if (!updated) {
    return { ok: false, status: 409, error: 'Export already in progress' };
  }
  const paymentStatus =
    (updated as { payment_status?: string | null } | null)?.payment_status ?? row.payment_status;
  // Paiement terminé pendant l’upload (Checkout ouvert en parallèle) → l’appelant kick fulfill.
  return { ok: true, alreadyPaid: paymentStatus === 'paid' };
}

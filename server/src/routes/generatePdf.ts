import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyExportTicket, type VerifiedExportTicket } from '../auth/exportPdfTicket';
import { buildBookHtml, buildGelatoSpreadHtml, buildGelatoBlockHtml } from '../pdf/htmlBook';
import { renderGelatoPhotobookPdf } from '../pdf/gelatoPhotobookPdf';
import { countRenderedBookPages } from '../pdf/bookPageCount';
import { htmlToDigitalPdfBuffer, htmlToPdfBuffer } from '../pdf/renderPdf';
import { saveBookPdfAndSign, saveBookPdfForExportRequest } from '../pdf/pdfStorage';
import { preparePublicTokensForBook, preparePublicTokensForExportRequest } from '../pdf/preparePublicTokens';
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

const pdfLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PDF requests' },
});

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

function isGuestMemoryList(x: unknown): x is GuestMemoryForPdfPayload[] {
  if (!Array.isArray(x)) return false;
  for (const i of x) {
    if (!i || typeof i !== 'object') return false;
    const o = i as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id.trim()) return false;
    if (o.type !== 'voice' && o.type !== 'video' && o.type !== 'photo' && o.type !== 'text') return false;
  }
  return true;
}

function isGuestChild(
  x: unknown
): x is { name: string; photo_url?: string | null; birthdate?: string | null } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.name === 'string' && o.name.trim().length > 0;
}

function isPayload(body: unknown): body is GenerateBookPdfPayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const guestMemOk = b.guestMemories === undefined || isGuestMemoryList(b.guestMemories);
  const guestChildOk = b.guestChild === undefined || isGuestChild(b.guestChild);
  return (
    typeof b.bookId === 'string' &&
    typeof b.childId === 'string' &&
    typeof b.coverTitle === 'string' &&
    typeof b.coverYearLabel === 'string' &&
    typeof b.chapterTitle === 'string' &&
    typeof b.qrBaseUrl === 'string' &&
    (b.exportMode === 'digital' || b.exportMode === 'print') &&
    (b.subscriptionTier === 'free' || b.subscriptionTier === 'premium') &&
    Array.isArray(b.pages) &&
    guestMemOk &&
    guestChildOk
  );
}

const PLACEHOLDER_CHILD_UUID = '00000000-0000-4000-8000-000000000001';

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
      // Aligné maquette : date de prise (`memories.created_at`), pas l’instant d’export ni `inserted_at`.
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

export function registerGeneratePdfRoute(app: Express, supabase: SupabaseClient, supabaseProjectUrl: string): void {
  const projectOrigin = supabaseProjectUrl.replace(/\/$/, '');
  app.post('/v1/books/generate-pdf', pdfLimiter, async (req: Request, res: Response) => {
    const body = req.body;
    if (!isPayload(body)) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const bearer = getBearerToken(req);
    if (!bearer) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const ticket = await verifyExportTicket(bearer);

    if (ticket?.kind === 'pdf') {
      await handleTicketPdf(res, supabase, projectOrigin, body, ticket);
      return;
    }
    if (ticket?.kind === 'print') {
      await handleTicketPrintPdf(res, supabase, projectOrigin, body, ticket);
      return;
    }

    const { data: userData, error: authErr } = await supabase.auth.getUser(bearer);
    if (authErr || !userData.user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    const userId = userData.user.id;
    const isPrint = body.exportMode === 'print';

    if (!isPrint && body.subscriptionTier === 'free' && !body.digitalExportPaid) {
      res.status(402).json({
        error: 'Export digital : Petitmo+ ou achat à l’acte requis.',
        code: 'EXPORT_PAYMENT_REQUIRED',
      });
      return;
    }

    const { childId } = body;
    const { data: child, error: childErr } = await supabase
      .from('children')
      .select('id, user_id, name, photo_url, birthdate')
      .eq('id', childId)
      .eq('user_id', userId)
      .maybeSingle();

    if (childErr) {
      console.error('[generate-pdf] child', childErr.message);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    if (!child) {
      res.status(403).json({ error: 'Child not found or access denied' });
      return;
    }

    const memoryIds = [
      ...new Set(
        body.pages.flatMap((p): string[] => (typeof p.memoryId === 'string' && p.memoryId ? [p.memoryId] : []))
      ),
    ];

    let memoriesById = new Map<string, MemoryRow>();

    if (memoryIds.length > 0) {
      const { data: memories, error: memErr } = await supabase
        .from('memories')
        .select(
          'id, child_id, user_id, type, content, text_title, media_url, media_path, edited_media_url, duration, thumbnail_url, display_url, print_url, poster_url, poster_print_url, voice_cover_url, voice_cover_path, location, created_at'
        )
        .eq('child_id', childId)
        .in('id', memoryIds);

      if (memErr) {
        console.error('[generate-pdf] memories', memErr.message);
        res.status(500).json({ error: 'Database error' });
        return;
      }

      const rows = (memories ?? []) as MemoryRow[];
      memoriesById = new Map(rows.map(m => [m.id, m]));

      if (body.guestMemories && isGuestMemoryList(body.guestMemories)) {
        for (const g of body.guestMemories) {
          const row = memoriesById.get(g.id);
          if (!row) continue;
          if (g.type === 'voice') {
            const vc = typeof g.voice_cover_url === 'string' ? g.voice_cover_url.trim() : '';
            if (vc && /^https:\/\//i.test(vc)) {
              row.voice_cover_url = vc;
            }
            continue;
          }
          if (g.type === 'video') {
            const poster = typeof g.poster_url === 'string' ? g.poster_url.trim() : '';
            const thumb = typeof g.thumbnail_url === 'string' ? g.thumbnail_url.trim() : '';
            const print = typeof g.poster_print_url === 'string' ? g.poster_print_url.trim() : '';
            if (print && /^https:\/\//i.test(print)) {
              row.poster_print_url = print;
            }
            if (poster && /^https:\/\//i.test(poster)) {
              row.poster_url = poster;
            }
            if (thumb && /^https:\/\//i.test(thumb)) {
              row.thumbnail_url = thumb;
            } else if (poster && /^https:\/\//i.test(poster)) {
              row.thumbnail_url = poster;
            }
            // htmlBook préfère poster_print_url : si seul poster_url est fourni, aligner le print.
            if (
              poster &&
              /^https:\/\//i.test(poster) &&
              !(row.poster_print_url && /^https:\/\//i.test(String(row.poster_print_url).trim()))
            ) {
              row.poster_print_url = poster;
            }
            continue;
          }
          if (g.type === 'photo') {
            const print = typeof g.print_url === 'string' ? g.print_url.trim() : '';
            if (print && /^https:\/\//i.test(print)) {
              row.print_url = print;
              const display = typeof g.display_url === 'string' ? g.display_url.trim() : '';
              row.display_url = display && /^https:\/\//i.test(display) ? display : print;
              row.media_url = print;
              row.edited_media_url = print;
            }
          }
        }
      }

      for (const id of memoryIds) {
        const m = memoriesById.get(id);
        if (!m || m.user_id !== userId) {
          res.status(400).json({ error: 'Unknown or inaccessible memory', memoryId: id });
          return;
        }
      }
    }

    try {
      const qrResult = await preparePublicTokensForBook({
        supabase,
        userId,
        childId,
        bookId: body.bookId,
        pages: body.pages,
        memoriesById,
        subscriptionTier: body.subscriptionTier,
        childBirthdate: (child as ChildRow).birthdate ?? null,
      });

      if (!qrResult.ok) {
        res.status(qrResult.status).json({ error: qrResult.message });
        return;
      }

      const qrWorkerPromise = startBookQrWorkers(supabase, qrResult.tokensByMemoryId);

      const expectedPages = countRenderedBookPages(body.pages, memoriesById);
      if (expectedPages < 1) {
        res.status(400).json({ error: 'Aucune page livre à rendre (pages vides ou souvenirs manquants).' });
        return;
      }

      const memoriesForHtml = await signMemoriesMapForPdfRender(supabase, projectOrigin, memoriesById);
      const childForHtml = await signChildRowForPdfRender(supabase, projectOrigin, child as ChildRow);
      const coverRaw = body.coverPhotoUrl ?? null;
      const coverForHtml =
        typeof coverRaw === 'string' && coverRaw.trim()
          ? ((await signUrlForPdfRender(supabase, projectOrigin, coverRaw)) ?? coverRaw)
          : null;

      const html = buildBookHtml({
        coverTitle: body.coverTitle,
        coverYearLabel: body.coverYearLabel,
        chapterTitle: body.chapterTitle,
        qrBaseUrl: body.qrBaseUrl,
        exportMode: isPrint ? 'print' : 'digital',
        pages: body.pages,
        child: childForHtml,
        coverPhotoUrl: coverForHtml,
        coverPhotoImgPxW: body.coverPhotoImgPxW,
        coverPhotoImgPxH: body.coverPhotoImgPxH,
        memoriesById: memoriesForHtml,
        qrTokensByMemoryId: qrResult.tokensByMemoryId,
      });

      const pdf = isPrint
        ? await htmlToPdfBuffer(html)
        : await htmlToDigitalPdfBuffer(html, expectedPages);
      await qrWorkerPromise;
      const saved = await saveBookPdfAndSign(supabase, {
        userId,
        childId,
        bookId: body.bookId,
        exportMode: isPrint ? 'print' : 'digital',
        subscriptionTier: body.subscriptionTier,
        pdfBytes: pdf,
      });
      const out: GenerateBookPdfResponse = {
        pdfUrlSigned: saved.pdfUrlSigned,
        pdfStoragePath: saved.pdfStoragePath,
        qrTokensByMemoryId: qrTokensRecord(qrResult.tokensByMemoryId),
      };
      res.status(200).json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[generate-pdf] session path', msg, e instanceof Error ? e.stack : '');
      res.status(500).json({ error: 'PDF generation or storage failed', detail: msg });
    }
  });
}

type ExportRow = {
  id: string;
  crm_contact_id: string;
  type: string;
  export_mode: string;
  status: string;
  book_id: string;
  subscription_tier: string;
};

async function handleTicketPdf(
  res: Response,
  supabase: SupabaseClient,
  projectOrigin: string,
  body: GenerateBookPdfPayload,
  ticket: VerifiedExportTicket & { kind: 'pdf' }
): Promise<void> {
  if (!body.guestChild || !isGuestChild(body.guestChild)) {
    res.status(400).json({ error: 'guestChild required for export ticket' });
    return;
  }
  if (!body.guestMemories || !isGuestMemoryList(body.guestMemories)) {
    res.status(400).json({ error: 'guestMemories required for export ticket' });
    return;
  }

  if (body.bookId !== ticket.book_id) {
    res.status(403).json({ error: 'bookId does not match ticket' });
    return;
  }

  const { data: erow, error: exErr } = await supabase
    .from('export_requests')
    .select('id, crm_contact_id, type, export_mode, status, book_id, subscription_tier')
    .eq('id', ticket.export_request_id)
    .maybeSingle();

  if (exErr) {
    console.error('[generate-pdf] export_requests', exErr.message);
    res.status(500).json({ error: 'Database error' });
    return;
  }

  const row = erow as ExportRow | null;
  if (!row || row.type !== 'pdf_export') {
    res.status(404).json({ error: 'Export request not found' });
    return;
  }

  if (row.crm_contact_id !== ticket.crm_contact_id || row.book_id !== ticket.book_id) {
    res.status(403).json({ error: 'Ticket does not match export request' });
    return;
  }

  if (row.export_mode !== body.exportMode) {
    res.status(400).json({ error: 'exportMode does not match export request' });
    return;
  }

  const tierOk =
    (row.subscription_tier === 'paid' && body.subscriptionTier === 'premium') ||
    (row.subscription_tier === 'free' && body.subscriptionTier === 'free');
  if (!tierOk) {
    res.status(400).json({ error: 'subscriptionTier does not match export request' });
    return;
  }

  if (row.subscription_tier === 'free' && !body.digitalExportPaid) {
    res.status(402).json({
      error: 'Export digital : Petitmo+ ou achat à l’acte requis.',
      code: 'EXPORT_PAYMENT_REQUIRED',
    });
    return;
  }

  if (row.status !== 'created') {
    res.status(409).json({ error: 'Export request already used or in progress', code: 'EXPORT_STATE' });
    return;
  }

  const memoryIds = [
    ...new Set(
      body.pages.flatMap((p): string[] => (typeof p.memoryId === 'string' && p.memoryId ? [p.memoryId] : []))
    ),
  ];

  const memoriesById = mapGuestMemories(body.guestMemories, ticket.export_request_id);
  for (const id of memoryIds) {
    if (!memoriesById.has(id)) {
      res.status(400).json({ error: 'guestMemories missing entry', memoryId: id });
      return;
    }
  }

  const expectedPagesTicket = countRenderedBookPages(body.pages, memoriesById);
  if (expectedPagesTicket < 1) {
    res.status(400).json({ error: 'Aucune page livre à rendre (pages vides ou souvenirs manquants).' });
    return;
  }

  const { data: lockRows, error: lockErr } = await supabase
    .from('export_requests')
    .update({ status: 'rendering' })
    .eq('id', ticket.export_request_id)
    .eq('status', 'created')
    .select('id');

  if (lockErr) {
    console.error('[generate-pdf] export lock', lockErr.message);
    res.status(500).json({ error: 'Database error' });
    return;
  }
  if (!lockRows?.length) {
    res.status(409).json({ error: 'Export request already used or in progress', code: 'EXPORT_STATE' });
    return;
  }

  const qrTier = row.subscription_tier === 'paid' ? 'premium' : 'free';

  try {
    const qrResult = await preparePublicTokensForExportRequest({
      supabase,
      exportRequestId: ticket.export_request_id,
      bookId: body.bookId,
      pages: body.pages,
      memoriesById,
      subscriptionTier: qrTier,
      childBirthdate: body.guestChild.birthdate ?? null,
    });

    if (!qrResult.ok) {
      await supabase
        .from('export_requests')
        .update({ status: 'failed', last_error: qrResult.message.slice(0, 2000) })
        .eq('id', ticket.export_request_id);
      res.status(qrResult.status).json({ error: qrResult.message });
      return;
    }

    const qrWorkerPromise = startBookQrWorkers(supabase, qrResult.tokensByMemoryId);

    const child: ChildRow = {
      id: body.childId,
      user_id: ticket.export_request_id,
      name: body.guestChild.name,
      photo_url: body.guestChild.photo_url ?? null,
      birthdate: body.guestChild.birthdate ?? null,
    };

    const memoriesForHtml = await signMemoriesMapForPdfRender(supabase, projectOrigin, memoriesById);
    const childForHtml = await signChildRowForPdfRender(supabase, projectOrigin, child);
    const coverRawTicket = body.coverPhotoUrl ?? null;
    const coverForHtmlTicket =
      typeof coverRawTicket === 'string' && coverRawTicket.trim()
        ? ((await signUrlForPdfRender(supabase, projectOrigin, coverRawTicket)) ?? coverRawTicket)
        : null;

    const html = buildBookHtml({
      coverTitle: body.coverTitle,
      coverYearLabel: body.coverYearLabel,
      chapterTitle: body.chapterTitle,
      qrBaseUrl: body.qrBaseUrl,
      exportMode: body.exportMode,
      pages: body.pages,
      child: childForHtml,
      coverPhotoUrl: coverForHtmlTicket,
      coverPhotoImgPxW: body.coverPhotoImgPxW,
      coverPhotoImgPxH: body.coverPhotoImgPxH,
      memoriesById: memoriesForHtml,
      qrTokensByMemoryId: qrResult.tokensByMemoryId,
    });

    const pdf =
      body.exportMode === 'digital'
        ? await htmlToDigitalPdfBuffer(html, expectedPagesTicket)
        : await htmlToPdfBuffer(html);
    await qrWorkerPromise;
    const saved = await saveBookPdfForExportRequest(supabase, {
      exportRequestId: ticket.export_request_id,
      bookId: body.bookId,
      exportMode: body.exportMode,
      subscriptionPaid: row.subscription_tier === 'paid',
      pdfBytes: pdf,
    });

    await supabase
      .from('export_requests')
      .update({
        status: 'done',
        pdf_storage_path: saved.pdfStoragePath,
        last_error: null,
      })
      .eq('id', ticket.export_request_id);

    const out: GenerateBookPdfResponse = {
      pdfUrlSigned: saved.pdfUrlSigned,
      pdfStoragePath: saved.pdfStoragePath,
      qrTokensByMemoryId: qrTokensRecord(qrResult.tokensByMemoryId),
    };
    res.status(200).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[generate-pdf] ticket path', msg, e instanceof Error ? e.stack : '');
    await supabase
      .from('export_requests')
      .update({ status: 'failed', last_error: msg.slice(0, 2000) })
      .eq('id', ticket.export_request_id);
    res.status(500).json({ error: 'PDF generation or storage failed', detail: msg });
  }
}

/** Ticket `export_print` : PDF livre mode impression (fond perdu) pour commande `print_order`. */
async function handleTicketPrintPdf(
  res: Response,
  supabase: SupabaseClient,
  projectOrigin: string,
  body: GenerateBookPdfPayload,
  ticket: VerifiedExportTicket & { kind: 'print' }
): Promise<void> {
  if (!body.guestChild || !isGuestChild(body.guestChild)) {
    res.status(400).json({ error: 'guestChild required for export ticket' });
    return;
  }
  if (!body.guestMemories || !isGuestMemoryList(body.guestMemories)) {
    res.status(400).json({ error: 'guestMemories required for export ticket' });
    return;
  }

  if (body.bookId !== ticket.book_id) {
    res.status(403).json({ error: 'bookId does not match ticket' });
    return;
  }

  if (body.exportMode !== 'print') {
    res.status(400).json({ error: 'exportMode must be print for print_order ticket' });
    return;
  }

  const { data: erow, error: exErr } = await supabase
    .from('export_requests')
    .select('id, crm_contact_id, type, export_mode, status, book_id, subscription_tier')
    .eq('id', ticket.export_request_id)
    .maybeSingle();

  if (exErr) {
    console.error('[generate-pdf] export_requests', exErr.message);
    res.status(500).json({ error: 'Database error' });
    return;
  }

  const row = erow as ExportRow | null;
  if (!row || row.type !== 'print_order') {
    res.status(404).json({ error: 'Export request not found' });
    return;
  }

  if (row.crm_contact_id !== ticket.crm_contact_id || row.book_id !== ticket.book_id) {
    res.status(403).json({ error: 'Ticket does not match export request' });
    return;
  }

  if (row.export_mode !== 'print') {
    res.status(400).json({ error: 'export_mode does not match export request' });
    return;
  }

  const tierOk =
    (row.subscription_tier === 'paid' && body.subscriptionTier === 'premium') ||
    (row.subscription_tier === 'free' && body.subscriptionTier === 'free');
  if (!tierOk) {
    res.status(400).json({ error: 'subscriptionTier does not match export request' });
    return;
  }

  if (row.status !== 'created') {
    res.status(409).json({ error: 'Export request already used or in progress', code: 'EXPORT_STATE' });
    return;
  }

  const memoryIds = [
    ...new Set(
      body.pages.flatMap((p): string[] => (typeof p.memoryId === 'string' && p.memoryId ? [p.memoryId] : []))
    ),
  ];

  const memoriesById = mapGuestMemories(body.guestMemories, ticket.export_request_id);
  for (const id of memoryIds) {
    if (!memoriesById.has(id)) {
      res.status(400).json({ error: 'guestMemories missing entry', memoryId: id });
      return;
    }
  }

  if (countRenderedBookPages(body.pages, memoriesById) < 1) {
    res.status(400).json({ error: 'Aucune page livre à rendre (pages vides ou souvenirs manquants).' });
    return;
  }

  const { data: lockRows, error: lockErr } = await supabase
    .from('export_requests')
    .update({ status: 'rendering' })
    .eq('id', ticket.export_request_id)
    .eq('status', 'created')
    .select('id');

  if (lockErr) {
    console.error('[generate-pdf] export lock (print)', lockErr.message);
    res.status(500).json({ error: 'Database error' });
    return;
  }
  if (!lockRows?.length) {
    res.status(409).json({ error: 'Export request already used or in progress', code: 'EXPORT_STATE' });
    return;
  }

  const qrTier = row.subscription_tier === 'paid' ? 'premium' : 'free';

  try {
    const qrResult = await preparePublicTokensForExportRequest({
      supabase,
      exportRequestId: ticket.export_request_id,
      bookId: body.bookId,
      pages: body.pages,
      memoriesById,
      subscriptionTier: qrTier,
      childBirthdate: body.guestChild.birthdate ?? null,
    });

    if (!qrResult.ok) {
      await supabase
        .from('export_requests')
        .update({ status: 'failed', last_error: qrResult.message.slice(0, 2000) })
        .eq('id', ticket.export_request_id);
      res.status(qrResult.status).json({ error: qrResult.message });
      return;
    }

    const qrWorkerPromise = startBookQrWorkers(supabase, qrResult.tokensByMemoryId);

    const child: ChildRow = {
      id: body.childId,
      user_id: ticket.export_request_id,
      name: body.guestChild.name,
      photo_url: body.guestChild.photo_url ?? null,
      birthdate: body.guestChild.birthdate ?? null,
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
      await supabase
        .from('export_requests')
        .update({ status: 'failed', last_error: gelatoLayoutError.slice(0, 2000) })
        .eq('id', ticket.export_request_id);
      res.status(400).json({ error: gelatoLayoutError });
      return;
    }

    const bookHtmlInput = {
      coverTitle: body.coverTitle,
      coverYearLabel: body.coverYearLabel,
      chapterTitle: body.chapterTitle,
      qrBaseUrl: body.qrBaseUrl,
      exportMode: 'print' as const,
      pages: body.pages,
      child: childForHtmlPrint,
      coverPhotoUrl: coverForHtmlPrint,
      coverPhotoImgPxW: body.coverPhotoImgPxW,
      coverPhotoImgPxH: body.coverPhotoImgPxH,
      memoriesById: memoriesForHtmlPrint,
      qrTokensByMemoryId: qrResult.tokensByMemoryId,
    };

    let pdf: Buffer;
    if (gelatoConfig) {
      const catalogPageCount = gelatoCatalogPageCount(body.pages);
      const coverLayout = await fetchGelatoCoverLayout(gelatoConfig, catalogPageCount);
      assertGelatoCoverLayoutMatchesPetitmo(coverLayout);
      console.log(
        '[generate-pdf] gelato product',
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
      exportRequestId: ticket.export_request_id,
      bookId: body.bookId,
      exportMode: 'print',
      subscriptionPaid: true,
      pdfBytes: pdf,
    });

    await supabase
      .from('export_requests')
      .update({
        status: 'done',
        pdf_storage_path: saved.pdfStoragePath,
        last_error: null,
      })
      .eq('id', ticket.export_request_id);

    // Attendre Gelato avant le 200 : sinon l’app affiche succès alors que l’order draft n’est jamais parti.
    const gelatoResult = await submitGelatoPrintOrder(supabase, {
      exportRequestId: ticket.export_request_id,
      bookId: body.bookId,
      pdfStoragePath: saved.uploadedStoragePath,
      pdfPageCount,
      catalogPageCount: gelatoCatalogPageCount(body.pages),
    });
    const gelatoOrderType = gelatoConfig?.orderType;
    let gelatoOut: GenerateBookPdfResponse['gelato'];
    if (!gelatoResult.ok) {
      console.error('[generate-pdf] gelato', ticket.export_request_id, gelatoResult.message);
      gelatoOut = { ok: false, message: gelatoResult.message };
    } else if (gelatoResult.skipped) {
      console.warn('[generate-pdf] gelato skipped', ticket.export_request_id, gelatoResult.reason);
      gelatoOut = {
        ok: false,
        skipped: true,
        message: gelatoResult.reason,
        ...(gelatoOrderType ? { orderType: gelatoOrderType } : {}),
      };
    } else {
      console.log(
        '[generate-pdf] gelato ok',
        ticket.export_request_id,
        gelatoResult.gelatoOrderId,
        gelatoOrderType === 'draft' ? '(draft)' : '',
      );
      gelatoOut = {
        ok: true,
        orderId: gelatoResult.gelatoOrderId,
        ...(gelatoOrderType ? { orderType: gelatoOrderType } : {}),
      };
    }

    const out: GenerateBookPdfResponse = {
      pdfUrlSigned: saved.pdfUrlSigned,
      pdfStoragePath: saved.pdfStoragePath,
      qrTokensByMemoryId: qrTokensRecord(qrResult.tokensByMemoryId),
      gelato: gelatoOut,
    };
    res.status(200).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[generate-pdf] ticket print path', msg, e instanceof Error ? e.stack : '');
    await supabase
      .from('export_requests')
      .update({ status: 'failed', last_error: msg.slice(0, 2000) })
      .eq('id', ticket.export_request_id);
    res.status(500).json({ error: 'PDF generation or storage failed', detail: msg });
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatGelatoApiError } from './apiError';
import { gelatoOrderApiUrl, loadGelatoConfig, type GelatoConfig } from '../gelato/config';
import { gelatoShippingAddress, parsePetitmoShippingAddress } from '../gelato/shippingAddress';
import { createSignedBooksPdfUrl } from '../pdf/pdfStorage';
import { GELATO_MIN_INNER_PAGES } from './photobookLayout';

export type SubmitGelatoPrintOrderParams = {
  exportRequestId: string;
  bookId: string;
  pdfStoragePath: string;
  /** Nombre de pages du PDF print réellement généré (spread + gardes + intérieures). */
  pdfPageCount: number;
  /** Pages intérieures catalogue Gelato (≠ billable_pages Petitmo). */
  catalogPageCount: number;
};

export type SubmitGelatoPrintOrderResult =
  | { ok: true; gelatoOrderId: string; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; message: string };

async function signedPdfUrlForGelato(
  supabase: SupabaseClient,
  storagePath: string,
  config: GelatoConfig,
): Promise<string> {
  return createSignedBooksPdfUrl(supabase, storagePath, config.pdfSignedUrlSeconds);
}

export async function submitGelatoPrintOrder(
  supabase: SupabaseClient,
  params: SubmitGelatoPrintOrderParams,
): Promise<SubmitGelatoPrintOrderResult> {
  const config = loadGelatoConfig();
  if (!config) {
    return { ok: true, skipped: true, reason: 'GELATO_NOT_CONFIGURED' };
  }

  const { data: row, error } = await supabase
    .from('export_requests')
    .select(
      'id, type, status, book_id, crm_contact_id, shipping_name, shipping_address_json, printer_order_id',
    )
    .eq('id', params.exportRequestId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!row || row.type !== 'print_order') {
    return { ok: false, message: 'export_request not found or not print_order' };
  }
  if (typeof row.printer_order_id === 'string' && row.printer_order_id.trim()) {
    return { ok: true, skipped: true, reason: 'ALREADY_SUBMITTED' };
  }

  const shipName = typeof row.shipping_name === 'string' ? row.shipping_name.trim() : '';
  const addr = parsePetitmoShippingAddress(row.shipping_address_json);
  if (!shipName || !addr) {
    return { ok: false, message: 'shipping address incomplete on export_request' };
  }

  const { data: contact, error: cErr } = await supabase
    .from('crm_contacts')
    .select('email')
    .eq('id', row.crm_contact_id as string)
    .maybeSingle();

  if (cErr) {
    return { ok: false, message: cErr.message };
  }
  const email = typeof contact?.email === 'string' ? contact.email.trim() : '';
  if (!email) {
    return { ok: false, message: 'crm contact email missing' };
  }

  let pdfUrl: string;
  try {
    pdfUrl = await signedPdfUrlForGelato(supabase, params.pdfStoragePath, config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `pdf signed url: ${msg}` };
  }

  const pdfPageCount =
    typeof params.pdfPageCount === 'number' && params.pdfPageCount > 0
      ? Math.round(params.pdfPageCount)
      : 0;

  const gelatoPageCount =
    typeof params.catalogPageCount === 'number' && params.catalogPageCount > 0
      ? Math.round(params.catalogPageCount)
      : 0;

  if (gelatoPageCount < GELATO_MIN_INNER_PAGES) {
    const msg = `gelato skip: pageCount catalogue ${gelatoPageCount}, minimum ${GELATO_MIN_INNER_PAGES} pages intérieures`;
    await supabase
      .from('export_requests')
      .update({ last_error: msg.slice(0, 2000) })
      .eq('id', params.exportRequestId);
    return { ok: false, message: msg };
  }

  const expectedPdfPages = gelatoPageCount + 3;
  if (pdfPageCount < expectedPdfPages) {
    const msg = `gelato skip: PDF ${pdfPageCount} page(s), attendu ≥ ${expectedPdfPages} (format spread + gardes + ${gelatoPageCount} intérieures)`;
    await supabase
      .from('export_requests')
      .update({ last_error: msg.slice(0, 2000) })
      .eq('id', params.exportRequestId);
    return { ok: false, message: msg };
  }

  const item: Record<string, unknown> = {
    itemReferenceId: params.bookId,
    productUid: config.productUid,
    files: [{ type: 'default', url: pdfUrl }],
    quantity: 1,
    pageCount: gelatoPageCount,
  };

  const body = {
    orderType: config.orderType,
    orderReferenceId: params.exportRequestId,
    customerReferenceId: String(row.crm_contact_id),
    currency: config.currency,
    items: [item],
    shipmentMethodUid: config.shipmentMethodUid,
    shippingAddress: gelatoShippingAddress({
      shippingName: shipName,
      address: addr,
      email,
      phone: config.defaultPhone,
    }),
    metadata: [
      { key: 'petitmo_export_request_id', value: params.exportRequestId },
      { key: 'petitmo_book_id', value: params.bookId },
    ],
  };

  const res = await fetch(gelatoOrderApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = { raw: rawText.slice(0, 500) };
  }

  if (!res.ok) {
    const detail = formatGelatoApiError(res.status, json, rawText);
    console.error('[gelato] order rejected', params.exportRequestId, detail, rawText.slice(0, 1500));
    await supabase
      .from('export_requests')
      .update({
        last_error: detail,
        printer_order_json: { gelatoError: json, gelatoErrorRaw: rawText.slice(0, 4000) },
      })
      .eq('id', params.exportRequestId);
    return { ok: false, message: detail };
  }

  const gelatoOrderId = typeof json.id === 'string' ? json.id : '';
  if (!gelatoOrderId) {
    return { ok: false, message: 'Gelato response missing order id' };
  }

  const { error: upErr } = await supabase
    .from('export_requests')
    .update({
      status: 'sent_to_printer',
      printer_name: 'gelato',
      printer_order_id: gelatoOrderId,
      printer_order_json: json,
      last_error: null,
    })
    .eq('id', params.exportRequestId);

  if (upErr) {
    return { ok: false, message: upErr.message };
  }

  console.log(
    '[gelato] order placed',
    params.exportRequestId,
    gelatoOrderId,
    config.orderType === 'draft' ? '(draft — pas en production)' : '',
  );
  return { ok: true, gelatoOrderId, skipped: false };
}

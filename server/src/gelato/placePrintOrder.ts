import type { SupabaseClient } from '@supabase/supabase-js';
import { gelatoOrderApiUrl, loadGelatoConfig, type GelatoConfig } from '../gelato/config';
import { gelatoShippingAddress, parsePetitmoShippingAddress } from '../gelato/shippingAddress';
import { createSignedBooksPdfUrl } from '../pdf/pdfStorage';

export type SubmitGelatoPrintOrderParams = {
  exportRequestId: string;
  bookId: string;
  pdfStoragePath: string;
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

  const body = {
    orderType: 'order',
    orderReferenceId: params.exportRequestId,
    customerReferenceId: String(row.crm_contact_id),
    currency: config.currency,
    items: [
      {
        itemReferenceId: params.bookId,
        productUid: config.productUid,
        files: [{ type: 'default', url: pdfUrl }],
        quantity: 1,
      },
    ],
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
    const detail =
      typeof json.message === 'string'
        ? json.message
        : typeof json.error === 'string'
          ? json.error
          : rawText.slice(0, 300);
    await supabase
      .from('export_requests')
      .update({
        last_error: `gelato ${res.status}: ${detail}`.slice(0, 2000),
      })
      .eq('id', params.exportRequestId);
    return { ok: false, message: `Gelato HTTP ${res.status}: ${detail}` };
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

  console.log('[gelato] order placed', params.exportRequestId, gelatoOrderId);
  return { ok: true, gelatoOrderId, skipped: false };
}

import { postInitExport } from '@/services/initExportApi';
import {
  PRINT_V1_PAID_DISCOUNT_PERCENT,
  type DiscountPercent,
} from '@/lib/printedBookQuote';

export type PrintShippingAddress = {
  line1: string;
  line2?: string;
  city: string;
  zip: string;
  country: string;
};

export type InitPrintOrderParams = {
  bookId: string;
  childLocalId: string | null;
  subscriptionTierDb: 'free' | 'paid';
  /** Pages livre audio + vidéo (= QR facturables). */
  audioVideoPageCount: number;
  email: string;
  gdprConsentAtIso: string;
  fullName?: string | null;
  marketingOptIn?: boolean;
  shippingName: string;
  shippingAddress: PrintShippingAddress;
  /** Compteur catalogue Gelato (pair, ≥ 30). */
  gelatoPages: number;
  discountPercent: DiscountPercent;
  printerName?: string | null;
};

export type InitPrintOrderResult = {
  exportRequestId: string;
  crmContactId: string;
  /** JWT Bearer pour `POST /generate-pdf` (Railway), comme `pdfTicket` pour l’export PDF. */
  exportTicket: string;
  priceCents: number;
  gelatoPages: number;
  qrCount: number;
  discountPercent: DiscountPercent;
  expiresInSeconds: number;
};

export async function initPrintOrderExport(params: InitPrintOrderParams): Promise<InitPrintOrderResult> {
  const body: Record<string, unknown> = {
    type: 'print_order',
    export_mode: 'print',
    book_id: params.bookId,
    child_local_id: params.childLocalId,
    subscription_tier: params.subscriptionTierDb,
    audio_video_page_count: params.audioVideoPageCount,
    email: params.email,
    gdpr_consent_at: params.gdprConsentAtIso,
    full_name: params.fullName ?? null,
    marketing_opt_in: params.marketingOptIn === true,
    shipping_name: params.shippingName,
    shipping_address_json: {
      line1: params.shippingAddress.line1,
      ...(params.shippingAddress.line2?.trim()
        ? { line2: params.shippingAddress.line2.trim() }
        : {}),
      city: params.shippingAddress.city,
      zip: params.shippingAddress.zip,
      country: params.shippingAddress.country,
    },
    gelato_pages: params.gelatoPages,
    // Compat Edge legacy : même valeur que gelato_pages (V1).
    billable_pages: params.gelatoPages,
    discount_percent: params.discountPercent,
    ...(params.printerName?.trim() ? { printer_name: params.printerName.trim() } : {}),
  };

  const { status, json } = await postInitExport(body);

  if (status === 429) {
    throw new Error(typeof json.error === 'string' ? json.error : 'Trop de demandes. Réessaie plus tard.');
  }

  if (status !== 200) {
    const msg = typeof json.error === 'string' ? json.error : `init-export (${status})`;
    throw new Error(msg);
  }

  const exportRequestId = typeof json.exportRequestId === 'string' ? json.exportRequestId : '';
  const crmContactId = typeof json.crmContactId === 'string' ? json.crmContactId : '';
  const exportTicket = typeof json.exportTicket === 'string' ? json.exportTicket : '';
  const priceCents = typeof json.priceCents === 'number' ? json.priceCents : NaN;
  const gelatoPages =
    typeof json.gelatoPages === 'number'
      ? json.gelatoPages
      : typeof json.billablePages === 'number'
        ? json.billablePages
        : NaN;
  const qrCount =
    typeof json.qrCount === 'number' ? json.qrCount : params.audioVideoPageCount;
  const disc = json.discountPercent;
  const discountPercent: DiscountPercent =
    disc === PRINT_V1_PAID_DISCOUNT_PERCENT ? PRINT_V1_PAID_DISCOUNT_PERCENT : 0;
  const expiresInSeconds = typeof json.expiresInSeconds === 'number' ? json.expiresInSeconds : 0;
  if (
    !exportRequestId ||
    !exportTicket ||
    json.flow !== 'print_order' ||
    !Number.isFinite(priceCents) ||
    !Number.isFinite(gelatoPages)
  ) {
    throw new Error('Réponse init-export (impression) invalide.');
  }

  return {
    exportRequestId,
    crmContactId,
    exportTicket,
    priceCents,
    gelatoPages,
    qrCount,
    discountPercent,
    expiresInSeconds,
  };
}

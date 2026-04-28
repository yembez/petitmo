import { postInitExport } from '@/services/initExportApi';

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
  audioVideoPageCount: number;
  email: string;
  gdprConsentAtIso: string;
  fullName?: string | null;
  marketingOptIn?: boolean;
  shippingName: string;
  shippingAddress: PrintShippingAddress;
  /** Nombre réel de pages mémoire dans le livre (1–200) ; le tarif est calculé côté Edge. */
  billablePages: number;
  discountPercent: 0 | 20;
  printerName?: string | null;
};

export type InitPrintOrderResult = {
  exportRequestId: string;
  crmContactId: string;
  /** JWT Bearer pour `POST /generate-pdf` (Railway), comme `pdfTicket` pour l’export PDF. */
  exportTicket: string;
  priceCents: number;
  billablePages: number;
  discountPercent: 0 | 20;
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
    billable_pages: params.billablePages,
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
  const billablePages = typeof json.billablePages === 'number' ? json.billablePages : NaN;
  const disc = json.discountPercent;
  const discountPercent: 0 | 20 = disc === 20 ? 20 : 0;
  const expiresInSeconds = typeof json.expiresInSeconds === 'number' ? json.expiresInSeconds : 0;
  if (
    !exportRequestId ||
    !exportTicket ||
    json.flow !== 'print_order' ||
    !Number.isFinite(priceCents) ||
    !Number.isFinite(billablePages)
  ) {
    throw new Error('Réponse init-export (impression) invalide.');
  }

  return {
    exportRequestId,
    crmContactId,
    exportTicket,
    priceCents,
    billablePages,
    discountPercent,
    expiresInSeconds,
  };
}

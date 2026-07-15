export type GelatoConfig = {
  apiKey: string;
  productUid: string;
  shipmentMethodUid: string;
  currency: string;
  defaultPhone: string;
  pdfSignedUrlSeconds: number;
  webhookSecret: string | null;
  /** `draft` = visible dashboard Gelato, pas d’impression tant que non converti. */
  orderType: 'order' | 'draft';
  /** Minimum pages intérieures catalogue Gelato (défaut 30). Le PDF total = intérieures + 3. */
  minPageCount: number;
};

const GELATO_ORDER_API = 'https://order.gelatoapis.com/v4/orders';

export function gelatoOrderApiUrl(): string {
  return GELATO_ORDER_API;
}

function parseGelatoOrderType(): 'order' | 'draft' {
  const raw = process.env.GELATO_ORDER_TYPE?.trim().toLowerCase();
  return raw === 'draft' ? 'draft' : 'order';
}

function parseGelatoMinPageCount(): number {
  const raw = process.env.GELATO_MIN_PAGE_COUNT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n >= 1 ? n : 30;
}

/** Gelato optionnel : sans clé / productUid, le PDF print est généré mais pas envoyé à l’imprimeur. */
export function loadGelatoConfig(): GelatoConfig | null {
  const apiKey = process.env.GELATO_API_KEY?.trim();
  const productUid = process.env.GELATO_PRODUCT_UID?.trim();
  if (!apiKey || !productUid) return null;

  const pdfTtlRaw = process.env.GELATO_PDF_SIGNED_URL_SECONDS?.trim();
  const pdfSignedUrlSeconds = pdfTtlRaw ? Number.parseInt(pdfTtlRaw, 10) : 7 * 24 * 60 * 60;
  const pdfTtl =
    Number.isFinite(pdfSignedUrlSeconds) && pdfSignedUrlSeconds >= 3600
      ? pdfSignedUrlSeconds
      : 7 * 24 * 60 * 60;

  const orderType = parseGelatoOrderType();
  const minPageCount = parseGelatoMinPageCount();

  return {
    apiKey,
    productUid,
    shipmentMethodUid: process.env.GELATO_SHIPMENT_METHOD_UID?.trim() || 'standard',
    currency: (process.env.GELATO_CURRENCY?.trim() || 'EUR').toUpperCase(),
    defaultPhone: process.env.GELATO_DEFAULT_PHONE?.trim() || '0000000000',
    pdfSignedUrlSeconds: pdfTtl,
    webhookSecret: process.env.GELATO_WEBHOOK_SECRET?.trim() || null,
    orderType,
    minPageCount,
  };
}

export type PrintOrderStatus =
  | 'paid'
  | 'printing'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'failed'
  | 'refunded'
  | 'returned';

export type PrintOrderSummary = {
  id: string;
  createdAt: string;
  priceCents: number;
  status: PrintOrderStatus;
  shippingName: string;
  bookId: string;
  bookTitle: string;
  childId: string;
};

const STATUSES: PrintOrderStatus[] = [
  'paid',
  'printing',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'refunded',
  'returned',
];

function asStatus(raw: unknown): PrintOrderStatus {
  if (typeof raw === 'string' && (STATUSES as string[]).includes(raw)) {
    return raw as PrintOrderStatus;
  }
  return 'paid';
}

/** Titres génériques / repli — ne pas les afficher à la place du vrai nom du livre. */
export function isGenericPrintBookTitle(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return /^(livre(\s+\d+)?|nouveau livre|book(\s+\d+)?)$/i.test(t);
}

export function parsePrintOrderList(raw: unknown): PrintOrderSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: PrintOrderSummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
    const priceCents = typeof o.priceCents === 'number' && Number.isFinite(o.priceCents) ? o.priceCents : 0;
    if (!id) continue;
    out.push({
      id,
      createdAt,
      priceCents,
      status: asStatus(o.status),
      shippingName: typeof o.shippingName === 'string' ? o.shippingName : '',
      bookId: typeof o.bookId === 'string' ? o.bookId.trim() : '',
      bookTitle: typeof o.bookTitle === 'string' ? o.bookTitle.trim() : '',
      childId: typeof o.childId === 'string' ? o.childId.trim() : '',
    });
  }
  return out;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { rethrowIfDeviceStorageFull } from '@/utils/deviceStorageFull';

const KEY = 'petitmo_pending_print_payment_v1';

export type PendingPrintPayment = {
  exportRequestId: string;
  exportTicket: string;
  email: string;
  priceCents: number;
  bookId: string;
  childId: string;
  createdAt: string;
  /**
   * Empreinte contenu livre au moment du ticket (pages Gelato + QR + remise).
   * Si la revue livre change le contenu, on refuse de réutiliser ce pending unpaid
   * pour ne pas ouvrir Stripe avec un ancien montant.
   */
  contentKey?: string;
  /**
   * Payload (médias + pages) déjà stashé côté serveur pour ce ticket.
   * Le Checkout s’ouvre pendant l’upload : si l’app est tuée entre paiement et fin du stash,
   * la reprise doit terminer l’upload avant de kicker PDF + Gelato.
   */
  stashed?: boolean;
};

function parse(raw: string): PendingPrintPayment | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const exportRequestId = typeof o.exportRequestId === 'string' ? o.exportRequestId.trim() : '';
    const exportTicket = typeof o.exportTicket === 'string' ? o.exportTicket.trim() : '';
    const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
    const priceCents = typeof o.priceCents === 'number' && Number.isFinite(o.priceCents) ? o.priceCents : NaN;
    const bookId = typeof o.bookId === 'string' ? o.bookId.trim() : '';
    const childId = typeof o.childId === 'string' ? o.childId.trim() : '';
    const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
    if (!exportRequestId || !exportTicket || !email || !bookId || !Number.isFinite(priceCents)) {
      return null;
    }
    const contentKey = typeof o.contentKey === 'string' ? o.contentKey.trim() : '';
    return {
      exportRequestId,
      exportTicket,
      email,
      priceCents,
      bookId,
      childId,
      createdAt,
      ...(contentKey ? { contentKey } : {}),
      stashed: o.stashed === true,
    };
  } catch {
    return null;
  }
}

export async function setPendingPrintPayment(rec: PendingPrintPayment): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(rec));
  } catch (e) {
    rethrowIfDeviceStorageFull(e);
    throw e;
  }
}

/** Marque le stash serveur terminé pour le ticket courant (no-op si le ticket a changé). */
export async function markPendingPrintPaymentStashed(exportTicket: string): Promise<void> {
  const cur = await getPendingPrintPayment();
  if (!cur || cur.exportTicket !== exportTicket.trim()) return;
  await setPendingPrintPayment({ ...cur, stashed: true });
}

/** Force un re-stash (payload serveur pourri / file://) pour le ticket courant. */
export async function clearPendingPrintPaymentStashed(exportTicket: string): Promise<void> {
  const cur = await getPendingPrintPayment();
  if (!cur || cur.exportTicket !== exportTicket.trim()) return;
  await setPendingPrintPayment({ ...cur, stashed: false });
}

export async function getPendingPrintPayment(): Promise<PendingPrintPayment | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw?.trim()) return null;
    return parse(raw);
  } catch {
    return null;
  }
}

export async function clearPendingPrintPayment(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

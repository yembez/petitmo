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
    return { exportRequestId, exportTicket, email, priceCents, bookId, childId, createdAt };
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

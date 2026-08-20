import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GenerateBookPdfServerInput } from '@/services/bookPdfServer';
import { rethrowIfDeviceStorageFull } from '@/utils/deviceStorageFull';

const KEY = 'petitmo_pending_book_order_pdf_v1';

export async function setPendingBookOrderPdfPayload(input: GenerateBookPdfServerInput): Promise<void> {
  const json = JSON.stringify(input);
  try {
    await AsyncStorage.setItem(KEY, json);
  } catch (e) {
    rethrowIfDeviceStorageFull(e);
    throw e;
  }
}

export async function getPendingBookOrderPdfPayload(): Promise<GenerateBookPdfServerInput | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as GenerateBookPdfServerInput;
    if (!parsed || typeof parsed.bookId !== 'string' || !Array.isArray(parsed.pages)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingBookOrderPdfPayload(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const RESULT_URI_KEY = 'petitmo_book_order_result_pdf_uri_v1';

/** Après génération PDF (commande) : URI locale pour l’écran de confirmation (partage). */
export async function setBookOrderResultPdfUri(uri: string | null): Promise<void> {
  try {
    if (uri?.trim()) {
      await AsyncStorage.setItem(RESULT_URI_KEY, uri);
    } else {
      await AsyncStorage.removeItem(RESULT_URI_KEY);
    }
  } catch {
    /* ignore */
  }
}

export async function getBookOrderResultPdfUri(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(RESULT_URI_KEY);
  } catch {
    return null;
  }
}

export async function clearBookOrderResultPdfUri(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RESULT_URI_KEY);
  } catch {
    /* ignore */
  }
}

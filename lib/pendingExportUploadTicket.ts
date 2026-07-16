import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * JWT `exportTicket` / `pdfTicket` pour upload QR A/V (`guest-upload-urls`).
 * Ne pas passer uniquement en query expo-router : JWT long, risque de troncature / type `string[]`.
 */
const KEY = 'petitmo_pending_export_upload_ticket_v1';

export async function setPendingExportUploadTicket(ticket: string): Promise<void> {
  const t = ticket.trim();
  if (!t) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, t);
}

export async function getPendingExportUploadTicket(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const t = raw?.trim() ?? '';
    return t || null;
  } catch {
    return null;
  }
}

export async function clearPendingExportUploadTicket(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

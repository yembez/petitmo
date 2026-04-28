import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_EMAIL_KEY = 'petitmo_guest_export_last_email_v1';

export async function getLastGuestExportEmail(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_EMAIL_KEY);
    return v?.trim() ? v.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function setLastGuestExportEmail(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e) return;
  try {
    await AsyncStorage.setItem(LAST_EMAIL_KEY, e);
  } catch {
    /* ignore */
  }
}

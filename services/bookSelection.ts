import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@petitmo_book_selection_keys';

/** Clés d’items Favoris : `{memoryId}-whole` ou `{memoryId}-photo-{hash}`. */
export function memoryIdFromBookSelectionKey(key: string): string {
  const marker = '-photo-';
  const i = key.indexOf(marker);
  if (i >= 0) return key.slice(0, i);
  const whole = '-whole';
  if (key.endsWith(whole)) return key.slice(0, -whole.length);
  return key;
}

export async function loadBookSelectionKeys(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveBookSelectionKeys(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* */
  }
}

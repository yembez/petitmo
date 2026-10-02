/**
 * Flag UX legacy « capture verrouillée » (ancien modèle ex-paid lecture seule).
 *
 * **Politique actuelle** : expiration / refund → plan **gratuit** (plafond 50),
 * pas de verrouillage total. Le webhook RC clear `app_metadata.captureLocked`.
 * Ce module reste pour lire d’éventuels flags résiduels (CTA paywall) et les
 * aligner en local — **les gates Capturer ne bloquent plus dessus**.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';

const STORAGE_KEY = 'petitmo:captureLocked';

let memoryFlag: boolean | null = null;

export function peekCaptureLocked(): boolean {
  return memoryFlag === true;
}

export async function getCaptureLockedCached(): Promise<boolean> {
  if (memoryFlag != null) return memoryFlag;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    memoryFlag = raw === '1';
  } catch {
    memoryFlag = false;
  }
  return memoryFlag;
}

export async function setCaptureLockedLocal(active: boolean): Promise<void> {
  memoryFlag = active;
  try {
    if (active) await AsyncStorage.setItem(STORAGE_KEY, '1');
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}

export function captureLockedFromUser(user: User | null | undefined): boolean {
  const raw = user?.app_metadata?.captureLocked;
  return raw === true || raw === 'true' || raw === 1;
}

/** Aligne le cache UX depuis la session Auth. */
export async function syncCaptureLockedFromUser(user: User | null | undefined): Promise<boolean> {
  const active = captureLockedFromUser(user);
  await setCaptureLockedLocal(active);
  return active;
}

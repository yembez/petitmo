/**
 * Carte soft « rappel du soir » sous le 1er souvenir (fil).
 * Low Friction : pas d’Alert ; notifs seulement si « Activer » ; Pas maintenant = dismiss définitif.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { peekHasRealAuthAccount } from '@/lib/authAccount';
import {
  listMemoriesVisibleForAccount,
  peekLastRealAuthUserId,
} from '@/services/accountLocalReset';
import {
  isCaptureReminderEffectivelyOff,
  activateCaptureReminderFromNudge,
  type ActivateCaptureReminderResult,
} from '@/lib/captureReminderNudge';
import {
  DEFAULT_NOTIFICATION_PREFS,
  peekCachedNotificationPrefs,
} from '@/lib/notificationPrefs';

const ARMED_KEY = 'petitmo:eveningReminderCard:armed';
const DISMISSED_KEY = 'petitmo:eveningReminderCard:dismissed';
const SKIP_EXISTING_KEY = 'petitmo:eveningReminderCard:skipExisting';

export const EVENING_REMINDER_CARD_EVENT = 'petitmo:evening-reminder-card';

function keyForUser(base: string, userId: string): string {
  return `${base}:${userId.trim()}`;
}

async function readFlag(base: string, userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyForUser(base, userId))) === '1';
  } catch {
    return false;
  }
}

async function writeFlag(base: string, userId: string, on: boolean): Promise<void> {
  try {
    const k = keyForUser(base, userId);
    if (on) await AsyncStorage.setItem(k, '1');
    else await AsyncStorage.removeItem(k);
  } catch (e) {
    console.warn('[eveningReminderCard] flag', e);
  }
}

/**
 * Comptes déjà peuplés (OTA / restore) : ne pas coller la carte sous d’anciens souvenirs.
 * À appeler au focus fil.
 */
export async function ensureEveningReminderBaselineForAccount(
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  if (await readFlag(DISMISSED_KEY, uid)) return;
  if (await readFlag(ARMED_KEY, uid)) return;
  if (await readFlag(SKIP_EXISTING_KEY, uid)) return;
  const n = listMemoriesVisibleForAccount(uid).length;
  if (n > 0) {
    await writeFlag(SKIP_EXISTING_KEY, uid, true);
  }
}

/** Après insert local réussi : armer si c’est le tout premier souvenir du compte. */
export async function maybeArmEveningReminderCardAfterFirstMemory(
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid || !peekHasRealAuthAccount()) return;
  if (await readFlag(DISMISSED_KEY, uid)) return;
  if (await readFlag(SKIP_EXISTING_KEY, uid)) return;
  if (await readFlag(ARMED_KEY, uid)) return;
  const n = listMemoriesVisibleForAccount(uid).length;
  if (n !== 1) return;
  await writeFlag(ARMED_KEY, uid, true);
  DeviceEventEmitter.emit(EVENING_REMINDER_CARD_EVENT);
}

export async function dismissEveningReminderCard(userId?: string | null): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  await writeFlag(DISMISSED_KEY, uid, true);
  await writeFlag(ARMED_KEY, uid, false);
  DeviceEventEmitter.emit(EVENING_REMINDER_CARD_EVENT);
}

export async function shouldShowEveningReminderCard(
  userId?: string | null,
): Promise<boolean> {
  if (!peekHasRealAuthAccount()) return false;
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return false;
  if (await readFlag(DISMISSED_KEY, uid)) return false;
  if (await readFlag(SKIP_EXISTING_KEY, uid)) return false;
  if (!(await readFlag(ARMED_KEY, uid))) return false;
  if (!(await isCaptureReminderEffectivelyOff())) return false;
  return listMemoriesVisibleForAccount(uid).length >= 1;
}

export async function getEveningReminderDisplayTime(): Promise<string> {
  const prefs = await peekCachedNotificationPrefs();
  return (
    prefs.captureReminderLocalTime?.trim() ||
    DEFAULT_NOTIFICATION_PREFS.captureReminderLocalTime
  );
}

export async function activateEveningReminderFromCard(): Promise<ActivateCaptureReminderResult> {
  const result = await activateCaptureReminderFromNudge();
  if (result === 'enabled') {
    const uid = peekLastRealAuthUserId();
    if (uid) {
      await writeFlag(DISMISSED_KEY, uid, true);
      await writeFlag(ARMED_KEY, uid, false);
    }
  }
  return result;
}

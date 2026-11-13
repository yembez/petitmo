/**
 * Modal soft « rappel du soir » après le 1er import (1 ou N souvenirs).
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

/** Souvenir « tout frais » : ne pas skipper (évite la course arm vs baseline au 1er import). */
const FRESH_FIRST_MEMORY_MS = 10 * 60_000;

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

function isFreshInsertedAt(iso: string | null | undefined): boolean {
  const inserted = Date.parse(iso || '');
  return Number.isFinite(inserted) && Date.now() - inserted <= FRESH_FIRST_MEMORY_MS;
}

/** Purge flags (suppression / changement de compte). */
export async function clearEveningReminderCardState(userId?: string | null): Promise<void> {
  const uid = (userId ?? '').trim();
  if (!uid) return;
  await writeFlag(ARMED_KEY, uid, false);
  await writeFlag(DISMISSED_KEY, uid, false);
  await writeFlag(SKIP_EXISTING_KEY, uid, false);
  DeviceEventEmitter.emit(EVENING_REMINDER_CARD_EVENT);
}

/**
 * Comptes déjà peuplés : ne pas coller le modal sur d’anciens souvenirs.
 * Ne skippe PAS un 1er lot tout frais (1 ou N photos — course avec l’arm à l’import).
 */
export async function ensureEveningReminderBaselineForAccount(
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  if (await readFlag(DISMISSED_KEY, uid)) return;
  if (await readFlag(ARMED_KEY, uid)) return;
  if (await readFlag(SKIP_EXISTING_KEY, uid)) return;

  const memories = listMemoriesVisibleForAccount(uid);
  if (memories.length === 0) return;

  const allFresh = memories.every(m => isFreshInsertedAt(m.inserted_at || m.created_at));
  if (allFresh) return;

  await writeFlag(SKIP_EXISTING_KEY, uid, true);
}

/**
 * Après insert local réussi : armer dès qu’il y a ≥1 souvenir (1 photo ou lot de N).
 * Idempotent si déjà armé / dismissé / compte déjà peuplé (skip).
 */
export async function maybeArmEveningReminderCardAfterFirstMemory(
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid || !peekHasRealAuthAccount()) return;
  if (await readFlag(DISMISSED_KEY, uid)) return;
  if (await readFlag(ARMED_KEY, uid)) return;

  let memories = listMemoriesVisibleForAccount(uid);
  // Course rare upsert → lecture : 1 retry court.
  if (memories.length < 1) {
    await new Promise(r => setTimeout(r, 50));
    memories = listMemoriesVisibleForAccount(uid);
  }
  if (memories.length < 1) return;

  // Compte déjà peuplé (skip) : n’armer que si le lot est encore tout frais (1er import N photos).
  if (await readFlag(SKIP_EXISTING_KEY, uid)) {
    const allFresh = memories.every(m => isFreshInsertedAt(m.inserted_at || m.created_at));
    if (!allFresh) return;
  }

  // Import (1 ou N) gagne la course contre un skip trop agressif.
  await writeFlag(SKIP_EXISTING_KEY, uid, false);
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

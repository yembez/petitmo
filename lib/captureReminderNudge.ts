/**
 * Nudge soft Capturer — rappel du soir non programmé.
 * Low Friction : bannière, pas d’Alert ; cooldown 7 j.
 * (Pas sur le Fil : Modal sheet d’heure peu fiable au-dessus du feed.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { peekHasRealAuthAccount } from '@/lib/authAccount';
import {
  getNotificationsGranted,
  getNotificationsPermissionStatus,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
} from '@/lib/onboardingPermissions';
import {
  peekCachedNotificationPrefs,
  saveNotificationPrefs,
} from '@/lib/notificationPrefs';
import { registerPushTokenInBackground } from '@/services/registerPushToken';

const LAST_NUDGE_KEY = 'petitmo_last_capture_reminder_nudge';

export type ActivateCaptureReminderResult =
  | 'enabled'
  | 'needs_settings'
  | 'unavailable';

/** true si le rappel ne peut pas partir (prefs off ou notifs iOS absentes). */
export async function isCaptureReminderEffectivelyOff(): Promise<boolean> {
  if (!peekHasRealAuthAccount()) return false;
  const prefs = await peekCachedNotificationPrefs();
  const notifs = await getNotificationsPermissionStatus();
  return !(prefs.captureReminderEnabled && notifs === 'granted');
}

export async function shouldShowCaptureReminderNudge(): Promise<boolean> {
  if (!(await isCaptureReminderEffectivelyOff())) return false;

  const lastNudgeStr = await AsyncStorage.getItem(LAST_NUDGE_KEY);
  if (lastNudgeStr) {
    const daysSinceNudge =
      (Date.now() - new Date(lastNudgeStr).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceNudge < 7) return false;
  }
  return true;
}

export async function markCaptureReminderNudgeSeen(): Promise<void> {
  await AsyncStorage.setItem(LAST_NUDGE_KEY, new Date().toISOString());
}

/**
 * Active le rappel (notifs + prefs). L’UI ouvre ensuite le sheet d’heure.
 * Pas d’Alert — Low Friction.
 */
export async function activateCaptureReminderFromNudge(): Promise<ActivateCaptureReminderResult> {
  if (!(await isNotificationsModuleAvailable())) return 'unavailable';
  let granted = await getNotificationsGranted();
  if (!granted) {
    granted = await requestNotificationsAccess();
  }
  if (!granted) return 'needs_settings';
  void registerPushTokenInBackground();
  await saveNotificationPrefs({ captureReminderEnabled: true });
  return 'enabled';
}

/**
 * Enregistrement silencieux du token Expo Push (fond uniquement).
 * Règle d’or V2 / local-first : jamais de spinner ni d’attente UI.
 *
 * Prérequis : permission notifications accordée + session Supabase +
 * module natif `expo-notifications` + appareil physique.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import {
  getNotificationsGranted,
  isNotificationsModuleAvailable,
} from '@/lib/onboardingPermissions';

const LAST_TOKEN_KEY = 'petitmo:lastExpoPushToken';

let inFlight: Promise<string | null> | null = null;
let handlerInstalled = false;

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return (
    extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

async function ensureAndroidChannel(
  Notifications: typeof import('expo-notifications')
): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Petitmo',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    bypassDnd: false,
  });
}

function ensureForegroundHandler(
  Notifications: typeof import('expo-notifications')
): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      /** Bandeau + Centre de notifications, même app au premier plan. */
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Dernier token connu en local (test / debug Espace parent). */
export async function peekCachedExpoPushToken(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Demande le token Expo et l’upsert dans `push_tokens` si permission OK.
 * @returns le token, ou null si indisponible / refusé / hors device.
 */
export async function registerPushTokenInBackground(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (!(await isNotificationsModuleAvailable())) return null;
      if (!(await getNotificationsGranted())) return null;

      const Notifications = await import('expo-notifications');
      ensureForegroundHandler(Notifications);
      await ensureAndroidChannel(Notifications);

      const projectId = easProjectId();
      if (!projectId) {
        console.warn('[push] EAS projectId manquant');
        return null;
      }

      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = token?.trim();
      if (!expoPushToken) return null;

      try {
        await AsyncStorage.setItem(LAST_TOKEN_KEY, expoPushToken);
      } catch {
        /* cache UX optionnel */
      }

      if (__DEV__) {
        console.log('[push] ExpoPushToken', expoPushToken);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return expoPushToken;

      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const { error } = await supabase.from('push_tokens').upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,expo_push_token' }
      );

      if (error) {
        console.warn('[push] upsert push_tokens', error.message);
      }

      return expoPushToken;
    } catch (e) {
      console.warn('[push] registerPushTokenInBackground', e);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

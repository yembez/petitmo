/**
 * Ouverture de l’app au tap sur une notification push.
 * Local-first : navigation locale uniquement, aucun await réseau.
 *
 * Payload Expo recommandé (outil / API) :
 * `{ "sound": "default", "priority": "high", "data": { "screen": "/(tabs)" } }`
 *
 * Sur iOS, le bandeau disparaît tout seul ; la notif reste dans le Centre
 * de notifications jusqu’au tap. Pour la voir longtemps : envoyer l’app
 * en arrière-plan (ou verrouiller l’écran) avant le test.
 */
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { isNotificationsModuleAvailable } from '@/lib/onboardingPermissions';

const DEFAULT_SCREEN = '/(tabs)';

let lastHandledId: string | null = null;

function resolveScreen(data: Record<string, unknown> | undefined): string {
  const screen = data?.screen;
  if (typeof screen === 'string' && screen.startsWith('/')) return screen;
  const url = data?.url;
  if (typeof url === 'string' && url.startsWith('/')) return url;
  return DEFAULT_SCREEN;
}

function openFromResponse(response: {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } };
}): void {
  const id = response.notification.request.identifier;
  if (id && id === lastHandledId) return;
  lastHandledId = id || `ts-${Date.now()}`;

  const screen = resolveScreen(response.notification.request.content.data);
  try {
    router.push(screen as '/(tabs)');
  } catch (e) {
    console.warn('[push] navigate from notification', e);
  }
}

/**
 * Installe les listeners tap + cold-start. Retourne un cleanup.
 * No-op si module natif absent.
 */
export async function installPushNotificationOpenHandlers(): Promise<() => void> {
  if (Platform.OS === 'web') return () => undefined;
  if (!(await isNotificationsModuleAvailable())) return () => undefined;
  if (!requireOptionalNativeModule('ExpoNotificationsEmitter')) {
    return () => undefined;
  }

  const Notifications = await import('expo-notifications');

  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    openFromResponse(response);
    void Notifications.clearLastNotificationResponseAsync();
  });

  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) {
      openFromResponse(last);
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch (e) {
    console.warn('[push] getLastNotificationResponse', e);
  }

  return () => {
    sub.remove();
  };
}

/**
 * Ouvre les Réglages de l’app (iOS).
 * Catch silencieux — évite unhandledrejection si iOS renvoie success=false.
 */
import { Linking } from 'react-native';

export function openAppSettings(): void {
  void (async () => {
    try {
      await Linking.openSettings();
    } catch {
      try {
        await Linking.openURL('app-settings:');
      } catch {
        /* ignore */
      }
    }
  })();
}

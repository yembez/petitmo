/**
 * Matérialisation cloud différée : laisse le temps à expo-updates de télécharger
 * / appliquer une OTA avant le chemin qui plantait (PushNotificationIOS via import dynamique).
 * Sur JS embarqué build 18 le bug existe encore — ce délai n’aide qu’une fois l’OTA chargée,
 * mais évite une course OTA vs materialize au boot suivant.
 */
const DEFAULT_DELAY_MS = 20_000;

export function scheduleAfterOtaWindow(task: () => void, delayMs = DEFAULT_DELAY_MS): void {
  setTimeout(() => {
    try {
      task();
    } catch (e) {
      console.warn('[scheduleAfterOtaWindow]', e);
    }
  }, delayMs);
}

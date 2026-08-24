import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

let inFlight: Promise<boolean> | null = null;

/**
 * `checkAutomatically: ON_LOAD` : au lancement, le natif télécharge déjà l’OTA de son côté
 * et ne l’applique qu’au **prochain** démarrage à froid. Lancer un `fetchUpdateAsync`
 * concurrent échoue (« already in progress ») et l’app reste bloquée sur l’ancien bundle
 * tant que l’utilisatrice ne relance pas plusieurs fois.
 *
 * D’où : on regarde d’abord l’état natif, on attend la fin de son téléchargement,
 * puis `reloadAsync` applique la mise à jour dans la session courante.
 */

/** Update déjà téléchargée, en attente du prochain lancement → applicable immédiatement. */
function hasPendingUpdate(): boolean {
  try {
    return Updates.latestContext?.isUpdatePending === true;
  } catch {
    return false;
  }
}

/** Le natif est en train de chercher / télécharger (procédure de démarrage incluse). */
function nativeDownloadInProgress(): boolean {
  try {
    const c = Updates.latestContext;
    return !!c && (c.isStartupProcedureRunning || c.isChecking || c.isDownloading);
  } catch {
    return false;
  }
}

/** Résout `true` dès qu’une update est prête à être appliquée, `false` au bout de `timeoutMs`. */
function waitForPendingUpdate(timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    if (hasPendingUpdate()) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    };
    const subscription = Updates.addUpdatesStateChangeListener(({ context }) => {
      if (context.isUpdatePending) finish(true);
      else if (context.downloadError) finish(false);
      else if (!context.isStartupProcedureRunning && !context.isChecking && !context.isDownloading) {
        finish(false);
      }
    });
    const timer = setTimeout(() => finish(hasPendingUpdate()), timeoutMs);
  });
}

/**
 * Télécharge et applique une OTA si disponible.
 * @returns true si un reload a été déclenché.
 */
export async function applyAvailableOtaUpdate(opts?: {
  /** Si true : reload dès qu’une update neuve est prête (défaut). */
  reload?: boolean;
  /** Fenêtre d’attente du téléchargement natif au lancement (0 = ne pas attendre). */
  waitForNativeDownloadMs?: number;
}): Promise<boolean> {
  if (__DEV__ || Platform.OS === 'web') return false;
  if (!Updates.isEnabled) return false;
  if (inFlight) return inFlight;

  const reload = opts?.reload !== false;
  const waitMs = opts?.waitForNativeDownloadMs ?? 0;

  const reloadIfPending = async (): Promise<boolean> => {
    if (!reload || !hasPendingUpdate()) return false;
    await Updates.reloadAsync();
    return true;
  };

  inFlight = (async () => {
    try {
      if (await reloadIfPending()) return true;

      if (waitMs > 0 && nativeDownloadInProgress()) {
        const ready = await waitForPendingUpdate(waitMs);
        if (ready && (await reloadIfPending())) return true;
      }

      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return false;

      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return reloadIfPending();
      if (!reload) return false;

      await Updates.reloadAsync();
      return true;
    } catch (e) {
      /** Fetch concurrent du natif : l’update est peut-être déjà prête malgré l’erreur. */
      try {
        if (await reloadIfPending()) return true;
      } catch {
        /* reload impossible */
      }
      console.warn('[ota] applyAvailableOtaUpdate', e);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

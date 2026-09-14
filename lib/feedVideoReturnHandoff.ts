/**
 * Pont immersif → fil : le viewer attend la 1ʳᵉ frame réelle de la VideoView fil
 * (`onFirstFrameRender`) avant de démonter le modal — pas un délai fixe ni un
 * court-circuit sur `player.playing` (le lecteur tourne déjà côté hero).
 */

const DEFAULT_TIMEOUT_MS = 450;

type Waiter = {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
};

const waiters = new Map<string, Waiter>();
/** Frame déjà peinte avant que le viewer s’abonne (court-circuit). */
const readyKeys = new Set<string>();

function clearWaiter(key: string): void {
  const pending = waiters.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  waiters.delete(key);
}

/** Le fil a peint une frame pour ce souvenir (retour immersif). */
export function notifyFeedVideoFirstFrame(memoryId: string): void {
  const key = memoryId.trim();
  if (!key) return;
  const pending = waiters.get(key);
  if (pending) {
    clearWaiter(key);
    readyKeys.delete(key);
    pending.resolve();
    return;
  }
  /** Viewer pas encore en attente : la prochaine `wait` court-circuite. */
  readyKeys.add(key);
}

/**
 * Résout dès `notifyFeedVideoFirstFrame`, ou au timeout filet si le fil
 * ne signale jamais (liste recyclée, lecteur mort).
 */
export function waitForFeedVideoFirstFrame(
  memoryId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const key = memoryId.trim();
  if (!key) return Promise.resolve();
  if (readyKeys.has(key)) {
    readyKeys.delete(key);
    return Promise.resolve();
  }
  clearWaiter(key);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiters.delete(key);
      readyKeys.delete(key);
      resolve();
    }, timeoutMs);
    waiters.set(key, { resolve, timer });
  });
}

/** Annule une attente en cours (fermeture abandonnée). */
export function cancelFeedVideoFirstFrameWait(memoryId: string): void {
  const key = memoryId.trim();
  if (!key) return;
  clearWaiter(key);
  readyKeys.delete(key);
}

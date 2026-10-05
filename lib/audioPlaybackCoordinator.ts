/**
 * Une seule lecture vocale à la fois (fil / immersif / plusieurs AudioPlayer).
 * Low Friction : play sur B coupe A sans alerter.
 */

type StopFn = () => void;

let activeId: string | null = null;
const stoppers = new Map<string, StopFn>();

export function registerAudioPlayer(id: string, stop: StopFn): () => void {
  stoppers.set(id, stop);
  return () => {
    stoppers.delete(id);
    if (activeId === id) activeId = null;
  };
}

/** Avant de démarrer la lecture : coupe l’éventuel autre lecteur actif. */
export function claimAudioPlayback(id: string): void {
  if (activeId && activeId !== id) {
    const stop = stoppers.get(activeId);
    stop?.();
  }
  activeId = id;
}

export function releaseAudioPlayback(id: string): void {
  if (activeId === id) activeId = null;
}

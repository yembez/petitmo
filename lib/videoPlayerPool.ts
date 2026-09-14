import { useEffect, useState, useSyncExternalStore } from 'react';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

/**
 * Réserve de lecteurs vidéo partagés entre le fil et le viewer immersif.
 *
 * `expo-video` sépare le lecteur de la vue : deux `VideoView` peuvent afficher le
 * **même** lecteur, donc la lecture ne s’interrompt pas quand on agrandit un
 * souvenir puis qu’on revient au fil. Le lecteur survit au démontage de la vue le
 * temps de l’aller-retour, ce qu’`expo-av` ne permettait pas (lecteur enfermé dans
 * le composant, donc redémarrage à chaque changement d’écran).
 *
 * Sur Android, un même lecteur ne peut pas alimenter deux `VideoView` montées en
 * même temps (limite media3) : l’appelant ne doit en monter qu’une à la fois là-bas.
 */

type PoolEntry = {
  player: VideoPlayer;
  uri: string;
  /** Nombre de vues qui s’appuient dessus — libérer sous une vue montée plante. */
  refs: number;
  /** Date du dernier relâchement, pour évincer le plus ancien d’abord. */
  idleSince: number;
};

const pool = new Map<string, PoolEntry>();

/** Le viewer tient ce souvenir : le fil lâche sa surface sans pauser le lecteur. */
const keepAliveKeys = new Set<string>();
const keepAliveListeners = new Set<() => void>();

/** Un idle court évite de recréer AVPlayer au scroll ; trop long = chaleur + busy posters. */
const MAX_IDLE_PLAYERS = 1;
/** Après ça, même le dernier idle est détruit (plus de décodeur « chaud » en fond). */
const IDLE_PLAYER_TTL_MS = 8_000;

let idleTtlTimer: ReturnType<typeof setTimeout> | null = null;

function emitKeepAlive(): void {
  for (const listener of keepAliveListeners) listener();
}

function destroyPoolEntry(key: string, entry: PoolEntry): void {
  pool.delete(key);
  try {
    entry.player.pause();
  } catch {
    /* déjà arrêté */
  }
  try {
    entry.player.release();
  } catch {
    /* déjà libéré côté natif */
  }
}

function clearIdleTtlTimer(): void {
  if (!idleTtlTimer) return;
  clearTimeout(idleTtlTimer);
  idleTtlTimer = null;
}

function scheduleIdleTtlEvict(): void {
  clearIdleTtlTimer();
  const hasIdle = Array.from(pool.entries()).some(
    ([key, entry]) => entry.refs === 0 && !keepAliveKeys.has(key),
  );
  if (!hasIdle) return;
  idleTtlTimer = setTimeout(() => {
    idleTtlTimer = null;
    const now = Date.now();
    for (const [key, entry] of Array.from(pool.entries())) {
      if (entry.refs > 0 || keepAliveKeys.has(key)) continue;
      if (now - entry.idleSince < IDLE_PLAYER_TTL_MS) continue;
      destroyPoolEntry(key, entry);
    }
    /** Relancer si un idle plus récent reste sous le TTL. */
    scheduleIdleTtlEvict();
  }, IDLE_PLAYER_TTL_MS);
}

export function claimVideoKeepAlive(key: string): void {
  const k = key.trim();
  if (!k || keepAliveKeys.has(k)) return;
  keepAliveKeys.add(k);
  emitKeepAlive();
}

export function releaseVideoKeepAlive(key: string): void {
  const k = key.trim();
  if (!keepAliveKeys.delete(k)) return;
  emitKeepAlive();
  evictIdlePlayers();
}

/** Filet : libère tout keepAlive (viewer coincé / AppState). */
export function releaseAllVideoKeepAlive(): void {
  if (keepAliveKeys.size === 0) return;
  keepAliveKeys.clear();
  emitKeepAlive();
  evictIdlePlayers();
}

export function isAnyVideoKeepAlive(): boolean {
  return keepAliveKeys.size > 0;
}

/**
 * True seulement si un décodeur est **réellement** en usage (refs > 0 ou keepAlive).
 * Un lecteur idle en pool ne doit pas bloquer `getThumbnailAsync` / posters.
 */
export function isVideoDecoderBusy(): boolean {
  if (keepAliveKeys.size > 0) return true;
  for (const entry of pool.values()) {
    if (entry.refs > 0) return true;
  }
  return false;
}

/** Pause tous les lecteurs du pool (arrière-plan / thermal). */
export function pauseAllPooledVideoPlayers(): void {
  for (const entry of pool.values()) {
    try {
      entry.player.pause();
    } catch {
      /* déjà arrêté / libéré */
    }
  }
}

export function peekPooledVideoUri(key: string): string | null {
  return pool.get(key.trim())?.uri ?? null;
}

/** Lecteur déjà en pool (fil) — 1er paint du hero sans attendre `useEffect`. */
export function peekPooledVideoPlayer(key: string): VideoPlayer | null {
  return pool.get(key.trim())?.player ?? null;
}

/**
 * Android : après un changement de `VideoView`, `replace` de la même URI force
 * la nouvelle surface à capter le flux (sinon écran noir, buffer intact).
 */
export function reattachVideoPlayer(player: VideoPlayer, uri: string): void {
  const time = player.currentTime;
  const wasPlaying = player.playing;
  player.replace(uri);
  player.currentTime = time;
  if (wasPlaying) player.play();
}

function subscribeKeepAlive(onStoreChange: () => void): () => void {
  keepAliveListeners.add(onStoreChange);
  return () => keepAliveListeners.delete(onStoreChange);
}

function subscribeKeepAliveNoop(): () => void {
  return () => {};
}

export function useIsVideoKeepAlive(key: string | null | undefined): boolean {
  const k = key?.trim() ?? '';
  return useSyncExternalStore(
    k ? subscribeKeepAlive : subscribeKeepAliveNoop,
    () => (k ? keepAliveKeys.has(k) : false),
    () => false,
  );
}

function configurePlayer(player: VideoPlayer): void {
  player.loop = true;
  /** Le son est un choix explicite de l’utilisatrice, jamais l’état par défaut. */
  player.muted = true;
  player.audioMixingMode = 'auto';
}

function evictIdlePlayers(): void {
  const idle = Array.from(pool.entries()).filter(
    ([key, entry]) => entry.refs === 0 && !keepAliveKeys.has(key),
  );
  idle.sort((a, b) => a[1].idleSince - b[1].idleSince);
  while (idle.length > MAX_IDLE_PLAYERS) {
    const next = idle.shift();
    if (!next) break;
    destroyPoolEntry(next[0], next[1]);
  }
  scheduleIdleTtlEvict();
}

/** Le lecteur du souvenir `key`, créé si besoin. Toujours relâcher après usage. */
export function acquireVideoPlayer(key: string, uri: string): VideoPlayer {
  const existing = pool.get(key);
  if (existing) {
    existing.refs += 1;
    if (existing.uri !== uri) {
      /** URL signée renouvelée : on remplace la source sans perdre le lecteur. */
      existing.uri = uri;
      existing.player.replace(uri);
    }
    return existing.player;
  }

  const player = createVideoPlayer(uri);
  configurePlayer(player);
  pool.set(key, { player, uri, refs: 1, idleSince: 0 });
  evictIdlePlayers();
  return player;
}

export function releaseVideoPlayer(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;

  entry.idleSince = Date.now();
  if (keepAliveKeys.has(key)) return;
  evictIdlePlayers();
}

/**
 * Lecteur partagé pour la durée de vie du composant.
 *
 * `key` doit identifier le **souvenir**, pas la vue : c’est ce qui permet au fil et
 * au viewer de retomber sur le même lecteur.
 */
export function useSharedVideoPlayer(
  key: string | null | undefined,
  uri: string | null | undefined,
): VideoPlayer | null {
  const poolKey = key?.trim() || null;
  const poolUri = uri?.trim() || null;
  const [player, setPlayer] = useState<VideoPlayer | null>(null);

  useEffect(() => {
    if (!poolKey || !poolUri) {
      setPlayer(null);
      return;
    }
    const acquired = acquireVideoPlayer(poolKey, poolUri);
    setPlayer(acquired);
    return () => {
      releaseVideoPlayer(poolKey);
      setPlayer(null);
    };
  }, [poolKey, poolUri]);

  return player;
}

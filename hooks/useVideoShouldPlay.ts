import { useEffect } from 'react';
import type { VideoPlayer } from 'expo-video';

export type VideoShouldPlayOptions = {
  /** Fil : une vidéo revue après être sortie de l’écran repart de t=0. */
  restartFromBeginningOnPlay?: boolean;
  /**
   * Sursis avant la pause. Le passage fil ↔ viewer laisse une frame où plus
   * personne ne réclame la lecture ; sans sursis on couperait pour la reprendre
   * aussitôt, ce qui hoquette et fait repartir la vidéo du début.
   */
  pauseGraceMs?: number;
  /** Le viewer tient le lecteur : ne pas pauser / rembobiner pendant le relais. */
  skipPause?: boolean;
};

/**
 * Lecture / pause déclaratives sur un lecteur `expo-video`.
 *
 * Contrairement à `expo-av`, `play()` avant la fin du chargement est sans risque :
 * le lecteur démarre dès qu’il a de quoi jouer, donc plus de tentatives répétées.
 */
export function useVideoShouldPlay(
  player: VideoPlayer | null,
  shouldPlay: boolean,
  options?: VideoShouldPlayOptions,
): void {
  const restartFromBeginning = options?.restartFromBeginningOnPlay === true;
  const pauseGraceMs = options?.pauseGraceMs ?? 0;
  const skipPause = options?.skipPause === true;

  useEffect(() => {
    if (!player) return;

    if (shouldPlay) {
      try {
        /**
         * Le rembobinage se fait à la pause (sortie d’écran), pas ici :
         * sinon le retour du viewer remet à zéro dès que la lecture a été
         * relâchée une frame.
         */
        player.play();
      } catch {
        // Lecteur libéré entre-temps.
      }
      return;
    }

    if (skipPause) return;

    const pause = () => {
      try {
        player.pause();
        if (restartFromBeginning) player.currentTime = 0;
      } catch {
        // Lecteur libéré entre-temps.
      }
    };

    if (pauseGraceMs <= 0) {
      pause();
      return;
    }

    const timer = setTimeout(pause, pauseGraceMs);
    return () => clearTimeout(timer);
  }, [player, shouldPlay, restartFromBeginning, pauseGraceMs, skipPause]);
}

import { useEffect } from 'react';
import type { VideoPlayer } from 'expo-video';
import { feedFlashLog } from '@/lib/feedFlashDebug';
import { recordWarn } from '@/lib/diagnosticTrail';

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
  /** Id court pour correl logs feedFlash (investigation). */
  debugMemoryId?: string | null;
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
  const debugId = options?.debugMemoryId?.slice(0, 8) ?? null;

  useEffect(() => {
    if (!player) return;

    if (shouldPlay) {
      try {
        let t = 0;
        try {
          t = Number(player.currentTime) || 0;
        } catch {
          t = 0;
        }
        feedFlashLog('video.shouldPlay', {
          id: debugId,
          play: true,
          t: Math.round(t * 100) / 100,
          restartFlag: restartFromBeginning,
        });
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

    if (skipPause) {
      feedFlashLog('video.shouldPlay', {
        id: debugId,
        play: false,
        skipPause: true,
      });
      return;
    }

    const pause = () => {
      try {
        let t = 0;
        try {
          t = Number(player.currentTime) || 0;
        } catch {
          t = 0;
        }
        feedFlashLog('video.shouldPlay', {
          id: debugId,
          play: false,
          t: Math.round(t * 100) / 100,
          rewind: restartFromBeginning,
        });
        if (restartFromBeginning && t > 0.05) {
          recordWarn(
            'feed.video.rewind',
            `${debugId ?? '?'} t=${Math.round(t * 10) / 10}s→0`,
          );
        }
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
  }, [player, shouldPlay, restartFromBeginning, pauseGraceMs, skipPause, debugId]);
}

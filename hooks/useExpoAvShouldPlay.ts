import { useEffect, type RefObject } from 'react';
import type { Video } from 'expo-av';

export type ExpoAvShouldPlayOptions = {
  /** Fil : repartir de t=0 à chaque reprise (sortie écran → retour). */
  restartFromBeginningOnPlay?: boolean;
};

/**
 * `expo-av` sur iOS n’applique pas toujours un changement de prop `shouldPlay` après le montage.
 * Lecture / pause explicites — sans `InteractionManager` (évite de retarder l’autoplay fil).
 */
export function useExpoAvShouldPlay(
  ref: RefObject<Video | null>,
  shouldPlay: boolean,
  playbackUri: string,
  options?: ExpoAvShouldPlayOptions,
): void {
  const restartFromBeginning = options?.restartFromBeginningOnPlay === true;

  useEffect(() => {
    const uri = playbackUri.trim();
    if (!uri) return;

    let cancelled = false;

    const apply = async (seekToStart: boolean) => {
      const player = ref.current;
      if (!player || cancelled) return;
      try {
        if (shouldPlay) {
          if (restartFromBeginning && seekToStart) {
            await player.setPositionAsync(0);
          }
          await player.playAsync();
        } else {
          await player.pauseAsync();
          if (restartFromBeginning) {
            await player.setPositionAsync(0);
          }
        }
      } catch {
        /* source pas prête ou composant démonté */
      }
    };

    void apply(true);
    const retryMs = [16, 80, 200];
    const retryIds = retryMs.map(ms =>
      setTimeout(() => {
        void apply(false);
      }, ms),
    );

    return () => {
      cancelled = true;
      retryIds.forEach(id => clearTimeout(id));
    };
  }, [ref, shouldPlay, playbackUri, restartFromBeginning]);
}

import { useEffect, type RefObject } from 'react';
import type { Video } from 'expo-av';

/**
 * `expo-av` sur iOS n’applique pas toujours un changement de prop `shouldPlay` après le montage.
 * Lecture / pause explicites — sans `InteractionManager` (évite de retarder l’autoplay fil).
 */
export function useExpoAvShouldPlay(
  ref: RefObject<Video | null>,
  shouldPlay: boolean,
  playbackUri: string
): void {
  useEffect(() => {
    const uri = playbackUri.trim();
    if (!uri) return;

    let cancelled = false;

    const apply = async () => {
      const player = ref.current;
      if (!player || cancelled) return;
      try {
        if (shouldPlay) {
          await player.playAsync();
        } else {
          await player.pauseAsync();
        }
      } catch {
        /* source pas prête ou composant démonté */
      }
    };

    void apply();
    const retryMs = [48, 200, 500];
    const retryIds = retryMs.map(ms =>
      setTimeout(() => {
        void apply();
      }, ms),
    );

    return () => {
      cancelled = true;
      retryIds.forEach(id => clearTimeout(id));
    };
  }, [ref, shouldPlay, playbackUri]);
}

import { useEffect, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import type { Memory } from '@/types/local';
import {
  getFeedLocalVideoPath,
  peekFeedBootstrapVideoUri,
  persistFeedLocalVideo,
  takeFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  normalizeVideoPlaybackUri,
  resolveReadableVideoPlaybackUri,
} from '@/utils/videoMediaUri';

async function resolveRemoteVideoUri(raw: string): Promise<string> {
  const t = raw.trim();
  if (!t || !/^https?:\/\//i.test(t)) return normalizeVideoPlaybackUri(t);
  return getSignedMediaDisplayUrl(t);
}

function initialPlaybackUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  const boot = peekFeedBootstrapVideoUri(memory.id);
  return boot ? normalizeVideoPlaybackUri(boot) : '';
}

/**
 * URI de lecture vidéo dans le fil : copie fil si présente, sinon sandbox `original.*`,
 * sinon distant signé. Vérifie l’existence disque (chemins SQLite périmés ignorés).
 */
export function useFeedVideoPlaybackUri(memory: Memory): string {
  const [uri, setUri] = useState<string>(() => initialPlaybackUri(memory));

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    let alive = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
      const feedCopy =
        Platform.OS === 'web' ? null : ((await getFeedLocalVideoPath(memory.id))?.trim() ?? '');
      const boot = peekFeedBootstrapVideoUri(memory.id)?.trim() ?? '';

      const chosen = await resolveReadableVideoPlaybackUri(memory, {
        feedCopy,
        bootstrap: boot,
        resolveRemote: resolveRemoteVideoUri,
      });

      if (!alive) return;

      setUri(chosen);

      if (chosen && boot) takeFeedBootstrapVideoUri(memory.id);

      if (
        Platform.OS !== 'web' &&
        !feedCopy &&
        chosen &&
        memory.id &&
        chosen.includes('petitmo_memories/')
      ) {
        const sourcePath = chosen.replace(/^file:\/\//, '');
        void persistFeedLocalVideo(memory.id, sourcePath);
      }
    })();
    });

    return () => {
      alive = false;
      task.cancel();
    };
  }, [
    memory.type,
    memory.id,
    memory.media_url,
    memory.edited_media_url,
    memory.local_media_path,
    memory.local_original_path,
  ]);

  return uri;
}

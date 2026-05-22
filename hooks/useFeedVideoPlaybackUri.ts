import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import {
  getFeedLocalVideoPath,
  peekFeedBootstrapVideoUri,
  takeFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  firstNonEmptyUri,
  normalizeVideoPlaybackUri,
  videoPlaybackCandidateFromMemory,
} from '@/utils/videoMediaUri';

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

function isLikelyDeviceLocalAsset(u: string): boolean {
  const t = u.trim();
  if (!t || isHttpUrl(t) || t.startsWith('data:')) return false;
  if (
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://')
  ) {
    return true;
  }
  if (t.startsWith('/')) return true;
  return false;
}

async function resolveRemoteVideoUri(raw: string): Promise<string> {
  const t = raw.trim();
  if (!t || !isHttpUrl(t)) return normalizeVideoPlaybackUri(t);
  return getSignedMediaDisplayUrl(t);
}

function initialPlaybackUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  if (Platform.OS === 'web') {
    return normalizeVideoPlaybackUri(videoPlaybackCandidateFromMemory(memory));
  }
  const boot = peekFeedBootstrapVideoUri(memory.id);
  return normalizeVideoPlaybackUri(
    firstNonEmptyUri(boot, videoPlaybackCandidateFromMemory(memory))
  );
}

/**
 * URI de lecture vidéo dans le fil : copie locale persistante si présente (pas d’egress),
 * sinon candidats distants / sandbox. Pas de sondage disque synchrone (autoplay fil).
 */
export function useFeedVideoPlaybackUri(memory: Memory): string {
  const [uri, setUri] = useState<string>(() => initialPlaybackUri(memory));

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    let alive = true;
    void (async () => {
      const remoteRaw = videoPlaybackCandidateFromMemory(memory);
      const remote = await resolveRemoteVideoUri(remoteRaw);
      if (!alive) return;
      if (Platform.OS === 'web') {
        setUri(remote);
        return;
      }

      const feedCopy = (await getFeedLocalVideoPath(memory.id))?.trim() ?? '';
      const boot = peekFeedBootstrapVideoUri(memory.id)?.trim() ?? '';
      const remoteNorm = normalizeVideoPlaybackUri(remote);
      const memoryNorm = normalizeVideoPlaybackUri(videoPlaybackCandidateFromMemory(memory));
      const chosen = normalizeVideoPlaybackUri(
        firstNonEmptyUri(feedCopy, memoryNorm, boot, remoteNorm)
      );
      if (!alive) return;
      setUri(prev => {
        const prevU = (prev?.trim() || '');
        const nextU = chosen.trim();
        if (
          prevU &&
          isLikelyDeviceLocalAsset(prevU) &&
          nextU &&
          isLikelyDeviceLocalAsset(nextU) &&
          prevU !== nextU
        ) {
          return prev;
        }
        return prev === nextU ? prev : nextU;
      });
      if (chosen) takeFeedBootstrapVideoUri(memory.id);
    })();

    return () => {
      alive = false;
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

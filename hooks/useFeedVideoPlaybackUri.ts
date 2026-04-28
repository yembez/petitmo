import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import {
  getFeedLocalVideoPath,
  peekFeedBootstrapVideoUri,
  takeFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';

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

function remotePlaybackUri(m: Memory): string {
  return (m.edited_media_url?.trim() || m.media_url?.trim() || '').trim();
}

/**
 * URI de lecture vidéo dans le fil : copie locale persistante si présente (pas d’egress),
 * sinon `edited_media_url` / `media_url`.
 */
export function useFeedVideoPlaybackUri(memory: Memory): string {
  const [uri, setUri] = useState<string>(() => {
    if (memory.type !== 'video') return '';
    if (Platform.OS === 'web') return remotePlaybackUri(memory);
    const boot = peekFeedBootstrapVideoUri(memory.id);
    if (boot?.trim()) return boot.trim();
    return remotePlaybackUri(memory);
  });

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }
    if (Platform.OS === 'web') {
      setUri(remotePlaybackUri(memory));
      return;
    }

    let alive = true;
    void (async () => {
      const remote = remotePlaybackUri(memory);
      const local = await getFeedLocalVideoPath(memory.id);
      let chosen = (local?.trim() || remote || '').trim();
      if (!alive) return;
      setUri(prev => {
        const prevU = (prev?.trim() || '');
        if (
          prevU &&
          isLikelyDeviceLocalAsset(prevU) &&
          chosen &&
          isLikelyDeviceLocalAsset(chosen) &&
          prevU !== chosen
        ) {
          return prev;
        }
        return prev === chosen ? prev : chosen;
      });
      takeFeedBootstrapVideoUri(memory.id);
    })();

    return () => {
      alive = false;
    };
  }, [memory.type, memory.id, memory.media_url, memory.edited_media_url]);

  return uri;
}

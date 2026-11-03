import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { Memory } from '@/types/local';
import { useFeedVideoPosterDisplayUrl } from '@/hooks/useFeedVideoPosterDisplayUrl';
import { FeedLoadingDots } from '@/components/FeedLoadingDots';
import { feedFlashLog, feedFlashUriKind } from '@/lib/feedFlashDebug';
import { materializeCloudMediaToSandboxForMemory } from '@/services/memoryCloudMaterialize';

type Props = {
  memory: Memory;
  recyclingKey: string;
  /** Poster déjà résolu (optionnel). */
  posterUri?: string;
  onReady?: () => void;
};

/**
 * Vignette vidéo Favoris : **poster seulement**.
 * Un `useVideoPlayer` ici (1ʳᵉ frame) créait un 2ᵉ pipeline hors pool et
 * gelait l’app — même bug que l’import dans le fil.
 * Sans poster (restore) : 3 points d’hydratation, pas fond gris + caméra morte.
 */
export default function FavorisVideoThumb({ memory, recyclingKey, posterUri, onReady }: Props) {
  const posterFromHook = useFeedVideoPosterDisplayUrl(memory);
  const poster = (posterUri ?? posterFromHook).trim();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    feedFlashLog('favoris.thumb', {
      id: memory.id.slice(0, 8),
      poster: !!poster,
      posterKind: feedFlashUriKind(poster),
      localThumb: !!memory.local_thumb_path?.trim(),
      posterUrl: !!memory.poster_url?.trim(),
      key: recyclingKey.slice(0, 24),
    });
  }, [
    memory.id,
    memory.local_thumb_path,
    memory.poster_url,
    poster,
    recyclingKey,
  ]);

  useEffect(() => {
    if (poster) return;
    onReadyRef.current?.();
  }, [poster]);

  /** Kick materialize si vignette sans JPEG (Favoris hors fil). */
  useEffect(() => {
    if (poster || memory.type !== 'video') return;
    void materializeCloudMediaToSandboxForMemory(memory.id);
  }, [memory.id, memory.type, poster]);

  if (poster) {
    return (
      <ExpoImage
        source={{ uri: poster }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={recyclingKey}
        onLoad={() => onReady?.()}
        onError={() => onReady?.()}
      />
    );
  }

  return (
    <View
      style={[StyleSheet.absoluteFillObject, styles.hydrate]}
      accessibilityRole="progressbar"
      accessibilityLabel="Chargement de la vidéo"
    >
      <FeedLoadingDots color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  hydrate: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});

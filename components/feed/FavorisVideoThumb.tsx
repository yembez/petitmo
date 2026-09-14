import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { Memory } from '@/types/local';
import { useFeedVideoPosterDisplayUrl } from '@/hooks/useFeedVideoPosterDisplayUrl';

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
 */
export default function FavorisVideoThumb({ memory, recyclingKey, posterUri, onReady }: Props) {
  const posterFromHook = useFeedVideoPosterDisplayUrl(memory);
  const poster = (posterUri ?? posterFromHook).trim();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (poster) return;
    onReadyRef.current?.();
  }, [poster]);

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

  return <View style={[StyleSheet.absoluteFillObject, styles.fallback]} />;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#000000',
  },
});

import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import type { Memory } from '@/types/local';
import { useFeedVideoPosterDisplayUrl } from '@/hooks/useFeedVideoPosterDisplayUrl';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';

type Props = {
  memory: Memory;
  recyclingKey: string;
  /** Poster déjà résolu (optionnel). */
  posterUri?: string;
  onReady?: () => void;
};

/**
 * Vignette vidéo Favoris — parité fil : poster si dispo, sinon 1ʳᵉ frame via fichier vidéo local/cloud.
 */
export default function FavorisVideoThumb({ memory, recyclingKey, posterUri, onReady }: Props) {
  const posterFromHook = useFeedVideoPosterDisplayUrl(memory);
  const poster = (posterUri ?? posterFromHook).trim();
  const playback = normalizeVideoPlaybackUri(useFeedVideoPlaybackUri(memory)).trim();
  const [posterFailed, setPosterFailed] = useState(false);

  if (poster && !posterFailed) {
    return (
      <ExpoImage
        source={{ uri: poster }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={recyclingKey}
        onLoad={() => onReady?.()}
        onError={() => setPosterFailed(true)}
      />
    );
  }

  if (playback) {
    return (
      <View style={StyleSheet.absoluteFillObject}>
        <Video
          source={{ uri: playback }}
          style={StyleSheet.absoluteFillObject}
          videoStyle={StyleSheet.absoluteFillObject}
          resizeMode={ResizeMode.COVER}
          shouldPlay={false}
          isLooping={false}
          isMuted
          useNativeControls={false}
          onReadyForDisplay={() => onReady?.()}
        />
      </View>
    );
  }

  return null;
}

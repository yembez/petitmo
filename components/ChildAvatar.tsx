/**
 * Avatar rond (fil, espace parent) — cadrage **serré sur le visage**.
 * Différent du hero Capturer : même fichier possible, autre zoom / centre.
 *
 * 1. Bounds ML persistées (`face_*` en SQLite) si dispo (dev build).
 * 2. Sinon heuristique avatar (`heuristicFaceBoundsForAvatar`) + ratio mesuré.
 *
 * URI : `useChildProfileDisplayUri` (local sandbox s’il existe, sinon URL signée).
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image as RNImage } from 'react-native';
import type { Child } from '@/types/local';
import { childDisplayInitial } from '@/utils/childDisplayName';
import {
  computeAvatarImageLayout,
  heuristicFaceBoundsForAvatar,
  isLegacyHeroHeuristicOnProfileCrop,
  isValidFaceBounds,
  resolveAvatarFaceBounds,
} from '@/utils/avatarFaceBounds';
import { useChildProfileDisplayUri } from '@/hooks/useChildProfileDisplayUri';
import { THEME } from '@/constants/theme';

const DEFAULT_ASPECT = 9 / 16;

type Props = {
  child: Child;
  size: number;
};

function stripUriQuery(uri: string): string {
  const q = uri.indexOf('?');
  return q >= 0 ? uri.slice(0, q) : uri;
}

export function ChildAvatar({ child, size }: Props) {
  const photoUri = useChildProfileDisplayUri(child);

  const uriForMeasure = photoUri ? stripUriQuery(photoUri) : null;
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!uriForMeasure) {
      setImageAspect(null);
      return;
    }
    let cancelled = false;
    RNImage.getSize(
      uriForMeasure,
      (width, height) => {
        if (cancelled || width <= 0 || height <= 0) return;
        setImageAspect(width / height);
      },
      () => {
        if (!cancelled) setImageAspect(DEFAULT_ASPECT);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uriForMeasure, child.updated_at]);

  const bounds = useMemo(() => {
    const aspect = imageAspect ?? DEFAULT_ASPECT;
    const hasMlOrGoodPersisted =
      isValidFaceBounds(child) && !isLegacyHeroHeuristicOnProfileCrop(child);

    if (hasMlOrGoodPersisted) {
      return resolveAvatarFaceBounds(child);
    }
    return heuristicFaceBoundsForAvatar(aspect);
  }, [child, imageAspect]);

  const frame = useMemo(
    () => computeAvatarImageLayout(size, bounds),
    [size, bounds],
  );

  const imageKey = `${child.id}-${child.updated_at ?? '0'}-${photoUri.slice(0, 64)}`;

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    overflow: 'hidden' as const,
  };

  if (!photoUri) {
    return (
      <View style={[styles.placeholder, containerStyle]}>
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>
          {childDisplayInitial(child.name)}
        </Text>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <RNImage
        key={imageKey}
        source={{ uri: photoUri }}
        style={[styles.faceImage, frame]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: THEME.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: '#fff',
    fontWeight: '600',
  },
  faceImage: {
    position: 'absolute',
  },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

/** Ratio du nouveau logo PNG (1024x188), sans cadre. */
export const PETIT_COEUR_LOGO_VIEWBOX = { x: 0, y: 0, width: 1024, height: 188 } as const;

const PETIT_COEUR_LOGO_SRC_INK = require('@/assets/images/logo_petit_coeur_trois_points_ink.png');
const PETIT_COEUR_LOGO_SRC_WHITE = require('@/assets/images/logo_petit_coeur_trois_points_white.png');
const PETIT_COEUR_LOGO_SRC_OFFWHITE = require('@/assets/images/logo_petit_coeur_trois_points_offwhite.png');
const PETIT_COEUR_LOGO_SRC_TRANSPARENT = require('@/assets/images/logo_petit_coeur_trois_points_transparent.png');

type Props = {
  width: number;
  height: number;
  /** Par défaut : encre interface (#1C1C1E) */
  color?: string;
  /** Halo noir omnidirectionnel très doux (contraste sur photo) */
  shadow?: boolean;
};

/**
 * Logo Petit Cœur en PNG transparent.
 * On conserve la même API ({`color`, `shadow`}) via des variantes pré-rendues.
 */
export default function PetitCoeurLogo({
  width,
  height,
  color = '#1C1C1E',
  shadow = false,
}: Props) {
  const normalized = (color ?? '').trim().toUpperCase();
  const src =
    normalized === '#FFFFFF'
      ? PETIT_COEUR_LOGO_SRC_WHITE
      : normalized === '#FEFBFD'
        ? PETIT_COEUR_LOGO_SRC_OFFWHITE
        : normalized === '#1C1C1E'
          ? PETIT_COEUR_LOGO_SRC_INK
          : PETIT_COEUR_LOGO_SRC_TRANSPARENT;

  return (
    <View style={[styles.wrap, { width, height }]}>
      {shadow ? (
        <>
          <Image
            source={PETIT_COEUR_LOGO_SRC_INK}
            style={[
              StyleSheet.absoluteFillObject,
              { opacity: 0.14, transform: [{ translateY: 1 }] },
            ]}
            contentFit="contain"
          />
          <Image
            source={PETIT_COEUR_LOGO_SRC_INK}
            style={[
              StyleSheet.absoluteFillObject,
              { opacity: 0.09, transform: [{ translateY: 2 }] },
            ]}
            contentFit="contain"
          />
        </>
      ) : null}
      <Image
        source={src}
        style={StyleSheet.absoluteFillObject}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

/**
 * Ratio du lockup `logo_petit_coeur_48*.png` (879×294).
 * Conservé sous ce nom pour les callers qui calculent `height` depuis `width`.
 */
export const PETIT_COEUR_LOGO_VIEWBOX = { width: 879, height: 294 } as const;

/** Ratio du picto cœur axo-outline (PNG crop ~864×805). */
export const PETIT_COEUR_HEART_VIEWBOX = { width: 864, height: 805 } as const;

/** Noir + ombre corail — fonds clairs (brand). */
const LOGO_COLOR = require('@/assets/images/logo_petit_coeur_48_noir_ombre.png') as ImageSourcePropType;
/** Blanc + ombre corail — fonds sombres / photo. */
const LOGO_WHITE = require('@/assets/images/logo_petit_coeur_48_white_ombre.png') as ImageSourcePropType;
/** 100 % blanc — splash / paywall. */
const LOGO_WHITE_SOLID = require('@/assets/images/logo_petit_coeur_48_white.png') as ImageSourcePropType;
/** 100 % noir — fonds clairs. */
const LOGO_NOIR = require('@/assets/images/logo_petit_coeur_48_noir.png') as ImageSourcePropType;
/** Cœur outline relief — noir (#1C1C1E), fond transparent. */
const LOGO_HEART_NOIR = require('@/assets/images/logo_petit_coeur_heart_relief_noir.png') as ImageSourcePropType;
/** Cœur outline relief — blanc, fond transparent. */
const LOGO_HEART_WHITE = require('@/assets/images/logo_petit_coeur_heart_relief_white.png') as ImageSourcePropType;

export type PetitCoeurLogoVariant =
  | 'color'
  | 'white'
  | 'whiteSolid'
  | 'noir'
  | 'heart'
  | 'heartNoir'
  | 'heartWhite';

type Props = {
  width: number;
  height: number;
  /**
   * Variante asset. Si omis : déduit de `color`
   * (clair → white, sombre → noir, sinon color).
   */
  variant?: PetitCoeurLogoVariant;
  /** @deprecated préfère `variant` — conservé pour splash / paywall legacy. */
  color?: string;
  /**
   * Zone sombre ovale à bords **radialement** diffus sous tout le lockup
   * (pas une silhouette lettre à lettre, pas un disque à bord net).
   */
  shadow?: boolean;
};

function resolveVariant(
  variant: PetitCoeurLogoVariant | undefined,
  color: string | undefined,
): PetitCoeurLogoVariant {
  if (variant) return variant;
  const c = (color ?? '').trim().toLowerCase();
  if (!c || c === '#1c1c1e' || c === '#1f1f23' || c === '#000' || c === '#000000') {
    return c ? 'noir' : 'color';
  }
  if (
    c === '#fff' ||
    c === '#ffffff' ||
    c === '#fefbfd' ||
    c === '#fafaf7' ||
    c.startsWith('rgba(255')
  ) {
    return 'white';
  }
  return 'color';
}

function sourceFor(variant: PetitCoeurLogoVariant): ImageSourcePropType {
  switch (variant) {
    case 'whiteSolid':
      return LOGO_WHITE_SOLID;
    case 'white':
      return LOGO_WHITE;
    case 'noir':
      return LOGO_NOIR;
    case 'heartWhite':
      return LOGO_HEART_WHITE;
    case 'heart':
    case 'heartNoir':
      return LOGO_HEART_NOIR;
    default:
      return LOGO_COLOR;
  }
}

function isHeartVariant(variant: PetitCoeurLogoVariant): boolean {
  return variant === 'heart' || variant === 'heartNoir' || variant === 'heartWhite';
}

/**
 * Lockup Petit Cœur — assets `logo_petit_coeur_48*.png`.
 * Taille via `width` + `aspectRatio` (évite l’écrasement width/height forcés).
 */
export default function PetitCoeurLogo({
  width,
  height: _height,
  variant,
  color,
  shadow = false,
}: Props) {
  const resolved = resolveVariant(variant, color);
  const source = sourceFor(resolved);
  const box = isHeartVariant(resolved) ? PETIT_COEUR_HEART_VIEWBOX : PETIT_COEUR_LOGO_VIEWBOX;
  const aspectRatio = box.width / box.height;
  const boxH = width / aspectRatio;
  const imgStyle = { width, height: boxH };

  /** Ovalle large — le fondu radial mange les bords (pas de contour visible). */
  const haloW = Math.round(width * 1.85);
  const haloH = Math.round(boxH * 2.85);
  const gradId = `logoHalo_${Math.round(width)}_${Math.round(boxH)}`;

  return (
    <View style={[styles.wrap, { width, height: boxH }]}>
      {shadow ? (
        <View
          pointerEvents="none"
          style={[
            styles.haloHost,
            {
              width: haloW,
              height: haloH,
              marginLeft: -(haloW - width) / 2,
              marginTop: -(haloH - boxH) / 2,
            },
          ]}
        >
          <Svg width={haloW} height={haloH}>
            <Defs>
              <RadialGradient
                id={gradId}
                cx="50%"
                cy="48%"
                rx="50%"
                ry="50%"
                fx="50%"
                fy="48%"
              >
                <Stop offset="0%" stopColor="#1C1C1E" stopOpacity={0.38} />
                <Stop offset="35%" stopColor="#1C1C1E" stopOpacity={0.22} />
                <Stop offset="62%" stopColor="#1C1C1E" stopOpacity={0.1} />
                <Stop offset="82%" stopColor="#1C1C1E" stopOpacity={0.035} />
                <Stop offset="100%" stopColor="#1C1C1E" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse
              cx={haloW / 2}
              cy={haloH / 2}
              rx={haloW / 2}
              ry={haloH / 2}
              fill={`url(#${gradId})`}
            />
          </Svg>
        </View>
      ) : null}
      <Image source={source} style={[styles.img, imgStyle]} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  img: {
    zIndex: 2,
  },
  haloHost: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 0,
  },
});

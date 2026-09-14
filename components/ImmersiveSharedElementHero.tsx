import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { VideoPlayer } from 'expo-video';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { PetitmoVideoView } from '@/components/PetitmoVideoView';

/**
 * Part de la course où le clone se fond dans la vignette au retour.
 * Plus haut, on verrait deux fois la photo décalée ; plus bas, le chrome claque.
 */
const LAND_FADE_PROGRESS = 0.09;
/** Le spring s’arrête à son seuil de repos, pas à zéro : finir le fondu avant. */
const LAND_FADE_END_PROGRESS = 0.02;

/**
 * Clone de la vignette : cadre qui s’ouvre / se referme.
 *
 * Vidéo / audio (`expandFrameOnly`) : calque à taille dest fixe + translate
 * (pas de resize Image/VideoView 60 fps).
 *
 * Photo : le calque Image **interpole** clip ↔ dest avec `progress`
 * (continuité cover fil → immersif — plus fluide ressenti que le diaphragme).
 *
 * Chrome Fil : masque `feedChromeTop/Bottom` quand `progress → 0`.
 */
export function ImmersiveSharedElementHero({
  uri,
  recyclingKey,
  fromX,
  fromY,
  fromW,
  fromH,
  toX,
  toY,
  toW,
  toH,
  progress,
  opacity,
  landFade,
  cornerRadius,
  player,
  videoHandoff = false,
  fitClipToThumb = false,
  surfaceYielded = false,
  expandFrameOnly = false,
  feedChromeTop = 0,
  feedChromeBottom = 0,
}: {
  uri: string;
  recyclingKey?: string;
  /** Rayon des coins hauts à l’état vignette ; 0 en plein écran. */
  cornerRadius: number;
  fromX: SharedValue<number>;
  fromY: SharedValue<number>;
  fromW: SharedValue<number>;
  fromH: SharedValue<number>;
  toX: SharedValue<number>;
  toY: SharedValue<number>;
  toW: SharedValue<number>;
  toH: SharedValue<number>;
  progress: SharedValue<number>;
  opacity: SharedValue<number>;
  /** 1 = retour vers la vignette : le clone s’efface sur la fin de la course. */
  landFade: SharedValue<number>;
  /** Même lecteur que le fil : le zoom montre la vidéo en cours, pas le poster. */
  player?: VideoPlayer | null;
  /**
   * Ouverture vidéo : jamais de repli `Image` (poster JPEG).
   * Sans ça le 1er paint du hero montre t≈0 figé avant le `VideoPlayer`.
   */
  videoHandoff?: boolean;
  /**
   * Retour vidéo : coller le calque aux bornes du clip (progress≈0) pour matcher
   * le cover fil avant le fondu. Pendant la course, rester en mode dest+translate.
   */
  fitClipToThumb?: boolean;
  /**
   * Retour : player détaché. Sur Android on montre le still `uri` (pas un trou
   * noir) le temps que le fil peigne. iOS ne yield en général pas.
   */
  surfaceYielded?: boolean;
  /**
   * Audio (cover) : uniquement le cadre s’élargit — calque media fixe à la dest.
   * Photo : laisser false (interpolation taille) — plus fluide à l’œil.
   */
  expandFrameOnly?: boolean;
  /** Bande header Fil (px fenêtre) — masque progressif vers la vignette. */
  feedChromeTop?: number;
  /** Bande tab bar (px fenêtre). */
  feedChromeBottom?: number;
}) {
  const liveVideo = !!player;
  const diaphragmMedia = liveVideo || expandFrameOnly;

  const chromeMaskStyle = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, 1 - progress.value));
    return {
      top: feedChromeTop * t,
      bottom: feedChromeBottom * t,
    };
  }, [feedChromeTop, feedChromeBottom]);

  const frameStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const t = Math.min(1, Math.max(0, 1 - p));
    const clipT = feedChromeTop * t;
    /** Le spring dépasse légèrement 1 : sans plancher, le rayon passerait négatif. */
    const radius = Math.max(0, cornerRadius * (1 - p));
    /**
     * Le clone n’a ni pastille date ni cœur : s’il tient jusqu’au démontage, le
     * chrome de la carte surgit d’un bloc. On le fond sur les derniers pourcents,
     * là où son cadre coïncide presque avec la vignette — le fondu ne se voit pas,
     * seul le chrome se révèle.
     */
    const landAlpha =
      landFade.value === 1
        ? Math.min(
            1,
            Math.max(
              0,
              (p - LAND_FADE_END_PROGRESS) /
                (LAND_FADE_PROGRESS - LAND_FADE_END_PROGRESS),
            ),
          )
        : 1;
    return {
      opacity: opacity.value * landAlpha,
      left: fromX.value + (toX.value - fromX.value) * p,
      top: fromY.value + (toY.value - fromY.value) * p - clipT,
      width: fromW.value + (toW.value - fromW.value) * p,
      height: fromH.value + (toH.value - fromH.value) * p,
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
    };
  }, [cornerRadius, feedChromeTop]);

  const mediaInnerStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const clipW = fromW.value + (toW.value - fromW.value) * p;
    const clipH = fromH.value + (toH.value - fromH.value) * p;
    const destW = toW.value;
    const destH = toH.value;

    if (diaphragmMedia) {
      if (fitClipToThumb && p < 0.02) {
        return {
          width: clipW,
          height: clipH,
          transform: [{ translateX: 0 }, { translateY: 0 }],
        };
      }
      return {
        width: destW,
        height: destH,
        transform: [
          { translateX: (clipW - destW) / 2 },
          { translateY: (clipH - destH) / 2 },
        ],
      };
    }

    /**
     * Photo : à p=0 le calque = vignette (comme le fil),
     * à p=1 = plein écran. Plus de recentrage d’un coup à l’atterrissage.
     */
    const mediaW = clipW + (destW - clipW) * p;
    const mediaH = clipH + (destH - clipH) * p;
    return {
      width: mediaW,
      height: mediaH,
      transform: [
        { translateX: (clipW - mediaW) / 2 },
        { translateY: (clipH - mediaH) / 2 },
      ],
    };
  }, [fitClipToThumb, diaphragmMedia]);

  const mediaLayer = player ? (
    <PetitmoVideoView
      player={player}
      contentFit="cover"
      style={StyleSheet.absoluteFillObject}
    />
  ) : videoHandoff && surfaceYielded ? (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      contentFit="cover"
      cachePolicy="memory-disk"
      priority="high"
      recyclingKey={recyclingKey ? `${recyclingKey}-yield` : undefined}
    />
  ) : videoHandoff ? (
    <View style={[StyleSheet.absoluteFillObject, styles.videoHandoffPlaceholder]} />
  ) : (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      contentFit="cover"
      cachePolicy="memory-disk"
      priority="high"
      recyclingKey={recyclingKey}
    />
  );

  return (
    <Animated.View
      style={[styles.chromeMask, chromeMaskStyle]}
      pointerEvents="none"
    >
      <Animated.View style={[styles.frame, frameStyle]} pointerEvents="none">
        <Animated.View style={[styles.mediaInner, mediaInnerStyle]}>
          {mediaLayer}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chromeMask: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 40,
  },
  frame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  mediaInner: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  videoHandoffPlaceholder: {
    backgroundColor: '#000000',
  },
});

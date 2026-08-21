import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import type { ReactNode } from 'react';
import { BlurView } from 'expo-blur';
import { Heart, MapPin, Volume2, VolumeX } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';
import { styles } from '@/components/feed/feedStyles';
import { loadedFontStyle } from '@/utils/loadedFontStyle';

/** Même logique que l’étiquette date (patch bas-droite) : blanc par défaut, noir si le serveur l’indique. */
export function feedPhotoOverlayInk(inkOverride?: string | null): '#FFFFFF' | '#0A0A0A' {
  const inkRaw = (inkOverride ?? '').trim().toUpperCase();
  if (inkRaw === '#0A0A0A' || inkRaw === '#FFFFFF') return inkRaw;
  return '#FFFFFF';
}

const FEED_FAVORITE_HEART_PX = scale(20);

const FEED_MEDIA_OVERLAY_BOTTOM = scale(12);

const FEED_META_PILL_INK = '#FFFFFF';

function FeedMetaGlassPill({
  children,
  onPress,
  accessibilityLabel,
  align = 'left',
  bare = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  align?: 'left' | 'right';
  /** Sans wrap largeur max (barre bas vidéo, etc.). */
  bare?: boolean;
}) {
  const pill = (
    <View
      style={[
        styles.feedMetaPill,
        align === 'right' ? styles.feedMetaPillAlignRight : styles.feedMetaPillAlignLeft,
      ]}
    >
      {Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
      ) : null}
      <View style={styles.feedMetaPillScrim} pointerEvents="none" />
      <View style={styles.feedMetaPillContent}>{children}</View>
    </View>
  );

  const wrapStyle =
    align === 'right' ? styles.feedMetaPillWrapRight : styles.feedMetaPillWrapLeft;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => [
          bare ? undefined : wrapStyle,
          pressed && { opacity: 0.88 },
        ]}
      >
        {pill}
      </Pressable>
    );
  }

  if (bare) return pill;

  return <View style={wrapStyle}>{pill}</View>;
}

/** Hauteur approx. pilule âge + gap — relève son/durée au-dessus de l’âge (bas-droite). */
export const FEED_AGE_PILL_STACK_RESERVE = scale(40);

/** Vidéo fil : son + durée en bas à droite, mêmes pilules verre que date / âge / lieu. */
export function FeedVideoDurationSoundBar({
  durationLabel,
  showSoundToggle,
  soundOn,
  onToggleSound,
  bottomInset = 0,
}: {
  durationLabel?: string;
  showSoundToggle: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  /** Relevé au-dessus de la pilule âge (même coin bas-droite). */
  bottomInset?: number;
}) {
  const hasDuration = !!durationLabel?.trim();
  if (!showSoundToggle && !hasDuration) return null;

  return (
    <View
      style={[
        styles.videoBottomControlsBar,
        bottomInset > 0 ? { bottom: FEED_MEDIA_OVERLAY_BOTTOM + bottomInset } : null,
      ]}
      pointerEvents="box-none"
    >
      {showSoundToggle ? (
        <FeedMetaGlassPill
          bare
          onPress={onToggleSound}
          accessibilityLabel={
            soundOn ? 'Couper le son de la vidéo' : 'Activer le son de la vidéo'
          }
        >
          {soundOn ? (
            <Volume2 size={scale(16)} color={FEED_META_PILL_INK} strokeWidth={2} />
          ) : (
            <VolumeX size={scale(16)} color={FEED_META_PILL_INK} strokeWidth={2} />
          )}
        </FeedMetaGlassPill>
      ) : null}
      {hasDuration ? (
        <FeedMetaGlassPill bare align="right">
          <Text style={styles.feedMetaPillDate}>{durationLabel}</Text>
        </FeedMetaGlassPill>
      ) : null}
    </View>
  );
}

/** Date (gauche) et lieu (droite) — pilules verre en haut du média. L’âge est en bas à droite (`FeedAgeOverlay`). */
export function FeedPostMetaOverlay({
  dateLabel,
  locationLabel,
  onEditLocation,
  showLocationEdit = true,
  feedDateFontFamily,
  feedLocationFilledFontFamily,
  feedLocationPlaceholderFontFamily,
  layout = 'overlay',
}: {
  dateLabel: string;
  locationLabel?: string;
  onEditLocation?: () => void;
  showLocationEdit?: boolean;
  feedDateFontFamily?: string;
  feedLocationFilledFontFamily?: string;
  feedLocationPlaceholderFontFamily?: string;
  /** `inline` : dans le flux (audio fil sans vignette) ; `overlay` : absolu sur la média. */
  layout?: 'overlay' | 'inline';
}) {
  const hasLocation = !!locationLabel?.trim();
  const showLocationPill = showLocationEdit || hasLocation;

  const barStyle = layout === 'inline' ? styles.feedMetaPillBarInline : styles.feedMetaPillBar;

  return (
    <View style={barStyle} pointerEvents="box-none">
      <FeedMetaGlassPill align="left">
        <Text
          style={[styles.feedMetaPillDate, loadedFontStyle(feedDateFontFamily)]}
          numberOfLines={1}
        >
          {dateLabel}
        </Text>
      </FeedMetaGlassPill>

      {showLocationPill ? (
        <FeedMetaGlassPill
          align="right"
          onPress={showLocationEdit && onEditLocation ? onEditLocation : undefined}
          accessibilityLabel={hasLocation ? 'Modifier le lieu' : 'Ajouter un lieu'}
        >
          <View style={styles.feedMetaPillInnerRow}>
            {hasLocation ? (
              <Text
                style={[
                  styles.feedMetaPillLocationText,
                  loadedFontStyle(feedLocationFilledFontFamily),
                ]}
                numberOfLines={2}
              >
                {locationLabel}
              </Text>
            ) : (
              <Text
                style={[
                  styles.feedMetaPillLocationText,
                  styles.feedMetaPillLocationPlaceholder,
                  loadedFontStyle(feedLocationPlaceholderFontFamily),
                ]}
                numberOfLines={1}
              >
                Lieu
              </Text>
            )}
            {showLocationEdit ? (
              <MapPin size={scale(14)} color={FEED_META_PILL_INK} strokeWidth={2} />
            ) : null}
          </View>
        </FeedMetaGlassPill>
      ) : null}
    </View>
  );
}

/** Âge / prénom famille en bas à droite du média (pilule verre) — date reste en haut. */
export function FeedAgeOverlay({
  ageLabel,
  feedAgeFontFamily,
  bottomInset = 0,
  layout = 'overlay',
}: {
  ageLabel?: string;
  feedAgeFontFamily?: string;
  /** Relevé supplémentaire au-dessus du bas (ex. viewer immersif + safe area). */
  bottomInset?: number;
  /** `inline` : audio fil sans vignette. */
  layout?: 'overlay' | 'inline';
}) {
  const label = (ageLabel ?? '').trim();
  if (!label) return null;

  if (layout === 'inline') {
    return (
      <View style={styles.feedAgePillBarInline} pointerEvents="none">
        <FeedMetaGlassPill align="right" bare>
          <Text
            style={[styles.feedMetaPillAge, loadedFontStyle(feedAgeFontFamily)]}
            numberOfLines={2}
          >
            {label}
          </Text>
        </FeedMetaGlassPill>
      </View>
    );
  }

  return (
    <View
      style={[styles.feedAgePillBar, { bottom: FEED_MEDIA_OVERLAY_BOTTOM + bottomInset }]}
      pointerEvents="none"
    >
      <FeedMetaGlassPill align="right" bare>
        <Text
          style={[styles.feedMetaPillAge, loadedFontStyle(feedAgeFontFamily)]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </FeedMetaGlassPill>
    </View>
  );
}

/**
 * @deprecated Doublon de la date du haut (même `created_at`). Remplacé par `FeedAgeOverlay`.
 * Conservé pour compat éventuelle.
 */
export function CapturedAtOverlay({
  uriForAnalysis: _uriForAnalysis,
  label,
  inkOverride,
  bottomInset = 0,
}: {
  /** Conservé pour compatibilité appelants ; l’encre vient de `inkOverride` ou du blanc par défaut. */
  uriForAnalysis?: string;
  label: string;
  inkOverride?: string | null;
  /** Relevé supplémentaire au-dessus du bas (ex. viewer immersif + safe area). */
  bottomInset?: number;
}) {
  void _uriForAnalysis;
  const ink = feedPhotoOverlayInk(inkOverride);

  return (
    <View
      style={[
        styles.capturedOverlay,
        { maxWidth: '78%', alignSelf: 'flex-start', bottom: FEED_MEDIA_OVERLAY_BOTTOM + bottomInset },
      ]}
      pointerEvents="none"
    >
      <View style={styles.overlayBadge}>
        <Text
          style={[styles.capturedOverlayText, { color: ink, textAlign: 'left' as const }]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Favori sur média : même rendu que dans le fil (FilMemoryRow). */
export function FeedPhotoFavoriteOverlay({
  isFavorite,
  inkOverride,
  onPress,
  bottomInset = 0,
}: {
  isFavorite: boolean;
  inkOverride?: string | null;
  onPress: () => void;
  /** Relevé supplémentaire au-dessus du bas (ex. viewer immersif + safe area). */
  bottomInset?: number;
}) {
  void inkOverride;
  const outlineInk = '#FFFFFF' as const;
  const favoriteFill = THEME.brandCtaOrange;

  return (
    <View
      style={[
        styles.feedPhotoFavoriteOverlay,
        { bottom: FEED_MEDIA_OVERLAY_BOTTOM + bottomInset },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={isFavorite ? 'Retirer des favoris' : 'Mettre en favori'}
        style={[styles.feedFavoriteMediaCircle, isFavorite && styles.feedFavoriteMediaCircleActive]}
      >
        <Heart
          size={FEED_FAVORITE_HEART_PX}
          color={isFavorite ? favoriteFill : outlineInk}
          strokeWidth={isFavorite ? 2.05 : 2.45}
          fill={isFavorite ? favoriteFill : 'none'}
        />
      </TouchableOpacity>
    </View>
  );
}

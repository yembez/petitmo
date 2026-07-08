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

/** Vidéo fil : son + durée en bas à droite, mêmes pilules verre que date / âge / lieu. */
export function FeedVideoDurationSoundBar({
  durationLabel,
  showSoundToggle,
  soundOn,
  onToggleSound,
}: {
  durationLabel?: string;
  showSoundToggle: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  const hasDuration = !!durationLabel?.trim();
  if (!showSoundToggle && !hasDuration) return null;

  return (
    <View style={styles.videoBottomControlsBar} pointerEvents="box-none">
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

/** Date + âge (gauche) et lieu (droite) — pilules verre avec contraste fort. */
export function FeedPostMetaOverlay({
  dateLabel,
  ageLabel,
  locationLabel,
  onEditLocation,
  showLocationEdit = true,
  feedDateFontFamily,
  feedAgeFontFamily,
  feedLocationFilledFontFamily,
  feedLocationPlaceholderFontFamily,
}: {
  dateLabel: string;
  ageLabel?: string;
  locationLabel?: string;
  onEditLocation?: () => void;
  showLocationEdit?: boolean;
  feedDateFontFamily?: string;
  feedAgeFontFamily?: string;
  feedLocationFilledFontFamily?: string;
  feedLocationPlaceholderFontFamily?: string;
}) {
  const hasLocation = !!locationLabel?.trim();
  const showLocationPill = showLocationEdit || hasLocation;

  return (
    <View style={styles.feedMetaPillBar} pointerEvents="box-none">
      <FeedMetaGlassPill align="left">
        <View style={styles.feedMetaPillInnerColumn}>
          <Text
            style={[styles.feedMetaPillDate, feedDateFontFamily ? { fontFamily: feedDateFontFamily } : null]}
            numberOfLines={1}
          >
            {dateLabel}
          </Text>
          {!!ageLabel?.trim() ? (
            <Text
              style={[styles.feedMetaPillAge, feedAgeFontFamily ? { fontFamily: feedAgeFontFamily } : null]}
              numberOfLines={1}
            >
              {ageLabel}
            </Text>
          ) : null}
        </View>
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
                  feedLocationFilledFontFamily ? { fontFamily: feedLocationFilledFontFamily } : null,
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
                  feedLocationPlaceholderFontFamily
                    ? { fontFamily: feedLocationPlaceholderFontFamily }
                    : null,
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

/** Pastille bas-gauche : date de prise (ou import vs prise selon règle fil). */
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
        { maxWidth: '78%', alignSelf: 'flex-end', bottom: FEED_MEDIA_OVERLAY_BOTTOM + bottomInset },
      ]}
      pointerEvents="none"
    >
      <View style={styles.overlayBadge}>
        <Text
          style={[styles.capturedOverlayText, { color: ink, textAlign: 'right' as const }]}
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

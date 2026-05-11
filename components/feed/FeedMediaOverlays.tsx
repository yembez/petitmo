import { View, Text, TouchableOpacity } from 'react-native';
import { Heart } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';
import { useDominantImageColors } from '@/hooks/useDominantImageColors';
import { styles } from '@/components/feed/feedStyles';

/** Même logique que l’étiquette date (patch bas-droite) : blanc par défaut, noir si le serveur l’indique. */
export function feedPhotoOverlayInk(inkOverride?: string | null): '#FFFFFF' | '#0A0A0A' {
  const inkRaw = (inkOverride ?? '').trim().toUpperCase();
  if (inkRaw === '#0A0A0A' || inkRaw === '#FFFFFF') return inkRaw;
  return '#FFFFFF';
}

const FEED_FAVORITE_HEART_PX = scale(20);

/** Pastille bas-gauche : date de prise (ou import vs prise selon règle fil). */
export function CapturedAtOverlay({
  uriForAnalysis,
  label,
  inkOverride,
}: {
  uriForAnalysis: string;
  label: string;
  inkOverride?: string | null;
}) {
  useDominantImageColors(uriForAnalysis);
  const ink = feedPhotoOverlayInk(inkOverride);

  return (
    <View style={[styles.capturedOverlay, { maxWidth: '78%', alignSelf: 'flex-end' }]} pointerEvents="none">
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
}: {
  isFavorite: boolean;
  inkOverride?: string | null;
  onPress: () => void;
}) {
  void inkOverride;
  const outlineInk = '#FFFFFF' as const;
  const terracotta = THEME.feedFavoriteTerracotta;

  return (
    <View style={styles.feedPhotoFavoriteOverlay} pointerEvents="box-none">
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
          color={isFavorite ? terracotta : outlineInk}
          strokeWidth={isFavorite ? 2.05 : 2.45}
          fill={isFavorite ? terracotta : 'none'}
        />
      </TouchableOpacity>
    </View>
  );
}

import { memo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ColorMatrix } from 'react-native-color-matrix-image-filters';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import type { Child } from '@/types/local';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';
import { childDisplayGivenName, childDisplayInitial } from '@/utils/childDisplayName';
import { formatCaptureChildAge } from '@/utils/date';
import { CAPTURE_HERO_COLOR_MATRIX } from '@/utils/captureHeroColorMatrix';
import {
  CAPTURE_HERO_IMAGE_CONTENT_POSITION,
  CAPTURE_HERO_IMAGE_OBJECT_POSITION,
} from '@/utils/captureHeroMetrics';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { computeCaptureMosaicRows } from '@/utils/captureMosaicLayout';

const TILE_GAP = scale(6);
const TILE_RADIUS = scale(20);
const TILE_NAME_FONT_SIZE = scale(13);

type CaptureFamilyMosaicProps = {
  familyChildren: Child[];
  onPressChild: (child: Child) => void;
  nameFontFamily?: string;
  ageFontFamily?: string;
  style?: StyleProp<ViewStyle>;
};

function captureTilePhotoRevision(child: Child): string {
  return `${(child.local_photo_path ?? '').trim()}|${(child.photo_url ?? '').trim()}|${(child.updated_at ?? '').trim()}`;
}

const CaptureMosaicTile = memo(function CaptureMosaicTile({
  child,
  onPress,
  nameFontFamily,
  ageFontFamily,
}: {
  child: Child;
  onPress: () => void;
  nameFontFamily?: string;
  ageFontFamily?: string;
}) {
  const displayUri = resolveChildProfileImageDisplayUri(
    child.local_photo_path,
    child.photo_url,
    child.updated_at,
  );
  const isLocal =
    !!displayUri &&
    (displayUri.startsWith('file:') ||
      displayUri.startsWith('content:') ||
      displayUri.startsWith('ph://') ||
      (!displayUri.startsWith('http://') && !displayUri.startsWith('https://')));
  const remoteBase =
    child && !isLocal
      ? resolveChildProfileImageDisplayUri(null, child.photo_url, child.updated_at)
      : null;
  const signedRemote = useSignedMediaUrl(remoteBase);
  const photoUri = displayUri
    ? isLocal
      ? displayUri
      : signedRemote ?? displayUri
    : '';
  const givenName = childDisplayGivenName(child.name) || 'Enfant';
  const ageLabel = child.birthdate ? formatCaptureChildAge(child.birthdate) : '';

  useEffect(() => {
    if (!photoUri.trim()) return;
    void ExpoImage.prefetch(photoUri).catch(() => {});
  }, [photoUri]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.tilePress}
      accessibilityRole="button"
      accessibilityLabel={`Modifier le profil de ${givenName}`}
    >
      {photoUri ? (
        Platform.OS === 'web' ? (
          <ExpoImage
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            contentPosition={CAPTURE_HERO_IMAGE_OBJECT_POSITION}
          />
        ) : (
          <ColorMatrix matrix={CAPTURE_HERO_COLOR_MATRIX} style={StyleSheet.absoluteFillObject}>
            <ExpoImage
              source={{ uri: photoUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              contentPosition={CAPTURE_HERO_IMAGE_CONTENT_POSITION}
              cachePolicy="memory-disk"
              recyclingKey={`capture-mosaic-${child.id}-${captureTilePhotoRevision(child)}`}
              transition={isLocal ? 0 : 180}
            />
          </ColorMatrix>
        )
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.tilePlaceholder]}>
          <Text style={styles.tilePlaceholderLetter}>{childDisplayInitial(child.name)}</Text>
        </View>
      )}
      <LinearGradient
        colors={['rgba(0, 0, 0, 0)', 'rgba(28, 28, 30, 0.45)', 'rgba(28, 28, 30, 0.72)']}
        locations={[0, 0.55, 1]}
        style={styles.tileScrim}
        pointerEvents="none"
      />
      <View style={styles.tileMeta} pointerEvents="none">
        <Text
          style={[styles.tileName, nameFontFamily ? { fontFamily: nameFontFamily } : null]}
          numberOfLines={1}
        >
          {givenName}
        </Text>
        {ageLabel ? (
          <Text
            style={[styles.tileAge, ageFontFamily ? { fontFamily: ageFontFamily } : null]}
            numberOfLines={1}
          >
            {ageLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

export function CaptureFamilyMosaic({
  familyChildren,
  onPressChild,
  nameFontFamily,
  ageFontFamily,
  style,
}: CaptureFamilyMosaicProps) {
  const rows = computeCaptureMosaicRows(familyChildren.length);
  let offset = 0;

  return (
    <View style={[styles.root, style]}>
      {rows.map((colsInRow, rowIndex) => {
        const rowChildren = familyChildren.slice(offset, offset + colsInRow);
        offset += colsInRow;
        return (
          <View
            key={`mosaic-row-${rowIndex}-${rowChildren.map(c => c.id).join('-')}`}
            style={[styles.row, rowIndex > 0 && { marginTop: TILE_GAP }]}
          >
            {rowChildren.map((child, colIndex) => (
              <View
                key={child.id}
                style={[
                  styles.tileShell,
                  colIndex > 0 && { marginLeft: TILE_GAP },
                  colsInRow === 1 ? styles.tileShellFull : styles.tileShellHalf,
                ]}
              >
                <CaptureMosaicTile
                  child={child}
                  onPress={() => onPressChild(child)}
                  nameFontFamily={nameFontFamily}
                  ageFontFamily={ageFontFamily}
                />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: TILE_GAP,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  tileShell: {
    flex: 1,
    borderRadius: TILE_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#E8E8ED',
    minHeight: verticalScale(120),
  },
  tileShellHalf: {
    flex: 1,
  },
  tileShellFull: {
    flex: 1,
  },
  tilePress: {
    flex: 1,
    minHeight: verticalScale(120),
  },
  tilePlaceholder: {
    backgroundColor: '#E8E8ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePlaceholderLetter: {
    fontSize: scale(40),
    fontWeight: '600',
    color: THEME.brandPrimarySoft,
  },
  tileScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '52%',
  },
  tileMeta: {
    position: 'absolute',
    left: scale(12),
    right: scale(12),
    bottom: verticalScale(12),
  },
  tileName: {
    fontSize: TILE_NAME_FONT_SIZE,
    lineHeight: scale(17),
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  tileAge: {
    marginTop: verticalScale(2),
    fontSize: scale(11),
    lineHeight: scale(14),
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.92)',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
});

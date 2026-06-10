import { memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { BookOpen } from 'lucide-react-native';
import BookPagePhotoFrame from '@/components/BookPagePhotoFrame';
import { useImagePixelSize } from '@/hooks/useImagePixelSize';
import type { PhotoCrop } from '@/src/book/photoCrop';
import { scale, verticalScale } from '@/utils/responsive';
import CoverPageSpineOverlay from '@/components/CoverPageSpineOverlay';
import {
  BOOK_COVER_PHOTO_HEIGHT_RATIO,
  BOOK_COVER_THEME_DEFAULT,
  BOOK_COVER_THEME_WARM,
  BOOK_COVER_THUMB_HEIGHT,
  BOOK_COVER_THUMB_WIDTH,
  type BookCoverColorTheme,
} from '@/constants/bookCoverThumbnail';

export type BookCoverThumbnailProps = {
  title: string;
  coverImageUri: string | null;
  /** Recadrage couverture (parité éditeur ↔ liste Livres). */
  coverPhotoCrop?: PhotoCrop;
  dateLabel?: string;
  colorTheme?: 'default' | 'warm' | BookCoverColorTheme;
  imageHeaders?: Record<string, string>;
  /** Clé stable expo-image (ex. id livre) — évite re-décodage au retour sur l’onglet. */
  imageRecyclingKey?: string;
  titleFontFamily?: string;
};

function resolveTheme(colorTheme: BookCoverThumbnailProps['colorTheme']): BookCoverColorTheme {
  if (colorTheme === 'warm') return BOOK_COVER_THEME_WARM;
  if (colorTheme && typeof colorTheme === 'object') return colorTheme;
  return BOOK_COVER_THEME_DEFAULT;
}

function BookCoverThumbnail({
  title,
  coverImageUri,
  coverPhotoCrop,
  dateLabel = '',
  colorTheme = 'default',
  imageHeaders,
  imageRecyclingKey,
  titleFontFamily,
}: BookCoverThumbnailProps) {
  const theme = resolveTheme(colorTheme);
  const garamondIt = titleFontFamily;

  const faceW = BOOK_COVER_THUMB_WIDTH;
  const faceH = BOOK_COVER_THUMB_HEIGHT;
  const photoH = faceH * BOOK_COVER_PHOTO_HEIGHT_RATIO;
  const textH = faceH - photoH;

  const uri = coverImageUri?.trim() || null;
  const imgSize = useImagePixelSize(coverPhotoCrop ? uri : null);
  const useCoverCrop = !!coverPhotoCrop && !!uri && !!imgSize;
  const imageSource =
    uri != null
      ? imageHeaders
        ? ({ uri, headers: imageHeaders } as const)
        : ({ uri } as const)
      : null;

  const coverTitle = title.trim() || 'Mon livre';

  return (
    <View style={styles.outer} pointerEvents="none">
      <View
        style={[
          styles.face,
          {
            width: faceW,
            height: faceH,
            backgroundColor: theme.paper,
            borderColor: theme.line,
          },
        ]}
      >
        <View style={[styles.photoZone, { height: photoH }]}>
          {useCoverCrop ? (
            <BookPagePhotoFrame
              uri={uri!}
              frameW={faceW}
              frameH={photoH}
              crop={coverPhotoCrop}
              coverMode
              imgPxW={imgSize.w}
              imgPxH={imgSize.h}
            />
          ) : imageSource ? (
            <Image
              source={imageSource}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={imageRecyclingKey ?? uri}
              transition={0}
            />
          ) : (
            <View style={[styles.placeholder, { backgroundColor: theme.placeholder }]}>
              <BookOpen size={scale(22)} color={theme.muted} strokeWidth={2} />
            </View>
          )}
        </View>
        <View style={[styles.textZone, { height: textH, paddingHorizontal: scale(8) }]}>
          <Text
            style={[
              styles.coverTitle,
              { color: theme.ink },
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
            numberOfLines={2}
          >
            {coverTitle}
          </Text>
          {dateLabel.trim() ? (
            <Text style={[styles.coverDate, { color: theme.muted }]} numberOfLines={1}>
              {dateLabel.trim()}
            </Text>
          ) : null}
          <View style={[styles.hairline, { backgroundColor: theme.line }]} />
        </View>
        <CoverPageSpineOverlay />
      </View>
    </View>
  );
}

export default memo(BookCoverThumbnail);

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(4) },
        shadowOpacity: 0.14,
        shadowRadius: scale(10),
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  face: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoZone: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textZone: {
    justifyContent: 'center',
    paddingTop: verticalScale(6),
    paddingBottom: verticalScale(4),
  },
  coverTitle: {
    fontSize: scale(11),
    lineHeight: scale(14),
    fontWeight: '400',
  },
  coverDate: {
    marginTop: verticalScale(3),
    fontSize: scale(8),
    fontWeight: '500',
  },
  hairline: {
    marginTop: verticalScale(5),
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});

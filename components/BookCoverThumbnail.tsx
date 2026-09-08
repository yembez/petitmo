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
  BOOK_COVER_THUMB_HEIGHT,
  BOOK_COVER_THUMB_WIDTH,
  type BookCoverColorTheme,
} from '@/constants/bookCoverThumbnail';
import {
  bookCoverThemeForId,
  COVER_HAIRLINE_W_MM,
  COVER_PHOTO_FRAME_H_MM,
  COVER_PHOTO_INSET_MM,
  COVER_PHOTO_TOP_MM,
  COVER_TEXT_GAP_MM,
  DEFAULT_BOOK_COVER_COLOR_ID,
  parseBookCoverColorId,
  type BookCoverColorId,
} from '@/constants/bookCoverColors';
import { BOOK_DIGITAL_PAGE_WIDTH_MM, BOOK_DIGITAL_PAGE_HEIGHT_MM } from '@/src/book/pdfPreviewTypo';

export type BookCoverThumbnailProps = {
  title: string;
  coverImageUri: string | null;
  /** Recadrage couverture (parité éditeur ↔ liste Livres). */
  coverPhotoCrop?: PhotoCrop;
  dateLabel?: string;
  /** Id palette couverture, ou thème legacy `warm` / objet. */
  colorTheme?: 'default' | 'warm' | BookCoverColorId | BookCoverColorTheme;
  coverColorId?: BookCoverColorId | string | null;
  imageHeaders?: Record<string, string>;
  /** Clé stable expo-image (ex. id livre) — évite re-décodage au retour sur l’onglet. */
  imageRecyclingKey?: string;
  /** Serif du livre (`@/constants/bookSerifFont`) — parité maquette ↔ PDF. */
  titleFontFamily?: string;
  periodFontFamily?: string;
};

function resolveTheme(
  colorTheme: BookCoverThumbnailProps['colorTheme'],
  coverColorId?: BookCoverThumbnailProps['coverColorId'],
): BookCoverColorTheme {
  if (coverColorId != null && String(coverColorId).trim()) {
    return bookCoverThemeForId(coverColorId);
  }
  if (colorTheme === 'warm') return bookCoverThemeForId('cream');
  if (typeof colorTheme === 'string' && colorTheme !== 'default') {
    return bookCoverThemeForId(parseBookCoverColorId(colorTheme));
  }
  if (colorTheme && typeof colorTheme === 'object') return colorTheme;
  return bookCoverThemeForId(DEFAULT_BOOK_COVER_COLOR_ID);
}

function BookCoverThumbnail({
  title,
  coverImageUri,
  coverPhotoCrop,
  dateLabel = '',
  colorTheme = 'default',
  coverColorId,
  imageHeaders,
  imageRecyclingKey,
  titleFontFamily,
  periodFontFamily,
}: BookCoverThumbnailProps) {
  const theme = resolveTheme(colorTheme, coverColorId);

  const faceW = BOOK_COVER_THUMB_WIDTH;
  const faceH = BOOK_COVER_THUMB_HEIGHT;
  const insetX = Math.round((faceW * COVER_PHOTO_INSET_MM) / BOOK_DIGITAL_PAGE_WIDTH_MM);
  const insetTop = Math.round((faceH * COVER_PHOTO_TOP_MM) / BOOK_DIGITAL_PAGE_HEIGHT_MM);
  const frameW = Math.max(1, faceW - 2 * insetX);
  const frameH = Math.round((faceH * COVER_PHOTO_FRAME_H_MM) / BOOK_DIGITAL_PAGE_HEIGHT_MM);
  const textGap = Math.round((faceH * COVER_TEXT_GAP_MM) / BOOK_DIGITAL_PAGE_HEIGHT_MM);
  const hairlineW = Math.round((faceW * COVER_HAIRLINE_W_MM) / BOOK_DIGITAL_PAGE_WIDTH_MM);

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
        <View
          style={[
            styles.photoZone,
            {
              width: frameW,
              height: frameH,
              marginTop: insetTop,
              marginLeft: insetX,
            },
          ]}
        >
          {useCoverCrop ? (
            <BookPagePhotoFrame
              uri={uri!}
              frameW={frameW}
              frameH={frameH}
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
        <View style={[styles.textZone, { paddingLeft: insetX, paddingRight: insetX, paddingTop: textGap }]}>
          <Text
            style={[
              styles.coverTitle,
              { color: theme.ink },
              titleFontFamily ? { fontFamily: titleFontFamily } : { fontStyle: 'italic' },
            ]}
            numberOfLines={2}
          >
            {coverTitle}
          </Text>
          {dateLabel.trim() ? (
            <Text
              style={[
                styles.coverDate,
                { color: theme.muted },
                periodFontFamily ? { fontFamily: periodFontFamily } : null,
              ]}
              numberOfLines={1}
            >
              {dateLabel.trim()}
            </Text>
          ) : null}
          <View style={[styles.hairline, { backgroundColor: theme.line, width: hairlineW }]} />
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
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textZone: {
    flex: 1,
    justifyContent: 'flex-start',
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
  },
});

import { memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { BookOpen } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { scale, verticalScale } from '@/utils/responsive';
import {
  BOOK_COVER_PHOTO_HEIGHT_RATIO,
  BOOK_COVER_SPINE_WIDTH,
  BOOK_COVER_THEME_DEFAULT,
  BOOK_COVER_THEME_WARM,
  BOOK_COVER_THUMB_HEIGHT,
  BOOK_COVER_THUMB_WIDTH,
  type BookCoverColorTheme,
} from '@/constants/bookCoverThumbnail';

export type BookCoverThumbnailProps = {
  title: string;
  coverImageUri: string | null;
  dateLabel?: string;
  colorTheme?: 'default' | 'warm' | BookCoverColorTheme;
  imageHeaders?: Record<string, string>;
};

function resolveTheme(colorTheme: BookCoverThumbnailProps['colorTheme']): BookCoverColorTheme {
  if (colorTheme === 'warm') return BOOK_COVER_THEME_WARM;
  if (colorTheme && typeof colorTheme === 'object') return colorTheme;
  return BOOK_COVER_THEME_DEFAULT;
}

function BookCoverThumbnail({
  title,
  coverImageUri,
  dateLabel = '',
  colorTheme = 'default',
  imageHeaders,
}: BookCoverThumbnailProps) {
  const theme = resolveTheme(colorTheme);
  const [fontsLoaded] = useFonts({ EBGaramond_400Regular_Italic });
  const garamondIt = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const faceW = BOOK_COVER_THUMB_WIDTH;
  const faceH = BOOK_COVER_THUMB_HEIGHT;
  const photoH = faceH * BOOK_COVER_PHOTO_HEIGHT_RATIO;
  const textH = faceH - photoH;

  const uri = coverImageUri?.trim() || null;
  const imageSource =
    uri != null
      ? imageHeaders
        ? ({ uri, headers: imageHeaders } as const)
        : ({ uri } as const)
      : null;

  const coverTitle = title.trim() || 'Mon livre';

  return (
    <View style={styles.outer} pointerEvents="none">
      <View style={[styles.spine, { width: BOOK_COVER_SPINE_WIDTH, height: faceH }]}>
        <LinearGradient
          colors={[theme.spineStart, theme.spineEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
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
          {imageSource ? (
            <Image
              source={imageSource}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="disk"
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
  spine: {
    overflow: 'hidden',
  },
  face: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoZone: {
    width: '100%',
    overflow: 'hidden',
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

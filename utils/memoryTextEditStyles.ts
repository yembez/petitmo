import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { scale, verticalScale } from '@/utils/responsive';
import {
  TEXT_POST_CARD_INSET,
  TEXT_POST_CARD_RADIUS,
  TEXT_POST_GUTTER,
} from '@/constants/feedLayout';

export type MemoryTextEditPreviewVariant = 'feed-text' | 'feed-caption' | 'book';

/** Variante fil selon le type de souvenir édité. */
export function feedMemoryTextEditPreviewVariant(memoryType: string | undefined): MemoryTextEditPreviewVariant {
  return memoryType === 'text' ? 'feed-text' : 'feed-caption';
}

const FEED_TEXT_FS = scale(17);
const FEED_TEXT_LH = scale(22);
const FEED_CAPTION_FS = scale(16);
const FEED_CAPTION_LH = scale(21);
/** Parité livre `.memory-text` (×15/16, interligne ~1,588). */
const BOOK_BODY_FS = scale((17 * 15) / 16);
const BOOK_BODY_LH = scale(((17 * 15) / 16) * 1.588);

const platformTextBreak: Pick<TextStyle, 'textBreakStrategy'> = Platform.select({
  android: { textBreakStrategy: 'highQuality' },
  default: {},
}) as Pick<TextStyle, 'textBreakStrategy'>;

/**
 * Typo du champ de saisie — alignée fil / livre.
 * NB : les modales de saisie n'utilisent **jamais** la typo Garamond (réservée au rendu livre) ;
 * elles restent sur la police courante des souvenirs.
 */
export function memoryTextEditInputStyle(
  variant: MemoryTextEditPreviewVariant,
  fontFamily: string,
): TextStyle {
  if (variant === 'feed-caption') {
    return {
      fontFamily,
      fontSize: FEED_CAPTION_FS,
      lineHeight: FEED_CAPTION_LH,
      fontWeight: '400',
      fontStyle: 'normal',
      color: '#1C1C1E',
      textAlign: 'justify',
      ...platformTextBreak,
    };
  }

  if (variant === 'book') {
    return {
      fontFamily,
      fontSize: BOOK_BODY_FS,
      lineHeight: BOOK_BODY_LH,
      fontWeight: '400',
      fontStyle: 'normal',
      color: '#1C1C1E',
      textAlign: 'justify',
      ...platformTextBreak,
    };
  }

  return {
    fontFamily,
    fontSize: FEED_TEXT_FS,
    lineHeight: FEED_TEXT_LH,
    fontWeight: '400',
    fontStyle: 'normal',
    color: '#1C1C1E',
    textAlign: 'justify',
    ...platformTextBreak,
  };
}

/** Cartouche blanc du fil (post texte ou légende). */
export function memoryTextEditChromeStyle(variant: MemoryTextEditPreviewVariant): ViewStyle {
  if (variant === 'feed-caption') {
    return {
      flex: 1,
      minHeight: 0,
      backgroundColor: '#FFFFFF',
      paddingTop: verticalScale(14),
      paddingBottom: verticalScale(12),
      paddingHorizontal: scale(16),
    };
  }

  if (variant === 'book') {
    return {
      flex: 1,
      minHeight: 0,
      backgroundColor: '#FFFFFF',
      paddingHorizontal: scale(20),
      paddingVertical: verticalScale(24),
    };
  }

  return {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#FFFFFF',
    marginHorizontal: TEXT_POST_CARD_INSET,
    borderRadius: TEXT_POST_CARD_RADIUS,
    paddingHorizontal: TEXT_POST_GUTTER,
    paddingVertical: verticalScale(28),
    borderWidth: Platform.OS === 'android' ? 0.5 : StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(3) },
        shadowOpacity: 0.05,
        shadowRadius: scale(12),
      },
      android: { elevation: 2 },
      default: {},
    }),
  };
}

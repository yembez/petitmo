import { Platform, StyleSheet } from 'react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { FONT_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';

/** Coins arrondis — CTA primaires (aligné écran Capturer). */
export const PETITMO_CTA_BORDER_RADIUS = scale(20);

/** Épaisseur du contour noir — entier uniquement (évite les bugs RN sur 0,75). */
export const PETITMO_CTA_BORDER_WIDTH = 1;

/** Relief doux — ne pas combiner `overflow: 'hidden'` sur le même nœud (iOS coupe l’ombre). */
export const PETITMO_CTA_SOFT_ELEVATION = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: verticalScale(3) },
    shadowOpacity: 0.09,
    shadowRadius: scale(10),
  },
  android: {
    elevation: 3,
  },
  default: {},
});

/** Spinner sur fond CTA rosé. */
export const PETITMO_CTA_SPINNER_COLOR = THEME.captureScreenCtaForeground;

/**
 * CTA primaire app : rosé charte (`THEME.brandPrimary`), liseré discret, coins `PETITMO_CTA_BORDER_RADIUS`.
 */
export const petitmoCtaStyles = StyleSheet.create({
  primary: {
    backgroundColor: THEME.captureScreenCtaBackground,
    borderRadius: PETITMO_CTA_BORDER_RADIUS,
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
    borderColor: THEME.captureCtaBorderColor,
    alignItems: 'center',
    justifyContent: 'center',
    ...(PETITMO_CTA_SOFT_ELEVATION as object),
  },
  primaryFullWidth: {
    width: '100%',
    paddingVertical: verticalScale(16),
  },
  primaryDisabled: {
    opacity: 0.5,
  },
  primaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: THEME.captureScreenCtaForeground,
  },
});

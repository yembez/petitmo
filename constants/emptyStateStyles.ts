import { StyleSheet } from 'react-native';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_BORDER_WIDTH } from '@/constants/petitmoCtaStyles';
import { scale, verticalScale } from '@/utils/responsive';

/** Disque icône — même gabarit que le « + » empty du Fil. */
export const EMPTY_STATE_ICON_DISC = scale(76);

/**
 * Empty states plein écran (Fil, Favoris…) — typo + couleurs charte.
 * Titre encre 20/600, sous-titre muted 16.
 */
export const emptyStateStyles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(28),
  },
  iconDisc: {
    width: EMPTY_STATE_ICON_DISC,
    height: EMPTY_STATE_ICON_DISC,
    borderRadius: EMPTY_STATE_ICON_DISC / 2,
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
    borderColor: THEME.captureCtaBorderColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(22),
  },
  title: {
    fontSize: scale(20),
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(10),
  },
  subtitle: {
    fontSize: scale(16),
    lineHeight: scale(23),
    color: THEME.textMuted,
    textAlign: 'center',
  },
});

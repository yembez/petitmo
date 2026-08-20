import { StyleSheet } from 'react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';

/**
 * Hauteur utile **icône + libellé** (zone onglets au-dessus du remplissage safe area).
 */
export const TAB_BAR_CONTENT_HEIGHT = verticalScale(28 + 3 + 12);

/** Padding au-dessus des onglets. */
export const TAB_BAR_PADDING_TOP = verticalScale(6);

/** Espace sous les libellés dans la zone onglets (au-dessus du bandeau safe). */
export const TAB_BAR_PADDING_BOTTOM_GAP = verticalScale(4);

/** Fond tab bar — beige écran Capturer (`THEME.tabBarBackground`). */
export const TAB_BAR_BACKGROUND = THEME.tabBarBackground;

/** Contour discret du bandeau flottant. */
export const TAB_BAR_CONTAINER_BORDER = 'rgba(60, 49, 38, 0.08)';

export const TAB_BAR_BORDER_WIDTH = StyleSheet.hairlineWidth;

/** Coins latéraux du bandeau — 0 = pleine largeur, bords droits au bord écran. */
export const TAB_BAR_CORNER_RADIUS = 0;

/** @deprecated alias — utiliser `TAB_BAR_CORNER_RADIUS`. */
export const TAB_BAR_TOP_CORNER_RADIUS = TAB_BAR_CORNER_RADIUS;

/** Marge latérale — 0 = tab bar bord à bord. */
export const TAB_BAR_FLOAT_SIDE_INSET = 0;

/** Décalage du bandeau par rapport au bas de l’écran quand pas de safe area. */
export const TAB_BAR_FLOAT_BOTTOM_OFFSET = verticalScale(4);

/** Hauteur de la zone onglets (icônes + libellés). */
export function getTabBarChromeHeight(): number {
  return TAB_BAR_PADDING_TOP + TAB_BAR_CONTENT_HEIGHT + TAB_BAR_PADDING_BOTTOM_GAP;
}

/** Bande blanche sous les onglets = safe area (plus de trou transparent). */
export function tabBarSafeFillHeight(insetsBottom: number): number {
  return Math.max(0, insetsBottom);
}

/** Hauteur totale du bandeau (chrome + remplissage safe). */
export function getTabBarTotalHeight(insetsBottom: number): number {
  return getTabBarChromeHeight() + tabBarSafeFillHeight(insetsBottom);
}

/** `paddingBottom` du conteneur : réserve la safe area sous les onglets. */
export function tabBarContentPaddingBottom(insetsBottom: number): number {
  return tabBarSafeFillHeight(insetsBottom);
}

/** Ancre du bandeau : collé au bas si safe area, sinon léger flottement. */
export function tabBarFloatBottomPosition(insetsBottom: number): number {
  return tabBarSafeFillHeight(insetsBottom) > 0 ? 0 : TAB_BAR_FLOAT_BOTTOM_OFFSET;
}

/** @deprecated alias — hauteur totale (réserves listes). */
export function getTabBarOuterHeight(insetsBottom: number): number {
  return getTabBarTotalHeight(insetsBottom);
}

/** Distance du bas de l’écran pour caler un overlay au-dessus de la tab bar. */
export function tabBarFloatingBottomInset(insetsBottom: number): number {
  return tabBarFloatBottomPosition(insetsBottom) + getTabBarTotalHeight(insetsBottom);
}

/**
 * Espace vertical à réserver sous les listes / bloc CTA capture quand la tab bar flotte au-dessus du contenu.
 */
export function tabBarFloatingOverlapPad(insetsBottom: number): number {
  return tabBarFloatingBottomInset(insetsBottom) + verticalScale(8);
}

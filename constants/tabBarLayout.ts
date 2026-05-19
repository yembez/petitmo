import { StyleSheet } from 'react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';

/**
 * Hauteur de la zone **icône + libellé** (entre le padding haut et le padding bas + safe area).
 * Ne pas confondre avec la hauteur totale du bandeau : voir `getTabBarOuterHeight`.
 */
export const TAB_BAR_CONTENT_HEIGHT = verticalScale(56);

/** Padding au-dessus des onglets (dans le bandeau). */
export const TAB_BAR_PADDING_TOP = verticalScale(6);

/** Espace sous les libellés, au-dessus de la zone home indicator (hors `insets.bottom`). */
export const TAB_BAR_PADDING_BOTTOM_GAP = verticalScale(6);

/** Fond du bandeau tab bar (maquette : blanc pur, pas off-white). */
export const TAB_BAR_BACKGROUND = THEME.bg;

/** Contour fin du bandeau blanc (container flottant). */
export const TAB_BAR_CONTAINER_BORDER = 'rgba(0, 0, 0, 0.1)';

export const TAB_BAR_BORDER_WIDTH = StyleSheet.hairlineWidth;

/** Rayon des coins du bandeau — maquette : arrondi modéré (moins prononcé qu’avant). */
export const TAB_BAR_CORNER_RADIUS = scale(14);

/** @deprecated alias — utiliser `TAB_BAR_CORNER_RADIUS`. */
export const TAB_BAR_TOP_CORNER_RADIUS = TAB_BAR_CORNER_RADIUS;

/**
 * Marges latérales quand la tab bar est en `position: 'absolute'`.
 */
export const TAB_BAR_FLOAT_SIDE_INSET = scale(12);

/** Décalage du bandeau par rapport au bas de l’écran (flottement type maquette). */
export const TAB_BAR_FLOAT_BOTTOM_OFFSET = verticalScale(4);

/** Rayon du carré lavande (onglet actif). */
export const TAB_ACTIVE_INNER_RADIUS = scale(12);

/**
 * Largeur fixe du carré jaune (onglet actif) — identique pour tous les onglets, indépendante du libellé.
 */
export const TAB_ACTIVE_PILL_WIDTH = scale(84);

/**
 * Hauteur totale du bandeau tab bar (padding compris + safe area basse).
 * À utiliser pour `tabBarStyle.height` afin d’éviter le rognage des libellés sous `overflow: 'hidden'`.
 */
export function getTabBarOuterHeight(insetsBottom: number): number {
  return (
    TAB_BAR_PADDING_TOP +
    TAB_BAR_CONTENT_HEIGHT +
    TAB_BAR_PADDING_BOTTOM_GAP +
    insetsBottom
  );
}

/** Distance du bas de l’écran pour caler un overlay au-dessus de la tab bar flottante. */
export function tabBarFloatingBottomInset(insetsBottom: number): number {
  return getTabBarOuterHeight(insetsBottom) + TAB_BAR_FLOAT_BOTTOM_OFFSET;
}

/**
 * Espace vertical à réserver sous les listes / bloc CTA capture quand la tab bar flotte au-dessus du contenu.
 */
export function tabBarFloatingOverlapPad(insetsBottom: number): number {
  return tabBarFloatingBottomInset(insetsBottom) + verticalScale(8);
}

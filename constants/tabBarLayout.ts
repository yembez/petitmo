import { scale, verticalScale } from '@/utils/responsive';

/**
 * Hauteur utile des icônes + libellés d’onglet (hors home indicator).
 * À garder aligné avec `app/(tabs)/_layout.tsx` (`tabBarStyle.height` = cette valeur + `insets.bottom`).
 */
export const TAB_BAR_CONTENT_HEIGHT = verticalScale(52);

/** Fond de la tab bar flottante (opaque). */
export const TAB_BAR_BACKGROUND = '#f5efee';

/** Couleur du liseré (anneau extérieur). */
export const TAB_BAR_BORDER_COLOR = '#000000';

/** Épaisseur du liseré (anneau autour du fond ; le noir est peint dans `tabBarBackground`, pas seulement sur le parent). */
export const TAB_BAR_BORDER_WIDTH = Math.max(1, Math.round(scale(1.5)));

/** Rayon des coins de la tab bar (pill flottante : les 4 angles). */
export const TAB_BAR_CORNER_RADIUS = scale(28);

/** @deprecated alias — utiliser `TAB_BAR_CORNER_RADIUS`. */
export const TAB_BAR_TOP_CORNER_RADIUS = TAB_BAR_CORNER_RADIUS;

/**
 * Marges latérales quand la tab bar est en `position: 'absolute'`.
 * L’espace à gauche / droite laisse voir le contenu de la scène sous la barre (coins arrondis visibles).
 */
export const TAB_BAR_FLOAT_SIDE_INSET = scale(14);

/**
 * Espace vertical à réserver sous les listes / bloc CTA capture quand la tab bar flotte au-dessus du contenu.
 */
export function tabBarFloatingOverlapPad(insetsBottom: number): number {
  return TAB_BAR_CONTENT_HEIGHT + insetsBottom + verticalScale(12);
}

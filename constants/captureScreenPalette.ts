/**
 * Palette — écran Capturer + accent marque action (rose → corail).
 */
export const CAPTURE_SCREEN_BG = '#FEFBF7';
export const CAPTURE_SCREEN_BG_RGB = { r: 254, g: 251, b: 247 } as const;

/**
 * Accent marque unie — spinners, tab actif, splash, icônes.
 * Distinct du dégradé CTA primaire (`#FD6F9F` → `#FD7D4D`).
 */
export const BRAND_ACTION_ACCENT = '#FD7764';
export const BRAND_ACTION_ACCENT_RGB = '253, 119, 100';
/** @deprecated nom historique — `BRAND_ACTION_ACCENT`. */
export const BRAND_ACTION_GREEN = BRAND_ACTION_ACCENT;
/** @deprecated — `BRAND_ACTION_ACCENT_RGB`. */
export const BRAND_ACTION_GREEN_RGB = BRAND_ACTION_ACCENT_RGB;
/** @deprecated alias — `BRAND_ACTION_ACCENT` */
export const CAPTURE_SCREEN_ACCENT = BRAND_ACTION_ACCENT;

/** Contour noir fin — usages legacy hors Capturer. */
export const CAPTURE_CTA_BORDER = '#1C1C1E';
/** Épaisseur contour legacy (disques / anneaux hors hero Capturer). */
export const CAPTURE_CTA_DISC_BORDER_WIDTH = 1.5;
/** Dégradé bleu → orange — anneaux avatar fil / tab « + » (plus sur le hero Capturer). */
export const CAPTURE_PHOTO_BORDER_GRADIENT = ['#599BFC', '#FD7D4D'] as const;

/**
 * Dégradés CTA Capturer — maquette (diagonale TL → BR).
 * Enregistrer : bleu → violet · Écrire : magenta → rose · Importer : rose → corail.
 */
export const CAPTURE_CTA_RECORD_GRADIENT = ['#599BFC', '#DB74CC'] as const;
export const CAPTURE_CTA_WRITE_GRADIENT = ['#E779CD', '#FC7299'] as const;
export const CAPTURE_CTA_IMPORT_GRADIENT = ['#FD6F9F', '#FD7D4D'] as const;
/**
 * Dégradé CTA primaire app (remplace l’ancien vert partout : boutons, save, modales…).
 * Même couple que « Importer » Capturer.
 */
export const BRAND_ACTION_GRADIENT = CAPTURE_CTA_IMPORT_GRADIENT;
/** Positions le long de la diagonale : pure → transition → pure. */
export const CAPTURE_CTA_GRADIENT_LOCATIONS = [0, 0.28, 0.72, 1] as const;

/** @deprecated solid — milieu dégradé Écrire (fallback / thème). */
export const CAPTURE_CTA_WRITE = CAPTURE_CTA_WRITE_GRADIENT[1];
/** Rose accent — cœur titre + départ Importer / CTA primaire. */
export const CAPTURE_CTA_IMPORT = CAPTURE_CTA_IMPORT_GRADIENT[0];
/** Cœur dans le titre Capturer. */
export const CAPTURE_TITLE_HEART = CAPTURE_CTA_IMPORT;
/** Point pilule âge hero. */
export const CAPTURE_PILL_AGE_DOT = BRAND_ACTION_ACCENT;
/** Icône + libellé onglet actif tab bar. */
export const CAPTURE_TAB_ACTIVE = BRAND_ACTION_ACCENT;

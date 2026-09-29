/**
 * Palette — écran Capturer + accent marque action (bleu → rose → corail).
 */
export const CAPTURE_SCREEN_BG = '#FEFBF7';
export const CAPTURE_SCREEN_BG_RGB = { r: 254, g: 251, b: 247 } as const;

/**
 * Accent marque unie — spinners, tab actif, splash letterbox fallback, icônes.
 * Distinct du dégradé CTA Capturer (bleu → rose → corail).
 */
export const BRAND_ACTION_ACCENT = '#FD7764';
export const BRAND_ACTION_ACCENT_RGB = '253, 119, 100';
/**
 * Splash / boot natif + `SplashAnimation` —
 * même famille que le CTA primaire (`BRAND_ACTION_GRADIENT`), un cran plus soutenu :
 * rose/fuchsia → corail CTA → corail logo (sans orangé soft).
 * LinearGradient : `#FD628D` → `#FD6764` → `#FA5D4E`.
 * Image native = bilinear (`scripts/generate-splash-assets.py`).
 */
export const BRAND_SPLASH_GRADIENT = ['#FD628D', '#FD6764', '#FA5D4E'] as const;
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
 * Dégradés CTA Capturer — arc riche d’origine (diagonale TL→BR), lu L→R :
 * Enregistrer bleu→violet · Écrire magenta→rose · Importer rose→corail.
 * Ne pas remplacer par le L−3 splash (réservé aux CTA app hors Capturer).
 */
export const CAPTURE_CTA_RECORD_GRADIENT = ['#6B8FF5', '#DB74CC'] as const;
export const CAPTURE_CTA_WRITE_GRADIENT = ['#E779CD', '#FC7299'] as const;
export const CAPTURE_CTA_IMPORT_GRADIENT = ['#FD6F9F', '#FD7D4D'] as const;

/**
 * CTA primaire app (`PetitmoPrimaryPressable` / Morph / paywall « S’abonner »…).
 * Rose → corail L−3 — distinct du dégradé splash diagonal et des 3 disques Capturer.
 */
export const BRAND_ACTION_GRADIENT = ['#FD628D', '#FD6764'] as const;
/** @deprecated alias — `BRAND_ACTION_GRADIENT`. */
export const CAPTURE_CTA_BRAND_GRADIENT = BRAND_ACTION_GRADIENT;
/**
 * Positions le long de la diagonale : pure → transition → pure.
 * Plateau de départ court (moins de bleu uni sur Enregistrer).
 */
export const CAPTURE_CTA_GRADIENT_LOCATIONS = [0, 0.12, 0.58, 1] as const;

/** @deprecated solid — milieu dégradé Écrire (fallback / thème). */
export const CAPTURE_CTA_WRITE = CAPTURE_CTA_WRITE_GRADIENT[1];
/** Rose accent — départ disque Importer (dégradé). */
export const CAPTURE_CTA_IMPORT = CAPTURE_CTA_IMPORT_GRADIENT[0];
/**
 * Corail icônes CTA Capturer outline (`THEME.brandPrimary`) —
 * cœur titre + onglet tab bar actif.
 */
export const CAPTURE_CTA_ICON_CORAL = '#FC5757';
/** Cœur dans le titre Capturer. */
export const CAPTURE_TITLE_HEART = CAPTURE_CTA_ICON_CORAL;
/** Point pilule âge hero. */
export const CAPTURE_PILL_AGE_DOT = BRAND_ACTION_ACCENT;
/** Icône + libellé onglet actif tab bar. */
export const CAPTURE_TAB_ACTIVE = CAPTURE_CTA_ICON_CORAL;




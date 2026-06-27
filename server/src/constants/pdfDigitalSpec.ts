/**
 * Format PDF Gelato 21×28 cm (portrait, ratio 3/4).
 * — digital : trim 210×280 mm, sans fond perdu ;
 * — print : trim + fond perdu Gelato 4 mm (218×288 mm page PDF).
 * Aligné avec `htmlBook` et `utils/bookPhotoPrintDpi.ts` (aperçu app).
 */
export const DIGITAL_PAGE_WIDTH_MM = 210;
export const DIGITAL_PAGE_HEIGHT_MM = 280;

/** Ratio largeur / hauteur trim (210/280 = 0.75). */
export const BOOK_PAGE_RATIO = DIGITAL_PAGE_WIDTH_MM / DIGITAL_PAGE_HEIGHT_MM;

/** Impression Gelato : fond perdu 4 mm autour du fond de coupe 210×280 mm. */
export const PRINT_BLEED_MM = 4;
export const PRINT_TRIM_WIDTH_MM = 210;
export const PRINT_TRIM_HEIGHT_MM = 280;
export const PRINT_PAGE_WIDTH_MM = PRINT_TRIM_WIDTH_MM + 2 * PRINT_BLEED_MM;
export const PRINT_PAGE_HEIGHT_MM = PRINT_TRIM_HEIGHT_MM + 2 * PRINT_BLEED_MM;

/**
 * Proportion bande photo couverture (142 mm sur trim historique 216 mm).
 * Multipliée par `--page-h` dans `htmlBook` — zones internes à recaler dans un prompt dédié.
 */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = 142 / 216;

/** Marge visuelle [M] — parité `pdfPreviewTypo.ts` / maquette app. */
export const BOOK_VISUAL_MARGIN_MM = 12;

/**
 * Marge horizontale dédiée aux **textes sous les médias** (photo pleine page, photo-note,
 * audio/vidéo QR) — plus large que `--pad-x` (15 mm). Parité `pdfPreviewTypo.ts`
 * (`PDF_MEDIA_TEXT_PAD_X_MM`).
 */
export const PDF_MEDIA_TEXT_PAD_X_MM = 22;
/** Hauteur bande `.pf-image` — 75 % de la page trim. */
export const PHOTO_FULL_BAND_HEIGHT_RATIO = 0.75;
/** Zone image utile photo-note (carré dans zone safe 186 mm). */
export const PHOTO_NOTE_INNER_MM = 186;
/** Hauteur bande `.pn-image` (padding 12 mm → intérieur 186×186 mm). */
export const PHOTO_NOTE_BAND_HEIGHT_MM =
  PHOTO_NOTE_INNER_MM + 2 * BOOK_VISUAL_MARGIN_MM;

/** Pied blanc fixe photo-full [FP] (date + légende courte). */
export const PHOTO_FULL_FP_FOOTER_MM = 45;

/** Hauteur zone image photo-full [FP] sur trim 280 mm → 235 mm. */
export const PHOTO_FULL_FP_IMAGE_HEIGHT_MM =
  DIGITAL_PAGE_HEIGHT_MM - PHOTO_FULL_FP_FOOTER_MM;

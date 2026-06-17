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

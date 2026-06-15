/**
 * Format PDF « lecture / écran » (A5 portrait, sans fond perdu).
 * Aligné avec `htmlBook` quand `exportMode === 'digital'`.
 */
export const DIGITAL_PAGE_WIDTH_MM = 148;
export const DIGITAL_PAGE_HEIGHT_MM = 210;

/** Impression : fond perdu 3 mm autour du fond de coupe 154×216 mm. */
export const PRINT_BLEED_MM = 3;
export const PRINT_TRIM_WIDTH_MM = 154;
export const PRINT_TRIM_HEIGHT_MM = 216;
export const PRINT_PAGE_WIDTH_MM = PRINT_TRIM_WIDTH_MM + 2 * PRINT_BLEED_MM;
export const PRINT_PAGE_HEIGHT_MM = PRINT_TRIM_HEIGHT_MM + 2 * PRINT_BLEED_MM;

/** Bande photo couverture = 142 mm sur page 216 mm (aligné maquette app). */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = 142 / 216;

/**
 * Options stables du picker galerie (`app/import-media.tsx`).
 *
 * Contrat produit :
 * - `exif: true` → `created_at` (date de prise) pour la pastille fil (`utils/feedCaptureOverlay.ts`).
 * - Ne pas passer `exif: false` sans rebuild natif + `expo-media-library` (voir `utils/mediaExif.ts`).
 * - Jamais d’`import` statique de `expo-media-library` (crash → route `import-media` absente).
 */
export const IMPORT_PHOTO_PICKER_OPTS = {
  allowsEditing: false as const,
  /** Qualité max à la sélection — dérivés thumb/display/print générés côté app. */
  quality: 1 as const,
  exif: true as const,
} as const;

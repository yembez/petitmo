import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Métadonnées à l’import photothèque.
 *
 * Garde-fous (ne pas régresser) :
 * 1. Picker : `IMPORT_PHOTO_PICKER_OPTS.exif` doit rester `true` tant que le binaire n’embarque pas
 *    `expo-media-library` (rebuild `npx expo run:ios` après ajout du plugin dans `app.json`).
 * 2. Module natif : import **dynamique** uniquement (`getMediaLibraryModule`) — jamais `import … from 'expo-media-library'` en tête de fichier.
 * 3. Fil : `created_at` ≠ `inserted_at` (≥ 90 s) pour afficher la pastille (`utils/feedCaptureOverlay.ts`).
 */

/**
 * Date/heure de prise depuis EXIF (souvent `DateTimeOriginal` format `YYYY:MM:DD HH:mm:ss`).
 */
export function parseExifCaptureDateIso(
  exif: Record<string, unknown> | null | undefined
): string | undefined {
  if (!exif || typeof exif !== 'object') return undefined;

  const raw =
    (exif.DateTimeOriginal as string | undefined) ||
    (exif.DateTimeDigitized as string | undefined) ||
    (exif.DateTime as string | undefined);

  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const tryIso = new Date(raw);
  if (!Number.isNaN(tryIso.getTime())) return tryIso.toISOString();

  return undefined;
}

export type ImportMetadata = {
  /** Date/heure de prise (ISO) si disponible dans les métadonnées */
  capturedAtIso?: string;
  /** Lieu : uniquement saisie manuelle dans le fil (plus de GPS / géocodage auto). */
  locationLabel?: string | null;
};

/**
 * À partir du résultat `exif` de expo-image-picker (`exif: true`).
 */
export function buildImportMetadataFromExif(
  exif: Record<string, unknown> | null | undefined
): ImportMetadata {
  const capturedAtIso = parseExifCaptureDateIso(exif ?? null);
  return { capturedAtIso, locationLabel: null };
}

/** Timestamp photothèque / fichier → ISO (secondes ou millisecondes depuis epoch). */
function captureTimestampToIso(raw: number): string | undefined {
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

type MediaLibraryModule = typeof import('expo-media-library');

let mediaLibraryLoadAttempted = false;
let mediaLibraryModule: MediaLibraryModule | null = null;

/**
 * Chargement paresseux : évite le crash si le binaire n’a pas été rebuild après `expo-media-library`.
 * (import statique → `Cannot find native module 'ExpoMediaLibrary'` et route `import-media` absente.)
 */
async function getMediaLibraryModule(): Promise<MediaLibraryModule | null> {
  if (mediaLibraryLoadAttempted) return mediaLibraryModule;
  mediaLibraryLoadAttempted = true;
  if (Platform.OS === 'web') return null;
  try {
    mediaLibraryModule = await import('expo-media-library');
    return mediaLibraryModule;
  } catch {
    mediaLibraryModule = null;
    return null;
  }
}

/**
 * Statut photothèque en lecture seule : l’accès se demande uniquement à l’onboarding
 * (`lib/onboardingPermissions.ts`), jamais depuis un chemin d’import.
 */
async function hasPhotoLibraryAccessAlready(): Promise<boolean> {
  try {
    const res = await ImagePicker.getMediaLibraryPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/**
 * Date de prise via `assetId` + MediaLibrary — utile quand `exif: false` sur le picker (après rebuild natif).
 * Repli seulement, et sans effet si l’accès a été refusé à l’onboarding.
 */
async function resolveCapturedAtFromLibraryAssetId(
  assetId: string | null | undefined
): Promise<string | undefined> {
  const id = assetId?.trim();
  if (!id || Platform.OS === 'web') return undefined;
  if (!(await hasPhotoLibraryAccessAlready())) return undefined;
  const MediaLibrary = await getMediaLibraryModule();
  if (!MediaLibrary) return undefined;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(id);
    return captureTimestampToIso(info.creationTime);
  } catch {
    return undefined;
  }
}

async function resolveCapturedAtFromLocalFileUri(uri: string): Promise<string | undefined> {
  try {
    const file = new FileSystem.File(uri);
    if (file.exists) {
      const ms = file.creationTime ?? file.modificationTime;
      if (ms != null) return captureTimestampToIso(ms);
    }
  } catch {
    // URI photothèque (ph://) ou copie temporaire sans métadonnées
  }
  return undefined;
}

/**
 * Métadonnées à l’import depuis un asset picker (photo ou vidéo).
 * Ordre : EXIF picker → photothèque (`assetId`, si module natif dispo) → dates fichier local.
 */
export async function buildImportMetadataFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  options?: { isVideo?: boolean }
): Promise<ImportMetadata> {
  void options;
  const meta = buildImportMetadataFromExif(asset.exif ?? undefined);
  if (meta.capturedAtIso) {
    return meta;
  }
  const fromLibrary = await resolveCapturedAtFromLibraryAssetId(asset.assetId ?? null);
  if (fromLibrary) {
    return { ...meta, capturedAtIso: fromLibrary };
  }
  if (Platform.OS === 'web') {
    return meta;
  }
  const fromFile = await resolveCapturedAtFromLocalFileUri(asset.uri);
  if (fromFile) {
    return { ...meta, capturedAtIso: fromFile };
  }
  return meta;
}

/** `true` après rebuild natif si `getAssetInfoAsync` est utilisable (tests / futur `exif: false`). */
export async function isMediaLibraryNativeLinked(): Promise<boolean> {
  return (await getMediaLibraryModule()) != null;
}

/**
 * Métadonnées à l’import photothèque.
 *
 * Garde-fous (ne pas régresser) :
 * 1. Picker : `IMPORT_PHOTO_PICKER_OPTS.exif` doit rester `true` tant que le binaire n’embarque pas
 *    `expo-media-library` (rebuild `npx expo run:ios` après ajout du plugin dans `app.json`).
 * 2. Module natif : import **dynamique** uniquement (`getMediaLibraryModule`) — jamais `import … from 'expo-media-library'` en tête de fichier.
 * 3. Ordre : fiche Photos (`assetId`) → EXIF fichier → (éviter date fichier ≈ maintenant).
 * 4. Lieu : EXIF GPS / MediaLibrary `location` → reverse geocode ; sinon vide (saisie manuelle fil).
 * 5. Accès lecture : demandé au premier Importer (`mediaLibraryOptIn`), pas à l’avatar / inscription.
 */
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { reverseGeocodeToPlaceLabel } from '@/lib/memoryLocation';

/** Copie tmp / sandbox souvent datée « maintenant » — inutile comme date de prise. */
const FILE_DATE_TOO_RECENT_MS = 120_000;

/** Convertit une valeur EXIF DMS (tableau ou nombre) + ref N/S/E/W en degrés décimaux */
function dmsToDecimal(value: unknown, ref: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || value.length < 1) return undefined;
  const nums = value
    .map(v => (typeof v === 'number' ? v : parseFloat(String(v))))
    .filter(n => !Number.isNaN(n));
  if (nums.length === 0) return undefined;
  let d = nums[0];
  if (nums.length >= 3) {
    d += nums[1] / 60 + nums[2] / 3600;
  } else if (nums.length === 2) {
    d += nums[1] / 60;
  }
  const r = typeof ref === 'string' ? ref.toUpperCase() : '';
  if (r === 'S' || r === 'W') d = -d;
  return d;
}

/**
 * Extrait lat/lng depuis l’objet EXIF renvoyé par expo-image-picker (Android / iOS).
 */
export function parseExifGps(exif: Record<string, unknown> | null | undefined): {
  latitude: number;
  longitude: number;
} | undefined {
  if (!exif || typeof exif !== 'object') return undefined;

  const lat = dmsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
  const lng = dmsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);

  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;

  return { latitude: lat, longitude: lng };
}

/** Offset EXIF `+01:00` / `-05:00` / `+0100` → minutes depuis UTC. */
function parseExifOffsetMinutes(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const m = raw.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return undefined;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return undefined;
  return sign * (hh * 60 + mm);
}

/**
 * Date/heure de prise depuis EXIF (souvent `DateTimeOriginal` format `YYYY:MM:DD HH:mm:ss`).
 * Respecte `OffsetTimeOriginal` / `OffsetTime` quand présents.
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
    const offsetMin =
      parseExifOffsetMinutes(exif.OffsetTimeOriginal) ??
      parseExifOffsetMinutes(exif.OffsetTimeDigitized) ??
      parseExifOffsetMinutes(exif.OffsetTime);
    if (offsetMin !== undefined) {
      const sign = offsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const oh = String(Math.floor(abs / 60)).padStart(2, '0');
      const om = String(abs % 60).padStart(2, '0');
      const date = new Date(
        `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`
      );
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    // Sans offset : interpréter comme heure locale de l’appareil (comportement historique).
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
  /** Ville (ou subdivision) si GPS EXIF / MediaLibrary + géocodage OK. */
  locationLabel?: string | null;
};

/**
 * À partir du résultat `exif` de expo-image-picker (`exif: true`).
 */
export async function buildImportMetadataFromExif(
  exif: Record<string, unknown> | null | undefined
): Promise<ImportMetadata> {
  const capturedAtIso = parseExifCaptureDateIso(exif ?? null);
  const gps = parseExifGps(exif ?? null);
  let locationLabel: string | null = null;
  if (gps) {
    locationLabel = await reverseGeocodeToPlaceLabel(gps.latitude, gps.longitude);
  }
  return { capturedAtIso, locationLabel };
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

/** Accès déjà accordé (Importer a pu le demander juste avant). */
async function hasPhotoLibraryAccessAlready(): Promise<boolean> {
  try {
    const res = await ImagePicker.getMediaLibraryPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/**
 * Date + GPS via `assetId` + MediaLibrary — source privilégiée (corrections dans Photos).
 */
async function resolveMetaFromLibraryAssetId(
  assetId: string | null | undefined
): Promise<{ capturedAtIso?: string; locationLabel?: string | null }> {
  const id = assetId?.trim();
  if (!id || Platform.OS === 'web') return {};
  if (!(await hasPhotoLibraryAccessAlready())) return {};
  const MediaLibrary = await getMediaLibraryModule();
  if (!MediaLibrary) return {};
  try {
    const info = await MediaLibrary.getAssetInfoAsync(id);
    const capturedAtIso = captureTimestampToIso(info.creationTime);
    let locationLabel: string | null = null;
    const loc = info.location;
    if (
      loc &&
      typeof loc.latitude === 'number' &&
      typeof loc.longitude === 'number' &&
      Number.isFinite(loc.latitude) &&
      Number.isFinite(loc.longitude)
    ) {
      locationLabel = await reverseGeocodeToPlaceLabel(loc.latitude, loc.longitude);
    }
    return { capturedAtIso, locationLabel };
  } catch {
    return {};
  }
}

/**
 * Date fichier locale — ignore si trop proche de « maintenant » (copie PHPicker / tmp).
 */
async function resolveCapturedAtFromLocalFileUri(uri: string): Promise<string | undefined> {
  try {
    const file = new FileSystem.File(uri);
    if (file.exists) {
      const ms = file.creationTime ?? file.modificationTime;
      if (ms == null) return undefined;
      const iso = captureTimestampToIso(ms);
      if (!iso) return undefined;
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return undefined;
      if (Math.abs(Date.now() - t) < FILE_DATE_TOO_RECENT_MS) return undefined;
      return iso;
    }
  } catch {
    // URI photothèque (ph://) ou copie temporaire sans métadonnées
  }
  return undefined;
}

/**
 * Métadonnées à l’import depuis un asset picker (photo ou vidéo).
 * Ordre : fiche Photos (`assetId`) → EXIF picker → date fichier (si pas ≈ maintenant).
 */
export async function buildImportMetadataFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  options?: { isVideo?: boolean }
): Promise<ImportMetadata> {
  void options;

  const fromLibrary = await resolveMetaFromLibraryAssetId(asset.assetId ?? null);
  if (fromLibrary.capturedAtIso && fromLibrary.locationLabel) {
    return fromLibrary;
  }

  const fromExif = await buildImportMetadataFromExif(asset.exif ?? undefined);
  const merged: ImportMetadata = {
    capturedAtIso: fromLibrary.capturedAtIso ?? fromExif.capturedAtIso,
    locationLabel: fromLibrary.locationLabel ?? fromExif.locationLabel ?? null,
  };
  if (merged.capturedAtIso) {
    return merged;
  }
  if (Platform.OS === 'web') {
    return merged;
  }
  const fromFile = await resolveCapturedAtFromLocalFileUri(asset.uri);
  if (fromFile) {
    return { ...merged, capturedAtIso: fromFile };
  }
  return merged;
}

/** `true` après rebuild natif si `getAssetInfoAsync` est utilisable (tests / futur `exif: false`). */
export async function isMediaLibraryNativeLinked(): Promise<boolean> {
  return (await getMediaLibraryModule()) != null;
}

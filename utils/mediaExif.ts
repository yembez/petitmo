import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

/** Convertit une valeur EXIF DMS (tableau ou nombre) + ref N/S/E/W en degrés décimaux */
function dmsToDecimal(
  value: unknown,
  ref: unknown
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || value.length < 1) return undefined;
  const nums = value.map(v => (typeof v === 'number' ? v : parseFloat(String(v)))).filter(n => !Number.isNaN(n));
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

/**
 * Libellé lieu à partir des coordonnées EXIF (géocodage inverse, sans position utilisateur).
 */
export async function reverseGeocodeExifCoordinates(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!geo) return null;
    /**
     * Fil : on affiche uniquement une « ville » (ou subdivision la plus proche),
     * sans région entre parenthèses.
     */
    const place =
      geo.city ||
      geo.district ||
      geo.subregion ||
      geo.region ||
      geo.country ||
      null;
    return place ? place.trim() || null : null;
  } catch {
    return null;
  }
}

export type ImportMetadata = {
  /** Date/heure de prise (ISO) si disponible dans les métadonnées */
  capturedAtIso?: string;
  /** Lieu lisible si GPS présent dans les métadonnées */
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
    locationLabel = await reverseGeocodeExifCoordinates(gps.latitude, gps.longitude);
  }
  return { capturedAtIso, locationLabel };
}

/**
 * Métadonnées à l’import depuis un asset picker (photo ou vidéo).
 * Les vidéos ont souvent peu ou pas d’EXIF : on retombe sur la date de création / modification du fichier local.
 */
export async function buildImportMetadataFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  options?: { isVideo?: boolean }
): Promise<ImportMetadata> {
  const meta = await buildImportMetadataFromExif(asset.exif ?? undefined);
  if (meta.capturedAtIso) {
    return meta;
  }
  if (Platform.OS === 'web') {
    return meta;
  }
  const asVideo = options?.isVideo ?? asset.type === 'video';
  if (!asVideo) {
    return meta;
  }
  try {
    const file = new FileSystem.File(asset.uri);
    if (file.exists) {
      const ms = file.creationTime ?? file.modificationTime;
      if (ms != null && Number.isFinite(ms)) {
        return { ...meta, capturedAtIso: new Date(ms).toISOString() };
      }
    }
  } catch {
    // URI type photothèque ou fichier inaccessible
  }
  return meta;
}

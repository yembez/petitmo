import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

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

/**
 * Métadonnées à l’import depuis un asset picker (photo ou vidéo).
 * Les vidéos ont souvent peu ou pas d’EXIF : on retombe sur la date de création / modification du fichier local.
 */
export async function buildImportMetadataFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  options?: { isVideo?: boolean }
): Promise<ImportMetadata> {
  const meta = buildImportMetadataFromExif(asset.exif ?? undefined);
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

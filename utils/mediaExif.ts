/**
 * Métadonnées à l’import photothèque (photo + vidéo).
 *
 * Garde-fous (ne pas régresser) :
 * 1. Picker : `IMPORT_PHOTO_PICKER_OPTS.exif` doit rester `true` tant que le binaire n’embarque pas
 *    `expo-media-library` (rebuild `npx expo run:ios` après ajout du plugin dans `app.json`).
 * 2. Module natif : import **dynamique** uniquement (`getMediaLibraryModule`) — jamais `import … from 'expo-media-library'` en tête de fichier.
 * 3. Ordre lieu : fiche Photos (`assetId` → location + EXIF `{GPS}`) → EXIF picker → geocode ville/région.
 * 4. Pas de GPS « maintenant » / pas de coords brutes affichées (pastille Lieu si KO).
 * 5. Accès lecture : demandé au premier Importer (`mediaLibraryOptIn`).
 */
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { placeLabelFromCoordinates } from '@/lib/memoryLocation';

/** Copie tmp / sandbox souvent datée « maintenant » — inutile comme date de prise. */
const FILE_DATE_TOO_RECENT_MS = 120_000;

type LatLng = { latitude: number; longitude: number };

/** Nombre EXIF (number | string | rationnel {numerator,denominator}). */
function exifNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseFloat(raw.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { numerator?: unknown; denominator?: unknown };
    const num = exifNumber(o.numerator);
    const den = exifNumber(o.denominator);
    if (num !== undefined && den !== undefined && den !== 0) return num / den;
  }
  return undefined;
}

/** Convertit une valeur EXIF DMS (tableau, rationnels ou nombre) + ref N/S/E/W en degrés décimaux */
function dmsToDecimal(value: unknown, ref: unknown): number | undefined {
  const asSingle = exifNumber(value);
  if (asSingle !== undefined && !Array.isArray(value)) return applyGpsRef(asSingle, ref);

  if (!Array.isArray(value) || value.length < 1) return undefined;
  const nums = value.map(v => exifNumber(v)).filter((n): n is number => n !== undefined);
  if (nums.length === 0) return undefined;
  let d = nums[0];
  if (nums.length >= 3) {
    d += nums[1] / 60 + nums[2] / 3600;
  } else if (nums.length === 2) {
    d += nums[1] / 60;
  }
  return applyGpsRef(d, ref);
}

function applyGpsRef(degrees: number, ref: unknown): number {
  let d = degrees;
  const r = typeof ref === 'string' ? ref.toUpperCase() : '';
  if (r === 'S' || r === 'W') d = -d;
  return d;
}

function normalizeLatLng(lat: number, lng: number): LatLng | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  return { latitude: lat, longitude: lng };
}

/** Lit lat/lng depuis un objet GPS (aplati GPS* ou ImageIO Latitude/Longitude). */
function latLngFromGpsObject(o: Record<string, unknown>): LatLng | undefined {
  const nLat =
    dmsToDecimal(o.GPSLatitude, o.GPSLatitudeRef) ??
    dmsToDecimal(o.Latitude, o.LatitudeRef) ??
    exifNumber(o.latitude) ??
    exifNumber(o.Latitude) ??
    exifNumber(o.lat);
  const nLng =
    dmsToDecimal(o.GPSLongitude, o.GPSLongitudeRef) ??
    dmsToDecimal(o.Longitude, o.LongitudeRef) ??
    exifNumber(o.longitude) ??
    exifNumber(o.Longitude) ??
    exifNumber(o.lng) ??
    exifNumber(o.lon);
  if (nLat === undefined || nLng === undefined) return undefined;
  return normalizeLatLng(nLat, nLng);
}

/**
 * Extrait lat/lng depuis EXIF picker / MediaLibrary (plusieurs formes iOS/Android).
 * MediaLibrary renvoie souvent `ciImage.properties` avec la clé ImageIO `"{GPS}"`.
 */
export function parseExifGps(exif: Record<string, unknown> | null | undefined): LatLng | undefined {
  if (!exif || typeof exif !== 'object') return undefined;

  const fromRoot = latLngFromGpsObject(exif);
  if (fromRoot) return fromRoot;

  // Imbriqué : `{GPS}` (ImageIO / MediaLibrary), gps, GPS, location…
  for (const key of Object.keys(exif)) {
    const nested = exif[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const keyNorm = key.replace(/[{}]/g, '').toLowerCase();
    if (
      keyNorm !== 'gps' &&
      keyNorm !== 'location' &&
      !keyNorm.includes('gps')
    ) {
      continue;
    }
    const n = latLngFromGpsObject(nested as Record<string, unknown>);
    if (n) return n;
  }

  return undefined;
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

async function labelFromGps(gps: LatLng | undefined): Promise<string | null> {
  if (!gps) return null;
  return placeLabelFromCoordinates(gps.latitude, gps.longitude);
}

/**
 * À partir du résultat `exif` de expo-image-picker (`exif: true`).
 */
export async function buildImportMetadataFromExif(
  exif: Record<string, unknown> | null | undefined
): Promise<ImportMetadata> {
  const capturedAtIso = parseExifCaptureDateIso(exif ?? null);
  const locationLabel = await labelFromGps(parseExifGps(exif ?? null));
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

/** Accès photothèque déjà accordé (full **ou** limited). */
async function hasPhotoLibraryAccessAlready(): Promise<boolean> {
  try {
    const res = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (res.granted) return true;
    if (res.status === 'limited' || res.accessPrivileges === 'limited') return true;
    if (res.accessPrivileges === 'all' || res.status === 'granted') return true;
  } catch {
    /* */
  }
  try {
    const MediaLibrary = await getMediaLibraryModule();
    if (!MediaLibrary) return false;
    const res = await MediaLibrary.getPermissionsAsync();
    if (res.granted) return true;
    if (res.accessPrivileges === 'limited' || (res as { status?: string }).status === 'limited') {
      return true;
    }
  } catch {
    /* */
  }
  return false;
}

/** Aligne la permission MediaLibrary (même entitlement Photos qu’ImagePicker). */
async function ensureMediaLibraryPermission(): Promise<boolean> {
  if (await hasPhotoLibraryAccessAlready()) return true;
  const MediaLibrary = await getMediaLibraryModule();
  if (!MediaLibrary) return false;
  try {
    const res = await MediaLibrary.requestPermissionsAsync();
    return !!res.granted || res.accessPrivileges === 'limited';
  } catch {
    return false;
  }
}

function coordsFromMediaLibraryLocation(loc: unknown): LatLng | undefined {
  if (!loc || typeof loc !== 'object') return undefined;
  const o = loc as { latitude?: unknown; longitude?: unknown };
  const lat = exifNumber(o.latitude);
  const lng = exifNumber(o.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return normalizeLatLng(lat, lng);
}

/** `ph://UUID/L0/001` → localIdentifier Photos. */
export function assetIdFromMediaUri(uri: string | null | undefined): string | null {
  const u = (uri ?? '').trim();
  if (!u) return null;
  if (u.startsWith('ph://')) {
    const id = u.slice('ph://'.length).split('?')[0]?.trim();
    return id || null;
  }
  // assets-library legacy — rare
  const m = u.match(/id=([^&]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);
  return null;
}

function resolveAssetId(
  assetId: string | null | undefined,
  uri?: string | null,
): string | null {
  const fromField = assetId?.trim() || null;
  if (fromField) return fromField;
  return assetIdFromMediaUri(uri);
}

/**
 * Date + GPS via `assetId` + MediaLibrary — source privilégiée (corrections dans Photos).
 */
async function resolveMetaFromLibraryAssetId(
  assetId: string | null | undefined,
  opts?: { uriHint?: string | null },
): Promise<{ capturedAtIso?: string; locationLabel?: string | null }> {
  const id = resolveAssetId(assetId, opts?.uriHint);
  if (!id || Platform.OS === 'web') return {};
  if (!(await ensureMediaLibraryPermission())) {
    console.warn('[importLocation] pas d’accès photothèque pour getAssetInfoAsync');
    return {};
  }
  const MediaLibrary = await getMediaLibraryModule();
  if (!MediaLibrary) {
    console.warn('[importLocation] ExpoMediaLibrary absent — rebuild natif requis');
    return {};
  }

  const readOnce = async (): Promise<{
    capturedAtIso?: string;
    locationLabel?: string | null;
    hadGps?: boolean;
  }> => {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(id, {
        shouldDownloadFromNetwork: true,
      });
      const capturedAtIso = captureTimestampToIso(info.creationTime);

      let gps = coordsFromMediaLibraryLocation(info.location);
      if (!gps && info.exif && typeof info.exif === 'object') {
        gps = parseExifGps(info.exif as Record<string, unknown>);
      }
      const locationLabel = await labelFromGps(gps);
      return { capturedAtIso, locationLabel, hadGps: !!gps };
    } catch (e) {
      console.warn('[importLocation] getAssetInfoAsync', id.slice(0, 24), e);
      return {};
    }
  };

  let out = await readOnce();
  if (out.locationLabel && out.capturedAtIso) return out;
  if (!out.locationLabel) {
    await new Promise<void>(r => setTimeout(r, 180));
    const retry = await readOnce();
    out = {
      capturedAtIso: out.capturedAtIso ?? retry.capturedAtIso,
      locationLabel: out.locationLabel ?? retry.locationLabel ?? null,
      hadGps: out.hadGps || retry.hadGps,
    };
  }
  if (out.hadGps && !out.locationLabel) {
    console.warn('[importLocation] GPS présent mais geocode sans libellé');
  }
  return { capturedAtIso: out.capturedAtIso, locationLabel: out.locationLabel };
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

  const fromLibrary = await resolveMetaFromLibraryAssetId(asset.assetId ?? null, {
    uriHint: asset.uri,
  });
  if (fromLibrary.capturedAtIso && fromLibrary.locationLabel) {
    return fromLibrary;
  }

  const fromExif = await buildImportMetadataFromExif(asset.exif ?? undefined);
  const merged: ImportMetadata = {
    capturedAtIso: fromLibrary.capturedAtIso ?? fromExif.capturedAtIso,
    locationLabel: fromLibrary.locationLabel ?? fromExif.locationLabel ?? null,
  };
  if (merged.capturedAtIso && merged.locationLabel) {
    return merged;
  }
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

/**
 * Après insert local : si lieu vide mais `import_asset_id` connu, retente la fiche Photos.
 * Local-first — n’écrase jamais un lieu déjà saisi.
 */
export function enrichImportLocationInBackground(memoryId: string): void {
  const id = memoryId.trim();
  if (!id) return;
  void (async () => {
    try {
      const { getLocalMemoryById } = await import('@/lib/localDb');
      const row = getLocalMemoryById(id);
      if (!row) return;
      if (row.location?.trim()) return;
      const assetId = row.import_asset_id?.trim();
      if (!assetId) return;

      await new Promise<void>(r => setTimeout(r, 400));
      const meta = await resolveMetaFromLibraryAssetId(assetId);
      const label = meta.locationLabel?.trim();
      if (!label) return;

      const again = getLocalMemoryById(id);
      if (!again || again.location?.trim()) return;
      const { updateMemoryLocation } = await import('@/services/media');
      await updateMemoryLocation(id, label);
    } catch (e) {
      console.warn('[importLocation] enrichImportLocationInBackground', e);
    }
  })();
}

/** `true` après rebuild natif si `getAssetInfoAsync` est utilisable. */
export async function isMediaLibraryNativeLinked(): Promise<boolean> {
  return (await getMediaLibraryModule()) != null;
}

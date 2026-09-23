/**
 * Lieu des souvenirs — GPS device (audio/texte) + reverse geocode.
 * Soft prompt une seule fois à la 1ʳᵉ sauvegarde audio/texte.
 *
 * `expo-location` : détection via `requireOptionalNativeModule` avant import
 * (évite le ERROR Metro « Cannot find native module 'ExpoLocation' » sans rebuild).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

/** Soft modale « Plus tard » — ne pas re-proposer. */
const SOFT_PROMPT_DEFERRED_PREFIX = 'petitmo:locationSoftPromptDeferred:';

function deferredKey(userId: string): string {
  return `${SOFT_PROMPT_DEFERRED_PREFIX}${userId.trim()}`;
}

/** @deprecated ancien flag unique — migré vers deferred. */
const SOFT_PROMPT_SEEN_PREFIX = 'petitmo:locationSoftPromptSeen:';

function softPromptKey(userId: string): string {
  return `${SOFT_PROMPT_SEEN_PREFIX}${userId.trim()}`;
}

let deferredByUser: Record<string, boolean> = {};

export async function hasDeferredLocationSoftPrompt(userId?: string | null): Promise<boolean> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return false;
  if (deferredByUser[uid] === true) return true;
  try {
    /** Ancien flag « seen » (y compris après Autoriser sans GPS) : ne bloque plus. */
    await AsyncStorage.removeItem(softPromptKey(uid));
    const v = (await AsyncStorage.getItem(deferredKey(uid))) === '1';
    deferredByUser[uid] = v;
    return v;
  } catch {
    return false;
  }
}

/** Utilisateur a tapé « Plus tard » sur la soft modale. */
export async function markLocationSoftPromptDeferred(userId?: string | null): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  deferredByUser[uid] = true;
  try {
    await AsyncStorage.setItem(deferredKey(uid), '1');
  } catch (e) {
    console.warn('[memoryLocation] markDeferred', e);
  }
}

/** @deprecated alias — préfère `markLocationSoftPromptDeferred`. */
export async function markLocationSoftPromptSeen(userId?: string | null): Promise<void> {
  return markLocationSoftPromptDeferred(userId);
}

export async function clearLocationSoftPromptSeen(userId?: string | null): Promise<void> {
  const uid = (userId ?? '').trim();
  if (!uid) return;
  delete deferredByUser[uid];
  try {
    await AsyncStorage.multiRemove([deferredKey(uid), softPromptKey(uid)]);
  } catch {
    /* */
  }
}

type ExpoLocation = typeof import('expo-location');

let locationModule: ExpoLocation | null | undefined;

function hasLocationNative(): boolean {
  return requireOptionalNativeModule('ExpoLocation') != null;
}

/** false si module natif absent (besoin d’un rebuild avec expo-location). */
export function isLocationModuleAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  return hasLocationNative();
}

async function getLocationModule(): Promise<ExpoLocation | null> {
  if (locationModule !== undefined) return locationModule;
  if (Platform.OS === 'web') {
    locationModule = null;
    return null;
  }
  /**
   * Toujours tenter l’import si le optional check échoue :
   * certains binarines exposent le module seulement après `import`.
   */
  if (!hasLocationNative()) {
    try {
      locationModule = await import('expo-location');
      return locationModule;
    } catch {
      locationModule = null;
      return null;
    }
  }
  try {
    locationModule = await import('expo-location');
    return locationModule;
  } catch (e) {
    console.warn('[memoryLocation] expo-location unavailable', e);
    locationModule = null;
    return null;
  }
}

/** Permission OS déjà accordée (sans dialog). */
export async function isForegroundLocationGranted(): Promise<boolean> {
  const Location = await getLocationModule();
  if (!Location) return false;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Soft modale si : natif OK, pas encore granted, pas « Plus tard ».
 * (Si l’ancien flag « seen » bloquait après un échec natif, on re-propose tant que
 * la permission OS n’est pas granted — sauf deferred explicite.)
 */
export async function shouldShowLocationSoftPrompt(): Promise<boolean> {
  const Location = await getLocationModule();
  if (!Location) return false;
  if (await isForegroundLocationGranted()) return false;
  if (await hasDeferredLocationSoftPrompt()) return false;
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return false;
    if (status === 'denied' && canAskAgain === false) return false;
  } catch {
    /* */
  }
  return true;
}

/** Dialog système iOS après « Autoriser » sur la soft modale. */
export async function requestForegroundLocationPermission(): Promise<boolean> {
  const Location = await getLocationModule();
  if (!Location) return false;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[memoryLocation] requestForeground', e);
    return false;
  }
}

function placeLabelFromGeocode(geo: {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  name?: string | null;
  country?: string | null;
}): string | null {
  const place =
    geo.city ||
    geo.district ||
    geo.subregion ||
    geo.name ||
    geo.region ||
    geo.country ||
    null;
  const t = place?.trim();
  return t ? t : null;
}

/** Ville (ou subdivision) depuis lat/lng — pas d’adresse rue. */
export async function reverseGeocodeToPlaceLabel(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const Location = await getLocationModule();
  if (!Location) return null;
  try {
    const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!geo) return null;
    return placeLabelFromGeocode(geo);
  } catch (e) {
    console.warn('[memoryLocation] reverseGeocode', e);
    return null;
  }
}

/**
 * Position iPhone → libellé lieu.
 * Ne demande jamais la permission (silent). Null si refus / indispo.
 */
export async function resolveCurrentPlaceLabelSilent(opts?: {
  quick?: boolean;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!(await isForegroundLocationGranted())) {
    console.warn('[memoryLocation] resolvePlace: permission non accordée');
    return null;
  }
  const Location = await getLocationModule();
  if (!Location) {
    console.warn('[memoryLocation] resolvePlace: module natif absent — rebuild requis');
    return null;
  }

  const run = async (): Promise<string | null> => {
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (
        last &&
        Number.isFinite(last.coords.latitude) &&
        Number.isFinite(last.coords.longitude)
      ) {
        const fromLast = await reverseGeocodeToPlaceLabel(
          last.coords.latitude,
          last.coords.longitude,
        );
        if (fromLast) return fromLast;
      }
      if (opts?.quick) return null;

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const label = await reverseGeocodeToPlaceLabel(
        pos.coords.latitude,
        pos.coords.longitude,
      );
      if (!label) {
        /** Repli coords brutes si géocodage Apple échoue (simulateur / offline). */
        return `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`;
      }
      return label;
    } catch (e) {
      console.warn('[memoryLocation] resolvePlace', e);
      return null;
    }
  };

  const timeoutMs = opts?.timeoutMs ?? (opts?.quick ? 2500 : 12000);
  try {
    return await Promise.race([
      run(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch (e) {
    console.warn('[memoryLocation] getCurrentPosition', e);
    return null;
  }
}

/**
 * Après save audio/texte : enrichit le lieu en fond (local-first).
 * N’écrase pas un lieu déjà saisi. Retente une fois (GPS froid juste après Autoriser).
 */
export async function enrichMemoryLocationInBackground(memoryId: string): Promise<void> {
  const id = memoryId.trim();
  if (!id) return;
  try {
    const { getLocalMemoryById } = await import('@/lib/localDb');
    const row = getLocalMemoryById(id);
    if (!row) return;
    if (row.location?.trim()) return;

    let label = await resolveCurrentPlaceLabelSilent({ timeoutMs: 12000 });
    if (!label) {
      await new Promise<void>(r => setTimeout(r, 800));
      label = await resolveCurrentPlaceLabelSilent({ timeoutMs: 12000 });
    }
    if (!label) {
      console.warn('[memoryLocation] enrichBackground: pas de lieu (GPS / géocodage / natif)');
      return;
    }

    const { updateMemoryLocation } = await import('@/services/media');
    await updateMemoryLocation(id, label);
    DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
  } catch (e) {
    console.warn('[memoryLocation] enrichBackground', e);
  }
}

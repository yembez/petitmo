import { Asset } from 'expo-asset';
import type { ImageSourcePropType } from 'react-native';

/**
 * En Expo DEV, les `require()` d’images passent souvent par Metro (HTTP).
 * Hors ligne → fond auth / slide livre absents si jamais mis en cache disque.
 * `downloadAsync` matérialise le fichier local (prod : no-op utile / déjà local).
 */
const AUTH_ONBOARDING_MODULES: number[] = [
  require('@/assets/images/auth_mother_child.jpg'),
  require('@/assets/images/onboarding_01_mom_child.jpg'),
  require('@/assets/images/onboarding_02_siblings_beach.jpg'),
  require('@/assets/images/onboarding_03_mom_tram.jpg'),
  require('@/assets/images/onboarding_04_book_qr.jpg'),
];

let prefetchPromise: Promise<void> | null = null;

export function prefetchAuthOnboardingAssets(): Promise<void> {
  if (!prefetchPromise) {
    prefetchPromise = Asset.loadAsync(AUTH_ONBOARDING_MODULES)
      .then(() => undefined)
      .catch(e => {
        console.warn('[prefetchAuthOnboardingAssets]', e);
        prefetchPromise = null;
      });
  }
  return prefetchPromise;
}

/** URI fichier local si déjà téléchargé — sinon `null` (garder le require). */
export async function localUriForImageModule(
  moduleId: number,
): Promise<string | null> {
  try {
    const asset = Asset.fromModule(moduleId);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    return asset.localUri ?? null;
  } catch (e) {
    console.warn('[localUriForImageModule]', e);
    return null;
  }
}

export function imageSourceWithLocalUri(
  moduleId: number,
  localUri: string | null | undefined,
): ImageSourcePropType {
  if (localUri) return { uri: localUri };
  return moduleId;
}

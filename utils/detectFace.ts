/**
 * Bounds visage pour les avatars ronds (fil, profil).
 * 1. ML on-device (`ExpoFaceDetector`) si le module natif est lié (dev build).
 * 2. Sinon repli heuristique portrait — indispensable en gratuit / Expo Go.
 *
 * La page Capturer n'utilise pas ces bounds (recadrage plein écran manuel).
 */
import { Image } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { heuristicFaceBoundsForAvatar } from '@/utils/avatarFaceBounds';

export type FaceBounds = {
  face_cx: number;
  face_cy: number;
  face_h: number;
  face_img_aspect: number;
};

const DEFAULT_PORTRAIT_ASPECT = 9 / 16;

type NativeFace = {
  bounds: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
};

type NativeDetectionResult = {
  faces: NativeFace[];
  image: { width: number; height: number };
};

/** Aligné sur `FaceDetectorMode.fast` / landmarks & classifications `none`. */
const DETECT_OPTIONS = {
  mode: 1,
  detectLandmarks: 1,
  runClassifications: 1,
} as const;

type ExpoFaceDetectorNative = {
  detectFaces: (options: { uri: string } & typeof DETECT_OPTIONS) => Promise<NativeDetectionResult>;
};

/**
 * Ne pas importer `expo-face-detector` (charge `requireNativeModule` et crash Expo Go).
 * `requireOptionalNativeModule` renvoie `null` si le natif n'est pas lié.
 */
const faceDetectorNative =
  requireOptionalNativeModule<ExpoFaceDetectorNative>('ExpoFaceDetector');

function toFaceDetectorUri(localPath: string): string {
  const p = localPath.trim();
  if (!p) return p;
  if (/^https?:\/\//i.test(p) || p.startsWith('file://')) return p;
  if (p.startsWith('/')) return `file://${p}`;
  return p;
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

async function detectFaceBoundsNative(uri: string): Promise<FaceBounds | null> {
  if (!faceDetectorNative?.detectFaces) return null;

  try {
    const result = await faceDetectorNative.detectFaces({
      ...DETECT_OPTIONS,
      uri,
    });

    if (!result?.faces?.length) return null;

    const imgW = result.image.width;
    const imgH = result.image.height;
    if (!imgW || !imgH) return null;

    const face = result.faces.reduce((best, f) =>
      f.bounds.size.width * f.bounds.size.height >
      best.bounds.size.width * best.bounds.size.height
        ? f
        : best,
    );

    const cx = (face.bounds.origin.x + face.bounds.size.width / 2) / imgW;
    const cy = (face.bounds.origin.y + face.bounds.size.height / 2) / imgH;
    const fh = face.bounds.size.height / imgH;

    if (
      !Number.isFinite(cx) ||
      cx < 0 ||
      cx > 1 ||
      !Number.isFinite(cy) ||
      cy < 0 ||
      cy > 1 ||
      !Number.isFinite(fh) ||
      fh <= 0 ||
      fh > 1
    ) {
      return null;
    }

    return {
      face_cx: cx,
      face_cy: cy,
      face_h: fh,
      face_img_aspect: imgW / imgH,
    };
  } catch {
    return null;
  }
}

/** Retire le cache-buster `?petitmo_v=` (Image.getSize / FaceDetector ne le supportent pas toujours). */
function stripUriCacheQuery(uri: string): string {
  const q = uri.indexOf('?');
  return q >= 0 ? uri.slice(0, q) : uri;
}

/**
 * Bounds heuristiques pour persistance SQLite (avatar fil), pas le hero Capturer.
 */
export async function estimatePortraitFaceBounds(uri: string): Promise<FaceBounds> {
  let aspect = DEFAULT_PORTRAIT_ASPECT;
  try {
    const { width, height } = await getImageDimensions(stripUriCacheQuery(uri));
    if (width > 0 && height > 0) {
      aspect = width / height;
    }
  } catch {
    /* dimensions inconnues → ratio portrait par défaut */
  }

  return heuristicFaceBoundsForAvatar(aspect);
}

/**
 * Bounds pour `ChildAvatar` : ML si possible, sinon heuristique (toujours une valeur en local).
 */
export async function detectFaceBounds(localPath: string): Promise<FaceBounds | null> {
  if (!localPath?.trim()) return null;

  const uri = stripUriCacheQuery(toFaceDetectorUri(localPath));
  const ml = await detectFaceBoundsNative(uri);
  if (ml) return ml;

  try {
    return await estimatePortraitFaceBounds(uri);
  } catch {
    return heuristicFaceBoundsForAvatar(DEFAULT_PORTRAIT_ASPECT);
  }
}

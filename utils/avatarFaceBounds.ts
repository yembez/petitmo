import type { Child } from '@/types/local';
import type { FaceBounds } from '@/utils/detectFace';

const DEFAULT_PORTRAIT_ASPECT = 9 / 16;

/** Part de la hauteur de l’avatar que le visage doit occuper (plus bas = moins de zoom). */
export const AVATAR_FACE_FILL_RATIO = 0.46;

/**
 * Hauteur d’image affichée minimale (× taille avatar) — zoom si le calcul naturel
 * ferait tenir presque toute la photo dans le cercle (bounds trop « larges »).
 */
const AVATAR_MIN_IMAGE_HEIGHT_RATIO = 1.05;

/** Plafond de zoom pour éviter un grain excessif sur petits avatars (fil). */
const AVATAR_MAX_IMAGE_HEIGHT_RATIO = 2.1;

/** Au-delà, on considère que le visage remplit déjà l’image (crop hero serré). */
const AVATAR_MAX_EFFECTIVE_FACE_H = 0.72;

export function isValidFaceBounds(
  bounds: Pick<Child, 'face_cx' | 'face_cy' | 'face_h' | 'face_img_aspect'> | null | undefined,
): boolean {
  if (!bounds) return false;
  const { face_cx, face_cy, face_h, face_img_aspect } = bounds;
  return (
    typeof face_cx === 'number' &&
    Number.isFinite(face_cx) &&
    typeof face_cy === 'number' &&
    Number.isFinite(face_cy) &&
    typeof face_h === 'number' &&
    Number.isFinite(face_h) &&
    face_h > 0 &&
    face_h <= 1 &&
    typeof face_img_aspect === 'number' &&
    Number.isFinite(face_img_aspect) &&
    face_img_aspect > 0
  );
}

/**
 * Heuristique **avatar rond uniquement** — zoom serré sur le visage.
 * Ne pas confondre avec `CAPTURE_HERO_IMAGE_CONTENT_POSITION` (plein écran Capturer).
 */
export function heuristicFaceBoundsForAvatar(aspect: number): FaceBounds {
  const a =
    Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_PORTRAIT_ASPECT;

  /** Crop profil type CropModal (même fichier que le hero, autre cadrage d’affichage). */
  if (a >= 0.42 && a <= 0.98) {
    return {
      face_cx: 0.5,
      face_cy: 0.42,
      face_h: 0.48,
      face_img_aspect: a,
    };
  }

  if (a > 1.05) {
    return {
      face_cx: 0.5,
      face_cy: 0.4,
      face_h: 0.45,
      face_img_aspect: a,
    };
  }

  return {
    face_cx: 0.5,
    face_cy: 0.4,
    face_h: 0.46,
    face_img_aspect: a,
  };
}

export function portraitFallbackFaceBounds(
  faceImgAspect: number = DEFAULT_PORTRAIT_ASPECT,
): FaceBounds {
  return heuristicFaceBoundsForAvatar(
    faceImgAspect > 0 ? faceImgAspect : DEFAULT_PORTRAIT_ASPECT,
  );
}

/** Bounds obsolètes (hero plein écran ou ancien repli « large ») sur un crop profil. */
export function isLegacyHeroHeuristicOnProfileCrop(
  child: Pick<Child, 'face_cx' | 'face_cy' | 'face_h' | 'face_img_aspect'>,
): boolean {
  if (!isValidFaceBounds(child)) return false;
  const aspect = child.face_img_aspect as number;
  const isProfileCrop = aspect >= 0.42 && aspect <= 0.98;
  const cy = child.face_cy as number;
  const fh = child.face_h as number;
  /** Ancien héros plein écran / zoom trop serré → heuristique avatar adoucie. */
  return isProfileCrop && (cy <= 0.34 || fh <= 0.34 || fh >= 0.55);
}

export function resolveAvatarFaceBounds(
  child: Pick<Child, 'face_cx' | 'face_cy' | 'face_h' | 'face_img_aspect'>,
): FaceBounds {
  if (isValidFaceBounds(child)) {
    return {
      face_cx: child.face_cx as number,
      face_cy: child.face_cy as number,
      face_h: child.face_h as number,
      face_img_aspect: child.face_img_aspect as number,
    };
  }
  const aspect =
    typeof child.face_img_aspect === 'number' &&
    Number.isFinite(child.face_img_aspect) &&
    child.face_img_aspect > 0
      ? child.face_img_aspect
      : DEFAULT_PORTRAIT_ASPECT;
  return portraitFallbackFaceBounds(aspect);
}

/**
 * Taille + offset pour centrer le visage dans le cercle.
 * Applique un zoom supplémentaire seulement si le cadrage naturel serait trop « large »,
 * puis scale cover + clamp du pan pour que le cercle soit toujours rempli
 * (pas de bande blanche haut / bas / côtés).
 */
export function computeAvatarImageLayout(
  avatarSize: number,
  bounds: FaceBounds,
  faceFillRatio: number = AVATAR_FACE_FILL_RATIO,
): { width: number; height: number; left: number; top: number } {
  const effectiveFaceH = Math.min(
    Math.max(bounds.face_h, 0.2),
    AVATAR_MAX_EFFECTIVE_FACE_H,
  );
  let imgH = (faceFillRatio * avatarSize) / effectiveFaceH;

  const minImgH = avatarSize * AVATAR_MIN_IMAGE_HEIGHT_RATIO;
  const maxImgH = avatarSize * AVATAR_MAX_IMAGE_HEIGHT_RATIO;

  if (imgH < minImgH) {
    imgH = minImgH;
  } else if (imgH > maxImgH) {
    imgH = maxImgH;
  }

  let imgW = imgH * bounds.face_img_aspect;

  // Léger overscan anti-bandeau (sous-pixels / AA).
  const coverTarget = avatarSize * 1.02;
  const coverScale = Math.max(
    coverTarget / Math.max(1, imgW),
    coverTarget / Math.max(1, imgH),
  );
  if (coverScale > 1.001) {
    imgW *= coverScale;
    imgH *= coverScale;
  }

  let left = avatarSize / 2 - bounds.face_cx * imgW;
  let top = avatarSize / 2 - bounds.face_cy * imgH;

  // Après centrage visage, le pan peut découvrir un bord → bande blanche.
  // Clamp pour que l’image couvre toujours le carré (cercle inscrit).
  const minLeft = avatarSize - imgW;
  const minTop = avatarSize - imgH;
  if (imgW >= avatarSize) {
    left = Math.max(minLeft, Math.min(0, left));
  }
  if (imgH >= avatarSize) {
    top = Math.max(minTop, Math.min(0, top));
  }

  return {
    width: imgW,
    height: imgH,
    left,
    top,
  };
}

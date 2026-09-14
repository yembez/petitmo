import type { View } from 'react-native';
import { tabBarFloatingBottomInset } from '@/constants/tabBarLayout';
import { scale, verticalScale } from '@/utils/responsive';

/** Cadre fenêtre de la vignette tapée (measureInWindow). */
export type ImmersiveSharedOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImmersiveSharedElement = {
  origin: ImmersiveSharedOrigin;
  uri: string;
  /** Clé de la page ouverte — figée à l’ouverture ; le retour re-mesure si on a swipé. */
  openedItemKey: string;
  /** Rayon des coins hauts de la carte fil, pour éviter le « pop » en fin d’animation. */
  cornerRadius: number;
};

export type ImmersiveLaunchArgs = {
  memoryId: string;
  albumPhotoIndex?: number;
  origin?: ImmersiveSharedOrigin | null;
  uri?: string | null;
  /** Rayon visible de la vignette (0 si elle ne touche pas le haut de la carte). */
  cornerRadius?: number;
};

/**
 * Hauteurs du chrome Fil (header avatar + tab bar) en coordonnées fenêtre.
 * `measureInWindow` sur une carte partiellement hors viewport inclut la zone
 * sous le header / au-dessus de la tab bar ; le clone ne doit pas y peindre.
 * Aligné sur `FeedHeader` + `tabBarFloatingBottomInset`.
 */
export function filFeedChromeInsets(
  safeTop: number,
  safeBottom: number,
): { top: number; bottom: number } {
  const headerPadTop = safeTop + verticalScale(6);
  /** `HEADER_AVATAR_PX` + anneau (padding + stroke) — voir `feedStyles`. */
  const avatarOuter = scale(68) + 2 * scale(2) + 2 * scale(2);
  const headerRow = Math.max(avatarOuter, verticalScale(52));
  const headerPadBottom = verticalScale(8);
  return {
    top: headerPadTop + headerRow + headerPadBottom,
    bottom: tabBarFloatingBottomInset(safeBottom),
  };
}

export function isUsableSharedOrigin(
  origin: ImmersiveSharedOrigin | null | undefined,
): origin is ImmersiveSharedOrigin {
  if (!origin) return false;
  const { x, y, width, height } = origin;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    width > 8 &&
    height > 8
  );
}

export function measureViewInWindow(
  view: View | null,
  onResult: (origin: ImmersiveSharedOrigin | null) => void,
): void {
  if (!view || typeof view.measureInWindow !== 'function') {
    onResult(null);
    return;
  }
  view.measureInWindow((x, y, width, height) => {
    const origin = { x, y, width, height };
    onResult(isUsableSharedOrigin(origin) ? origin : null);
  });
}

export function lerpRect(
  from: ImmersiveSharedOrigin,
  to: ImmersiveSharedOrigin,
  t: number,
): ImmersiveSharedOrigin {
  const p = Math.max(0, Math.min(1, t));
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    width: from.width + (to.width - from.width) * p,
    height: from.height + (to.height - from.height) * p,
  };
}

export function draggedFullscreenRect(
  dest: ImmersiveSharedOrigin,
  dismissY: number,
  dismissDistance: number,
): ImmersiveSharedOrigin {
  const drag = Math.max(0, dismissY);
  const dragProgress = Math.min(drag / Math.max(1, dismissDistance), 1);
  const scaleFactor = 1 - dragProgress * 0.08;
  return {
    x: dest.x + (dest.width * (1 - scaleFactor)) / 2,
    y: dest.y + drag + (dest.height * (1 - scaleFactor)) / 2,
    width: dest.width * scaleFactor,
    height: dest.height * scaleFactor,
  };
}

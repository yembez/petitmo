import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  TAB_BAR_BACKGROUND,
  TAB_BAR_BORDER_WIDTH,
  TAB_BAR_CONTAINER_BORDER,
  TAB_BAR_CORNER_RADIUS,
} from '@/constants/tabBarLayout';

const CIRCLE_KAPPA = 0.5522847498;

type Props = {
  width: number;
  height: number;
  showCenterDip: boolean;
  /** Demi-largeur horizontale de l’encoche (rayon disque + marge). */
  notchRadius: number;
  /** Profondeur verticale du fond de l’encoche (peut être < notchRadius). */
  notchDepth: number;
};

/** Rectangle pleine largeur ; bords latéraux droits (r = 0). */
function buildFlatRectPath(width: number, height: number, r: number): string {
  if (r <= 0) {
    return [`M 0 0`, `H ${width}`, `V ${height}`, `H 0`, 'Z'].join(' ');
  }

  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

/**
 * Encoche elliptique concentrique au CTA : largeur = 2×notchRadius, profondeur = notchDepth.
 * Cubiques κ → tangente horizontale, courbe douce autour du disque.
 */
function buildTabBarPath(
  width: number,
  height: number,
  cornerRadius: number,
  showCenterDip: boolean,
  notchRadius: number,
  notchDepth: number,
): string {
  const r = Math.min(cornerRadius, width / 2, height / 2);
  const cx = width / 2;
  const depth = Math.max(0, Math.min(notchDepth, notchRadius));

  if (!showCenterDip || notchRadius <= 0 || depth <= 0) {
    return buildFlatRectPath(width, height, r);
  }

  const notchLeft = Math.max(r, cx - notchRadius);
  const notchRight = Math.min(width - r, cx + notchRadius);

  if (notchRight - notchLeft <= 0) {
    return buildFlatRectPath(width, height, r);
  }

  const kx = notchRadius * CIRCLE_KAPPA;
  const ky = depth * CIRCLE_KAPPA;

  const topEdge = [
    `M ${r > 0 ? r : 0} 0`,
    `H ${notchLeft}`,
    `C ${notchLeft + kx} 0 ${cx - kx} ${depth} ${cx} ${depth}`,
    `C ${cx + kx} ${depth} ${notchRight - kx} 0 ${notchRight} 0`,
    `H ${width - r}`,
  ];

  if (r <= 0) {
    return [...topEdge, `V ${height}`, `H 0`, 'Z'].join(' ');
  }

  return [
    ...topEdge,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

export default function TabBarBackgroundShape({
  width,
  height,
  showCenterDip,
  notchRadius,
  notchDepth,
}: Props) {
  const path = useMemo(
    () =>
      buildTabBarPath(
        width,
        height,
        TAB_BAR_CORNER_RADIUS,
        showCenterDip,
        notchRadius,
        notchDepth,
      ),
    [width, height, showCenterDip, notchRadius, notchDepth],
  );

  if (width <= 0 || height <= 0) return null;

  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        zIndex: 0,
      }}
    >
      <Path
        d={path}
        fill={TAB_BAR_BACKGROUND}
        stroke={TAB_BAR_CONTAINER_BORDER}
        strokeWidth={TAB_BAR_BORDER_WIDTH}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Demi-largeur horizontale = rayon disque + marge autour du CTA. */
export function captureTabNotchRadius(discRadius: number, gap: number): number {
  return discRadius + gap;
}

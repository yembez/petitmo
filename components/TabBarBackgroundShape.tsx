import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  TAB_BAR_BACKGROUND,
  TAB_BAR_BORDER_WIDTH,
  TAB_BAR_CONTAINER_BORDER,
  TAB_BAR_CORNER_RADIUS,
} from '@/constants/tabBarLayout';
import { scale } from '@/utils/responsive';

type Props = {
  width: number;
  height: number;
  showCenterWave: boolean;
  /** Largeur horizontale de la vague (bords plats en dehors). */
  waveWidth: number;
  /** Hauteur de la montée centrale — douce, pas une bosse. */
  waveRise: number;
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
 * Bandeau bord à bord, bord supérieur quasi plat ;
 * au centre, deux cubiques symétriques (tangentes horizontales).
 */
function buildTabBarPath(
  width: number,
  height: number,
  cornerRadius: number,
  showCenterWave: boolean,
  waveWidth: number,
  waveRise: number,
): string {
  const r = Math.min(cornerRadius, width / 2, height / 2);
  const cx = width / 2;

  if (!showCenterWave || waveRise <= 0 || waveWidth <= 0) {
    return buildFlatRectPath(width, height, r);
  }

  const halfWave = waveWidth / 2;
  const waveInset = scale(6);
  const waveLeft = Math.max(r + waveInset, cx - halfWave);
  const waveRight = Math.min(width - r - waveInset, cx + halfWave);

  if (waveRight - waveLeft < waveWidth * 0.4) {
    return buildFlatRectPath(width, height, r);
  }

  const span = waveRight - waveLeft;
  const handle = span * 0.38;

  if (r <= 0) {
    return [
      `M 0 0`,
      `H ${waveLeft}`,
      `C ${waveLeft + handle * 0.4} 0 ${cx - handle * 0.62} ${-waveRise} ${cx} ${-waveRise}`,
      `C ${cx + handle * 0.62} ${-waveRise} ${waveRight - handle * 0.4} 0 ${waveRight} 0`,
      `H ${width}`,
      `V ${height}`,
      `H 0`,
      'Z',
    ].join(' ');
  }

  return [
    `M ${r} 0`,
    `H ${waveLeft}`,
    `C ${waveLeft + handle * 0.4} 0 ${cx - handle * 0.62} ${-waveRise} ${cx} ${-waveRise}`,
    `C ${cx + handle * 0.62} ${-waveRise} ${waveRight - handle * 0.4} 0 ${waveRight} 0`,
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

export default function TabBarBackgroundShape({
  width,
  height,
  showCenterWave,
  waveWidth,
  waveRise,
}: Props) {
  const path = useMemo(
    () =>
      buildTabBarPath(
        width,
        height,
        TAB_BAR_CORNER_RADIUS,
        showCenterWave,
        waveWidth,
        waveRise,
      ),
    [width, height, showCenterWave, waveWidth, waveRise],
  );

  if (width <= 0 || height <= 0) return null;

  const crestPadding = showCenterWave ? waveRise : 0;
  const svgHeight = height + crestPadding;

  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={svgHeight}
      viewBox={`0 ${-crestPadding} ${width} ${svgHeight}`}
      style={{
        position: 'absolute',
        left: 0,
        top: crestPadding > 0 ? -crestPadding : 0,
        width,
        height: svgHeight,
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

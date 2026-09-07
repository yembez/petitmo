import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
  /** API alignée sur Heart / Pen ; le contour a un poids fixe. */
  strokeWidth?: number;
};

/**
 * Flèche de partage courbée — contour creux (queue en tube + tête),
 * comme la capture de référence (pas Lucide Forward en trait simple).
 */
export default function ShareForwardIcon({
  size = 20,
  color = '#1C1C1E',
}: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 19.5C4 11 9.5 5.5 16 5.5V2.5L22.5 8.5L16 14.5V11C11.5 11 7.5 14.5 7 19.5Z"
        stroke={color}
        strokeWidth={1.55}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

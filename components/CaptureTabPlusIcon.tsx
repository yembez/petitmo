/**
 * « + » Capturer de la tab bar, affiché quand on est sur un autre onglet.
 * Contour du disque et croix en teinte unie (onglets inactifs) — pas de dégradé.
 */
import Svg, { Circle, Path } from 'react-native-svg';
import { THEME } from '@/constants/theme';

/** Demi-bras de la croix Lucide `Plus` (`M5 12h14 M12 5v14`) dans son viewBox 24. */
const LUCIDE_PLUS_ARM = 7;
const LUCIDE_VIEWBOX = 24;

type Props = {
  /** Diamètre du disque. */
  size: number;
  /** Taille nominale de la croix, comme pour une icône Lucide. */
  plusSize: number;
  /** Épaisseur du contour du disque — le trait s’épaissit vers l’intérieur, `size` ne bouge pas. */
  ringWidth: number;
  /** Épaisseur de la croix, exprimée comme un `strokeWidth` Lucide. */
  plusStrokeWidth: number;
  /** Teinte unie — défaut = onglets inactifs. */
  color?: string;
};

export default function CaptureTabPlusIcon({
  size,
  plusSize,
  ringWidth,
  plusStrokeWidth,
  color = THEME.tabBarInactiveTint,
}: Props) {
  const center = size / 2;
  const unit = plusSize / LUCIDE_VIEWBOX;
  const arm = LUCIDE_PLUS_ARM * unit;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={center}
        cy={center}
        r={(size - ringWidth) / 2}
        fill="none"
        stroke={color}
        strokeWidth={ringWidth}
      />
      <Path
        d={`M${center - arm} ${center}H${center + arm}M${center} ${center - arm}V${center + arm}`}
        fill="none"
        stroke={color}
        strokeWidth={plusStrokeWidth * unit}
        strokeLinecap="round"
      />
    </Svg>
  );
}

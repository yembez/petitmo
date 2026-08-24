/**
 * « + » Capturer de la tab bar, affiché quand on est sur un autre onglet.
 * Contour du disque **et** croix peints avec le dégradé bleu → orange de la charte.
 *
 * Tout est tracé en SVG : un `borderColor` React Native n’accepte pas de dégradé,
 * et un anneau en `LinearGradient` obligerait à reboucher le centre avec une couleur
 * opaque, ce qui masquerait le fond de la tab bar.
 */
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { CAPTURE_PHOTO_BORDER_GRADIENT } from '@/constants/captureScreenPalette';

const GRADIENT_ID = 'captureTabPlusGradient';
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
};

export default function CaptureTabPlusIcon({
  size,
  plusSize,
  ringWidth,
  plusStrokeWidth,
}: Props) {
  const center = size / 2;
  const unit = plusSize / LUCIDE_VIEWBOX;
  const arm = LUCIDE_PLUS_ARM * unit;
  const stroke = `url(#${GRADIENT_ID})`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={CAPTURE_PHOTO_BORDER_GRADIENT[0]} />
          <Stop offset="1" stopColor={CAPTURE_PHOTO_BORDER_GRADIENT[1]} />
        </LinearGradient>
      </Defs>
      <Circle
        cx={center}
        cy={center}
        r={(size - ringWidth) / 2}
        fill="none"
        stroke={stroke}
        strokeWidth={ringWidth}
      />
      <Path
        d={`M${center - arm} ${center}H${center + arm}M${center} ${center - arm}V${center + arm}`}
        fill="none"
        stroke={stroke}
        strokeWidth={plusStrokeWidth * unit}
        strokeLinecap="round"
      />
    </Svg>
  );
}

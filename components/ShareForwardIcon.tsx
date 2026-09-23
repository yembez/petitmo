import Svg, { G, Path } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
  /**
   * Épaisseur Lucide (viewBox 24) — référence cœur.
   * On n’applique qu’une fraction : le path est déjà un tube rempli.
   */
  strokeWidth?: number;
};

/**
 * Flèche de partage — tracé `assets/images/arrow_share_icon.svg`
 * (viewBox 527×473, path Inkscape scale 0.1).
 *
 * Léger stroke + scale > 1 : épaissit surtout vers l’extérieur
 * (évite de « manger » la silhouette vers l’intérieur).
 */
const SHARE_ARROW_D =
  'M2857 4586 c-51 -19 -85 -51 -111 -106 -20 -43 -21 -62 -24 -461 l-3 ' +
  '-416 -212 -6 c-389 -11 -654 -73 -972 -227 -227 -111 -418 -245 -604 -425 ' +
  '-136 -131 -213 -226 -330 -400 -167 -252 -272 -496 -339 -791 -51 -221 -57 ' +
  '-282 -57 -539 0 -315 23 -468 121 -790 19 -66 43 -146 52 -177 9 -32 19 -58 ' +
  '22 -58 4 0 26 66 49 147 80 275 123 389 208 555 211 414 538 733 958 938 306 ' +
  '149 574 210 921 210 117 0 175 -4 180 -11 4 -6 8 -185 9 -398 2 -412 4 -435 ' +
  '52 -492 52 -62 151 -77 231 -36 23 12 181 133 350 268 169 135 597 478 952 ' +
  '761 397 317 656 531 673 555 58 84 59 212 1 296 -14 21 -209 184 -447 374 ' +
  '-232 185 -667 533 -967 773 -300 239 -558 441 -575 447 -51 21 -98 23 -138 9z ' +
  'm271 -368 c92 -73 345 -274 562 -448 217 -173 558 -445 757 -603 199 -158 365 ' +
  '-297 368 -308 4 -11 4 -30 1 -43 -5 -21 -98 -96 -1176 -956 -549 -438 -679 ' +
  '-540 -690 -540 -7 0 -10 158 -10 449 0 370 -2 451 -14 460 -18 15 -556 16 ' +
  '-685 1 -398 -46 -801 -215 -1141 -478 -233 -181 -493 -496 -625 -759 -14 -29 ' +
  '-32 -53 -39 -53 -17 0 -26 93 -26 286 0 441 131 869 378 1234 329 485 824 802 ' +
  '1417 907 81 14 158 18 415 18 l315 0 3 483 c1 338 5 482 13 482 6 0 86 -59 ' +
  '177 -132z';

const VIEWBOX_W = 527;
const VIEWBOX_H = 473;
const LUCIDE_VIEWBOX = 24;
const DEFAULT_STROKE = 2.05;
const PATH_SCALE = 0.1;
/**
 * Fraction du trait cœur : le tube rempli porte déjà du poids ;
 * on ne renforce que légèrement.
 */
const STROKE_FRACTION = 0.38;
/** Agrandit la silhouette pour compenser la moitié intérieure du stroke. */
const OUTER_COMPENSATE_SCALE = 1.045;

export default function ShareForwardIcon({
  size = 20,
  color = '#1C1C1E',
  strokeWidth = DEFAULT_STROKE,
}: Props) {
  const height = (size * VIEWBOX_H) / VIEWBOX_W;
  const strokeInViewBox =
    (strokeWidth / LUCIDE_VIEWBOX) * VIEWBOX_W * STROKE_FRACTION;
  const strokeInPathSpace = strokeInViewBox / PATH_SCALE;
  const pad = strokeInViewBox * 0.6;
  const cx = VIEWBOX_W / 2;
  const cy = VIEWBOX_H / 2;

  return (
    <Svg
      width={size}
      height={height}
      viewBox={`${-pad} ${-pad} ${VIEWBOX_W + pad * 2} ${VIEWBOX_H + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <G
        transform={`translate(${cx},${cy}) scale(${OUTER_COMPENSATE_SCALE}) translate(${-cx},${-cy})`}
      >
        <G transform="translate(0,473) scale(0.1,-0.1)">
          <Path
            d={SHARE_ARROW_D}
            fill={color}
            stroke={color}
            strokeWidth={strokeInPathSpace}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </G>
      </G>
    </Svg>
  );
}

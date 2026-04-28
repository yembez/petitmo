import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as RNImage } from 'react-native';
import { Camera, Image as ImageIcon, Mic, PenLine, Settings } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { scale, verticalScale } from '@/utils/responsive';
import PetitmoLogoManuscrit from '@/components/PetitmoLogoManuscrit';
import { FONT_SIZES, ICON_SIZES } from '@/constants/sizes';

type SegmentSpec = {
  id: 'write' | 'record' | 'camera' | 'import';
  startDeg: number;
  endDeg: number;
  fill: string;
  label: string;
  labelColor: string; // couleur du texte + de l'icône
  outerWiggle: number;
  innerWiggle: number;
  phase: number;
  freq: number;
  outerRMult: number;
  innerRMult: number;
};

const degToRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

const buildWobblySegmentPath = ({
  cx,
  cy,
  outerR,
  innerR,
  startDeg,
  endDeg,
  outerWiggle,
  innerWiggle,
  phase,
  samples = 18,
  freq = 1.6,
}: {
  cx: number;
  cy: number;
  outerR: number;
  innerR: number;
  startDeg: number;
  endDeg: number;
  outerWiggle: number;
  innerWiggle: number;
  phase: number;
  samples?: number;
  freq?: number;
}) => {
  const ptsOuter: Array<{ x: number; y: number }> = [];
  const ptsInner: Array<{ x: number; y: number }> = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const a = startDeg + (endDeg - startDeg) * t;
    const r = outerR + outerWiggle * Math.sin(t * Math.PI * freq + phase);
    ptsOuter.push({ x: cx + r * Math.cos(degToRad(a)), y: cy + r * Math.sin(degToRad(a)) });
  }

  for (let i = samples; i >= 0; i -= 1) {
    const t = i / samples;
    const a = startDeg + (endDeg - startDeg) * t;
    const r = innerR + innerWiggle * Math.sin(t * Math.PI * (freq + 0.6) + phase * 0.8);
    ptsInner.push({ x: cx + r * Math.cos(degToRad(a)), y: cy + r * Math.sin(degToRad(a)) });
  }

  const first = ptsOuter[0];
  const outerLines = ptsOuter
    .slice(1)
    .map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
  const innerLines = ptsInner
    .map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${outerLines} ${innerLines} Z`;
};

export default function CaptureWheelMockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;

  const wheelSize = useMemo(() => {
    const raw = scale(330);
    return Math.min(raw, screenWidth - scale(48));
  }, [screenWidth]);

  const cx = wheelSize / 2;
  const cy = wheelSize / 2;

  // Photo centrale : on veut qu'elle soit bien visible,
  // et que les segments "mordent" légèrement par-dessus.
  // Pour que l'image soit visible : elle doit rester surtout dans le "trou" intérieur.
  const photoRadius = wheelSize * 0.18;
  const outerR = wheelSize * 0.47;
  // Le trou intérieur (rayon) doit être un peu plus grand que la photo.
  const innerR = wheelSize * 0.215;

  const segments: SegmentSpec[] = useMemo(
    () => [
      {
        id: 'record',
        startDeg: 300,
        endDeg: 375,
        fill: '#8A7B6D', // brun taupe
        label: 'Enregistrer',
        labelColor: '#2F5560',
        outerWiggle: wheelSize * 0.0012,
        innerWiggle: wheelSize * 0.0015,
        phase: 1.0,
        freq: 1.15,
        outerRMult: 1,
        innerRMult: 1,
      },
      {
        id: 'camera',
        startDeg: 60,
        endDeg: 120,
        fill: '#B8B0B9', // mauve grisé
        label: 'Caméra',
        labelColor: '#4A5568',
        outerWiggle: wheelSize * 0.0011,
        innerWiggle: wheelSize * 0.0014,
        phase: 2.0,
        freq: 1.15,
        outerRMult: 1,
        innerRMult: 1,
      },
      {
        id: 'import',
        startDeg: 240,
        endDeg: 300,
        fill: '#E7D3C0', // beige chaud
        label: 'Importer',
        labelColor: '#3F6A3F',
        outerWiggle: wheelSize * 0.0011,
        innerWiggle: wheelSize * 0.0014,
        phase: 0.2,
        freq: 1.15,
        outerRMult: 1,
        innerRMult: 1,
      },
      {
        id: 'write',
        startDeg: 120,
        endDeg: 240,
        fill: '#D9A3A4', // vieux rose / mauve rosé
        label: 'Écrire',
        labelColor: '#FFFFFF',
        // Écrire dominant : plus épais (segmente plus visible)
        outerWiggle: wheelSize * 0.0012,
        innerWiggle: wheelSize * 0.0016,
        phase: 0.6,
        freq: 1.2,
        outerRMult: 1.06,
        innerRMult: 0.92,
      },
    ],
    [wheelSize]
  );

  const actions = useMemo(() => {
    return segments.map(s => {
      const mid = (s.startDeg + s.endDeg) / 2;
      const a = degToRad(mid);
      const effOuterR = outerR * s.outerRMult;
      const effInnerR = innerR * s.innerRMult;
      const thickness = effOuterR - effInnerR;

      const actionR = effInnerR + thickness * (s.id === 'write' ? 0.68 : 0.58);
      const x = cx + actionR * Math.cos(a);
      const y = cy + actionR * Math.sin(a);

      const isWrite = s.id === 'write';
      const w = isWrite ? scale(150) : scale(105);
      const h = isWrite ? scale(90) : scale(72);

      return {
        id: s.id,
        x,
        y,
        w,
        h,
        label: s.label,
        labelColor: s.labelColor,
      };
    });
  }, [segments, cx, cy, outerR, innerR]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + verticalScale(18) }]}>
        <View style={styles.headerBanner} />
        <PetitmoLogoManuscrit width={scale(135.2 * 0.8)} height={scale(40.3 * 0.8)} />
        <View style={styles.headerRight}>
          <Text
            onPress={() => router.push('/parent-space')}
            style={styles.settingsFallback}
          >
            {/** placeholder for mock */}
          </Text>
          <Settings size={ICON_SIZES.md} color="#6B7D8C" strokeWidth={2} />
        </View>
      </View>

      <View style={styles.wheelArea}>
        <View style={[styles.wheelContainer, { width: wheelSize, height: wheelSize }]}>
          <View
            style={[
              styles.photoWrap,
              {
                width: photoRadius * 2,
                height: photoRadius * 2,
                borderRadius: photoRadius,
                left: cx - photoRadius,
                top: cy - photoRadius,
              },
            ]}
          >
            <RNImage
              source={require('@/assets/images/IMG_21BD3E272C98-1-a481fcdb-3539-488c-85fb-c0e87c252cd7.png')}
              style={[
                styles.photoImage,
                {
                  borderRadius: photoRadius,
                },
              ]}
              resizeMode="cover"
            />
          </View>

          <Svg
            width={wheelSize}
            height={wheelSize}
            viewBox={`0 0 ${wheelSize} ${wheelSize}`}
            style={styles.svg}
          >
            {segments.map(seg => {
              const d = buildWobblySegmentPath({
                cx,
                cy,
                outerR: outerR * seg.outerRMult,
                innerR: innerR * seg.innerRMult,
                startDeg: seg.startDeg,
                endDeg: seg.endDeg,
                outerWiggle: seg.outerWiggle,
                innerWiggle: seg.innerWiggle,
                phase: seg.phase,
                freq: seg.freq,
              });
              return <Path key={seg.id} d={d} fill={seg.fill} />;
            })}
          </Svg>

          {actions.map(a => {
            const iconColor = a.labelColor;
            const isWrite = a.id === 'write';

            return (
              <View
                // eslint-disable-next-line react-native/no-inline-styles
                key={a.id}
                pointerEvents="none"
                style={[
                  styles.actionWrap,
                  {
                    left: a.x,
                    top: a.y,
                    width: a.w,
                    height: a.h,
                    transform: [{ translateX: -a.w / 2 }, { translateY: -a.h / 2 }],
                  },
                ]}
              >
                {a.id === 'record' && <Mic size={ICON_SIZES.md} color={iconColor} strokeWidth={2} />}
                {a.id === 'camera' && <Camera size={ICON_SIZES.md} color={iconColor} strokeWidth={2} />}
                {a.id === 'import' && <ImageIcon size={ICON_SIZES.md} color={iconColor} strokeWidth={2} />}
                {a.id === 'write' && <PenLine size={ICON_SIZES.xl} color={iconColor} strokeWidth={2} />}

                {isWrite ? (
                  <View style={{ alignItems: 'center', marginTop: scale(6) }}>
                    <Text style={[styles.actionTextWriteMain, { color: iconColor }]}>{a.label}</Text>
                    <Text style={[styles.actionTextWriteSub, { color: iconColor }]}>
                      (ou dicter)
                    </Text>
                    <Text style={[styles.actionTextWriteSub, { color: iconColor }]}>un mot</Text>
                  </View>
                ) : (
                  <Text style={[styles.actionTextMain, { color: iconColor }]}>{a.label}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* pas de bouton / interaction dans la maquette */}
      <View style={{ height: scale(120) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    position: 'relative',
    alignItems: 'center',
    paddingBottom: scale(10),
  },
  headerBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: verticalScale(26),
    backgroundColor: '#FFFFFF',
  },
  headerRight: {
    position: 'absolute',
    right: scale(16),
    top: verticalScale(8),
  },
  settingsFallback: { opacity: 0 },
  wheelArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(16),
  },
  wheelContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
  },
  photoWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: scale(2),
    borderColor: '#FF0000',
    overflow: 'hidden',
    zIndex: 1,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  actionWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  actionTextMain: {
    marginTop: scale(6),
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionTextWriteMain: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionTextWriteSub: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '400',
    opacity: 0.85,
    marginTop: 0,
    textAlign: 'center',
  },
});


import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Polygon } from 'react-native-svg';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import QRCode from 'react-native-qrcode-svg';
import type { Memory } from '@/types/local';
import { formatDuration } from '@/utils/date';
import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';

const BAR_W = 3;
const BAR_GAP = 2.5;
const BAR_STEP = BAR_W + BAR_GAP;
const WAVE_H = 20;
const BAR_COUNT = 24;

export interface AudioPageProps {
  memory: Memory;
  width: number;
  qrUrl: string;
  pageNumber?: number;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barHeightsFromId(id: string): number[] {
  const rand = mulberry32(hashSeed(id));
  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    heights.push(4 + Math.floor(rand() * 17));
  }
  return heights;
}

export default function AudioPage({
  memory,
  width,
  qrUrl,
  pageNumber = 1,
}: AudioPageProps) {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const height = width / BOOK_PAGE_RATIO;
  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const garamondIt = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const totalSec = memory.duration ?? 0;
  const durLabel = formatDuration(Math.max(0, Math.floor(totalSec)));

  const heights = useMemo(() => barHeightsFromId(memory.id), [memory.id]);
  const waveWidth = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;

  const titleSize = width * 0.06;
  const qrSize = width * 0.22;

  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <View style={styles.bannerDot} />
          <Text
            style={[
              styles.bannerLabel,
              dm600 ? { fontFamily: dm600 } : { fontWeight: '600' },
            ]}
          >
            Audio
          </Text>
        </View>
        <Text style={[styles.bannerDuration, dm400 && { fontFamily: dm400 }]}>
          {durLabel}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.bodyInner}>
          <View style={styles.ringOuter}>
            <View style={styles.playerCircle}>
              <Svg width={14} height={16} viewBox="0 0 14 16">
                <Polygon points="0,0 14,8 0,16" fill="#5C8FA6" />
              </Svg>
            </View>
          </View>

          <Svg width={waveWidth} height={WAVE_H} style={styles.waveSvg}>
            {heights.map((h, i) => (
              <Rect
                key={i}
                x={i * BAR_STEP}
                y={WAVE_H - h}
                width={BAR_W}
                height={h}
                rx={1.5}
                ry={1.5}
                fill={i < 8 ? 'rgba(92,143,166,0.6)' : 'rgba(92,143,166,0.2)'}
              />
            ))}
          </Svg>

          <Text style={[styles.timer, dm400 && { fontFamily: dm400 }]}>
            {`0:16 · · · ${durLabel}`}
          </Text>

          <Text
            style={[
              styles.title,
              {
                fontSize: titleSize,
                fontFamily: garamondIt,
                fontStyle: garamondIt ? undefined : 'italic',
              },
            ]}
          >
            {memory.content?.trim() ? memory.content : 'Enregistrement vocal'}
          </Text>

          <View style={styles.qrWrap}>
            <QRCode
              value={qrUrl}
              size={qrSize}
              color="#1C1C1E"
              backgroundColor="#FFFFFF"
            />
          </View>

          <Text style={[styles.scanHint, dm400 && { fontFamily: dm400 }]}>
            Scanner pour écouter
          </Text>
        </View>
      </View>

      <View style={styles.folio}>
        <Text style={[styles.folioText, dm400 && { fontFamily: dm400 }]}>
          {pageNumber}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  banner: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#5C8FA6',
  },
  bannerLabel: {
    fontSize: 7,
    color: '#1C1C1E',
  },
  bannerDuration: {
    fontSize: 7,
    color: '#AEAEB2',
  },
  body: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  bodyInner: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
  },
  ringOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 0.8,
    borderColor: 'rgba(92,143,166,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EAF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveSvg: {
    alignSelf: 'center',
  },
  timer: {
    fontSize: 7,
    color: '#8E8E93',
  },
  title: {
    color: '#1C1C1E',
    textAlign: 'center',
  },
  qrWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanHint: {
    fontSize: 6,
    color: '#AEAEB2',
  },
  folio: {
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  folioText: {
    fontSize: 6,
    color: '#C7C7CC',
  },
});

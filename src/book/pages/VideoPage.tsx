import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import QRCode from 'react-native-qrcode-svg';
import type { Memory } from '@/types/local';
import { formatBookLocationShort } from '@/utils/date';
import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';

const IMAGE_ZONE_RATIO = 0.62;

export interface VideoPageProps {
  memory: Memory;
  width: number;
  qrUrl: string;
  pageNumber?: number;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString('fr-FR', { month: 'long' }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export default function VideoPage({
  memory,
  width,
  qrUrl,
  pageNumber = 1,
}: VideoPageProps) {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const pageHeight = width / BOOK_PAGE_RATIO;
  const imageZoneHeight = (width / BOOK_PAGE_RATIO) * IMAGE_ZONE_RATIO;
  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const garamondIt = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const thumb = memory.poster_url ?? memory.thumbnail_url;
  const dur = formatDuration(memory.duration);
  const bookLocationLine = formatBookLocationShort(memory.location);
  const qrColW = width * 0.28;
  const qrSize = width * 0.2;

  return (
    <View style={[styles.root, { width, height: pageHeight }]}>
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <View style={styles.bannerDot} />
          <Text
            style={[
              styles.bannerLabel,
              dm600 ? { fontFamily: dm600 } : { fontWeight: '600' },
            ]}
          >
            Vidéo
          </Text>
        </View>
        {memory.duration != null ? (
          <Text style={[styles.bannerDuration, dm400 && { fontFamily: dm400 }]}>{dur}</Text>
        ) : null}
      </View>

      <View style={[styles.mediaZone, { height: imageZoneHeight }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={styles.mediaFallback}>
            <Text style={[styles.fallbackLabel, dm400 && { fontFamily: dm400 }]}>Vidéo</Text>
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.09)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.spineShadow}
        />
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <View style={styles.playTriangle} />
          </View>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.bottomLeft}>
          <View style={styles.bottomDateLocRow}>
            <Text style={[styles.dateLine, dm400 && { fontFamily: dm400 }]}>
              {formatBookDate(memory.created_at)}
            </Text>
            {bookLocationLine ? (
              <Text
                style={[styles.bottomLocation, dm400 && { fontFamily: dm400 }]}
                numberOfLines={1}
              >
                {bookLocationLine}
              </Text>
            ) : null}
          </View>
          <Text
            style={[
              styles.titleLine,
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
            numberOfLines={2}
          >
            {memory.content?.trim() ? memory.content : 'Vidéo'}
          </Text>
          {memory.duration != null ? (
            <Text style={[styles.durationLine, dm400 && { fontFamily: dm400 }]}>
              Durée · {dur}
            </Text>
          ) : null}
        </View>
        <View style={[styles.bottomRight, { width: qrColW }]}>
          <QRCode value={qrUrl} size={qrSize} color="#1C1C1E" backgroundColor="#FFFFFF" />
          <Text style={[styles.qrHint, dm400 && { fontFamily: dm400 }]}>
            Scanner pour regarder
          </Text>
        </View>
      </View>

      <View style={styles.folio}>
        <Text style={[styles.folioText, dm400 && { fontFamily: dm400 }]}>{pageNumber}</Text>
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
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.06)',
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
    backgroundColor: '#D4784A',
  },
  bannerLabel: {
    fontSize: 7,
    color: '#3C3C3E',
  },
  bannerDuration: {
    fontSize: 7,
    color: '#AEAEB2',
  },
  mediaZone: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#2C2C2E',
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  mediaFallback: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLabel: {
    fontSize: 9,
    color: '#5C5C5E',
  },
  spineShadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderStyle: 'solid',
    borderLeftWidth: 13,
    borderLeftColor: '#FFFFFF',
    borderTopWidth: 8,
    borderTopColor: 'transparent',
    borderBottomWidth: 8,
    borderBottomColor: 'transparent',
    borderRightWidth: 0,
  },
  bottom: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
  },
  bottomLeft: {
    flex: 1,
    paddingTop: 7,
    paddingRight: 6,
    paddingBottom: 5,
    paddingLeft: 10,
  },
  bottomDateLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 2,
  },
  dateLine: {
    fontSize: 6,
    color: '#AEAEB2',
    flexShrink: 0,
  },
  bottomLocation: {
    fontSize: 6,
    color: '#AEAEB2',
    textAlign: 'right',
    flex: 1,
  },
  titleLine: {
    fontSize: 11,
    color: '#1C1C1E',
    lineHeight: 11 * 1.3,
  },
  durationLine: {
    marginTop: 3,
    fontSize: 6,
    color: '#8E8E93',
  },
  bottomRight: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 5,
    paddingRight: 8,
    paddingBottom: 5,
    paddingLeft: 4,
    borderLeftWidth: 0.5,
    borderLeftColor: 'rgba(0,0,0,0.07)',
  },
  qrHint: {
    marginTop: 3,
    fontSize: 5,
    color: '#AEAEB2',
    textAlign: 'center',
  },
  folio: {
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  folioText: {
    fontSize: 6,
    color: '#C7C7CC',
  },
});

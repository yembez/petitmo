import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Alert,
  type LayoutChangeEvent,
} from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { X, Play, Pause } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Memory } from '@/types/local';
import { THEME } from '@/constants/theme';
import { formatDuration } from '@/utils/date';
import { scale } from '@/utils/responsive';
import { resolveReadableVideoPlaybackUri } from '@/utils/videoMediaUri';
import { persistVideoPosterPrintAtTimeMs } from '@/services/videoPosterPrint';
import { useAppTranslation } from '@/hooks/useAppTranslation';

type Props = {
  visible: boolean;
  memory: Memory | null;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
};

function seekFraction(locationX: number, trackWidth: number): number {
  if (trackWidth <= 0) return 0;
  return Math.max(0, Math.min(1, locationX / trackWidth));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function BookVideoPosterPickerModal({ visible, memory, onClose, onSaved }: Props) {
  const { t } = useAppTranslation('common');
  const insets = useSafeAreaInsets();
  const videoRef = useRef<Video>(null);
  const trackWidthRef = useRef(0);
  const scrubbingRef = useRef(false);
  const seekRafRef = useRef<number | null>(null);
  const pendingSeekMsRef = useRef<number | null>(null);
  const positionMillisRef = useRef(0);
  const savingRef = useRef(false);

  const [videoUri, setVideoUri] = useState('');
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Démontage du lecteur pendant l’extraction — évite le conflit AVFoundation / VideoThumbnails. */
  const [playerMounted, setPlayerMounted] = useState(true);

  const memoryDurationMs =
    memory && typeof memory.duration === 'number' && Number.isFinite(memory.duration) && memory.duration > 0
      ? Math.floor(memory.duration * 1000)
      : 0;

  const effectiveDurationMs = durationMillis > 0 ? durationMillis : memoryDurationMs;

  const flushPendingSeek = useCallback(() => {
    const ms = pendingSeekMsRef.current;
    pendingSeekMsRef.current = null;
    if (ms == null) return;
    void videoRef.current?.setPositionAsync(ms).catch(() => {});
  }, []);

  const scheduleSeek = useCallback(
    (ms: number) => {
      pendingSeekMsRef.current = ms;
      if (seekRafRef.current != null) return;
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = null;
        flushPendingSeek();
      });
    },
    [flushPendingSeek],
  );

  useEffect(() => {
    if (!visible || !memory || memory.type !== 'video') return;
    let alive = true;
    setVideoUri('');
    setPositionMillis(0);
    positionMillisRef.current = 0;
    setDurationMillis(memoryDurationMs);
    setVideoReady(false);
    setIsPlaying(false);
    setPlayerMounted(true);
    savingRef.current = false;
    setSaving(false);
    void (async () => {
      const resolved = await resolveReadableVideoPlaybackUri(memory);
      if (!alive || !resolved.trim()) return;
      setVideoUri(resolved);
    })();
    return () => {
      alive = false;
      if (seekRafRef.current != null) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
      void videoRef.current?.pauseAsync().catch(() => {});
    };
  }, [visible, memory?.id, memory?.type, memoryDurationMs]);

  const applySeek = useCallback(
    (locationX: number) => {
      const w = trackWidthRef.current;
      const dur = effectiveDurationMs;
      if (w <= 0 || dur <= 0) return;
      const ms = Math.round(seekFraction(locationX, w) * dur);
      positionMillisRef.current = ms;
      setPositionMillis(ms);
      scheduleSeek(ms);
    },
    [effectiveDurationMs, scheduleSeek],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
          if (savingRef.current) return;
          scrubbingRef.current = true;
          setIsPlaying(false);
          void videoRef.current?.pauseAsync().catch(() => {});
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderMove: e => {
          if (savingRef.current) return;
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          scrubbingRef.current = false;
          flushPendingSeek();
        },
        onPanResponderTerminate: () => {
          scrubbingRef.current = false;
          flushPendingSeek();
        },
      }),
    [applySeek, flushPendingSeek],
  );

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
      setDurationMillis(status.durationMillis);
    }
    if (!scrubbingRef.current && typeof status.positionMillis === 'number') {
      positionMillisRef.current = status.positionMillis;
      setPositionMillis(status.positionMillis);
    }
    setIsPlaying(!!status.isPlaying);
    if (status.isLoaded) {
      setVideoReady(true);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoReady || savingRef.current) return;
    if (isPlaying) {
      void videoRef.current?.pauseAsync().catch(() => {});
      setIsPlaying(false);
      return;
    }
    void videoRef.current?.playAsync().catch(() => {});
    setIsPlaying(true);
  }, [isPlaying, videoReady]);

  const remountPlayer = useCallback(async (uri: string) => {
    setPlayerMounted(true);
    setVideoReady(false);
    setVideoUri(uri);
    // Petit délai pour laisser React remonter le <Video> avant un éventuel seek.
    await sleep(60);
  }, []);

  const handleSave = useCallback(async () => {
    if (!memory || savingRef.current || !videoUri.trim()) return;
    savingRef.current = true;
    setSaving(true);
    const uriForExtract = videoUri.trim();
    try {
      flushPendingSeek();
      await videoRef.current?.pauseAsync().catch(() => {});
      setIsPlaying(false);

      const status = await videoRef.current?.getStatusAsync().catch(() => null);
      const exactMs =
        status && status.isLoaded && typeof status.positionMillis === 'number'
          ? status.positionMillis
          : positionMillisRef.current;

      await videoRef.current?.setPositionAsync(exactMs).catch(() => {});
      positionMillisRef.current = exactMs;
      setPositionMillis(exactMs);
      // Laisse le decodeur se poser sur la frame choisie.
      await sleep(180);

      // Libère AVPlayer avant expo-video-thumbnails (sinon échecs aléatoires iOS).
      await videoRef.current?.unloadAsync().catch(() => {});
      setPlayerMounted(false);
      setVideoReady(false);
      await sleep(120);

      let updated: Memory | null = null;
      for (let attempt = 0; attempt < 3 && !updated; attempt++) {
        updated = await persistVideoPosterPrintAtTimeMs(memory.id, exactMs, {
          videoUri: uriForExtract,
          settleMs: attempt === 0 ? 80 : 220 + attempt * 120,
        });
      }

      if (updated) {
        onSaved(updated);
        onClose();
        return;
      }

      Alert.alert(t('error'), t('book.videoPoster.saveFailed'));
      await remountPlayer(uriForExtract);
      await videoRef.current?.setPositionAsync(exactMs).catch(() => {});
    } catch (e) {
      console.warn('[BookVideoPosterPickerModal] handleSave', e);
      Alert.alert(t('error'), t('book.videoPoster.saveFailed'));
      await remountPlayer(uriForExtract);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [flushPendingSeek, memory, onClose, onSaved, remountPlayer, t, videoUri]);

  if (!visible || !memory || memory.type !== 'video') return null;

  const progress =
    effectiveDurationMs > 0
      ? Math.max(0, Math.min(1, positionMillis / effectiveDurationMs))
      : 0;
  const thumbSize = scale(16);
  const thumbRadius = thumbSize / 2;
  const posSec = Math.floor(positionMillis / 1000);
  const durSec = Math.max(0, Math.floor(effectiveDurationMs / 1000));
  const canSave = !saving && !!videoUri.trim() && videoReady;

  return (
    <View
      style={[
        styles.overlay,
        { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('book.videoPoster.title')}</Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={t('book.videoPoster.closeA11y')}
        >
          <X size={20} color={THEME.textPrimary} strokeWidth={2.2} />
        </Pressable>
      </View>

      <Pressable style={styles.previewWrap} onPress={togglePlay} accessibilityRole="button">
        {videoUri.trim() && playerMounted ? (
          <Video
            ref={videoRef}
            source={{ uri: videoUri }}
            style={styles.previewVideo}
            resizeMode={ResizeMode.COVER}
            shouldPlay={isPlaying}
            isLooping={false}
            isMuted
            useNativeControls={false}
            progressUpdateIntervalMillis={33}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            onReadyForDisplay={() => setVideoReady(true)}
          />
        ) : (
          <View style={styles.previewPlaceholder}>
            <ActivityIndicator color={THEME.textMuted} />
          </View>
        )}
        {saving ? (
          <View style={styles.previewLoading}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.savingHint}>{t('book.videoPoster.saving')}</Text>
          </View>
        ) : !videoReady && videoUri.trim() && playerMounted ? (
          <View style={styles.previewLoading}>
            <ActivityIndicator color={THEME.textMuted} />
          </View>
        ) : null}
        {videoReady && !saving ? (
          <View style={styles.playFab} pointerEvents="none">
            {isPlaying ? (
              <Pause size={scale(28)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
            ) : (
              <Play size={scale(28)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
            )}
          </View>
        ) : null}
      </Pressable>

      <View style={styles.sliderBlock}>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatDuration(posSec)}</Text>
          <Text style={styles.timeText}>{formatDuration(durSec)}</Text>
        </View>
        <View
          style={styles.trackHit}
          onLayout={(e: LayoutChangeEvent) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
          }}
          accessibilityRole="adjustable"
          accessibilityLabel={t('book.videoPoster.scrubA11y')}
          {...pan.panHandlers}
        >
          <View style={styles.trackFill} pointerEvents="none">
            <View style={[styles.trackProgress, { width: `${progress * 100}%` }]} />
            <View
              style={[
                styles.thumb,
                {
                  width: thumbSize,
                  height: thumbSize,
                  borderRadius: thumbRadius,
                  left: `${progress * 100}%`,
                  marginLeft: -thumbRadius,
                },
              ]}
            />
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.cta, !canSave && styles.ctaDisabled]}
        onPress={() => void handleSave()}
        disabled={!canSave}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.ctaText}>{t('book.videoPoster.useImage')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
    backgroundColor: THEME.bg,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    flex: 1,
    color: THEME.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 12,
  },
  previewWrap: {
    flex: 1,
    minHeight: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  previewVideo: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 10,
  },
  savingHint: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  playFab: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    width: scale(56),
    height: scale(56),
    borderRadius: scale(28),
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderBlock: {
    marginTop: 18,
    marginBottom: 18,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  timeText: {
    fontSize: 12,
    color: THEME.textMuted,
    fontVariant: ['tabular-nums'],
  },
  trackHit: {
    height: 40,
    justifyContent: 'center',
  },
  trackFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    overflow: 'visible',
  },
  trackProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: THEME.brandCtaOrange,
  },
  thumb: {
    position: 'absolute',
    top: -6,
    backgroundColor: THEME.brandCtaOrange,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  cta: {
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  ctaDisabled: {
    opacity: 0.55,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

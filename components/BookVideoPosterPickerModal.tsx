import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  PanResponder,
  Alert,
  type LayoutChangeEvent,
} from 'react-native';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { PetitmoVideoView } from '@/components/PetitmoVideoView';
import { X, Play, Pause } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Memory } from '@/types/local';
import { THEME } from '@/constants/theme';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
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
  const playerRef = useRef<VideoPlayer | null>(null);
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
    try {
      if (playerRef.current) playerRef.current.currentTime = ms / 1000;
    } catch {
      /* ignore */
    }
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
      try {
        playerRef.current?.pause();
      } catch {
        /* ignore */
      }
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
          try {
            playerRef.current?.pause();
          } catch {
            /* ignore */
          }
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

  const togglePlay = useCallback(() => {
    if (!videoReady || savingRef.current) return;
    if (isPlaying) {
      try {
        playerRef.current?.pause();
      } catch {
        /* ignore */
      }
      setIsPlaying(false);
      return;
    }
    try {
      playerRef.current?.play();
    } catch {
      /* ignore */
    }
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
      try {
        playerRef.current?.pause();
      } catch {
        /* ignore */
      }
      setIsPlaying(false);

      const exactMs = playerRef.current
        ? Math.round(playerRef.current.currentTime * 1000)
        : positionMillisRef.current;

      try {
        if (playerRef.current) playerRef.current.currentTime = exactMs / 1000;
      } catch {
        /* ignore */
      }
      positionMillisRef.current = exactMs;
      setPositionMillis(exactMs);
      // Laisse le decodeur se poser sur la frame choisie.
      await sleep(180);

      // Libère le lecteur avant expo-video-thumbnails (sinon échecs aléatoires iOS).
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
      try {
        if (playerRef.current) playerRef.current.currentTime = exactMs / 1000;
      } catch {
        /* ignore */
      }
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
          <PosterPickerPreview
            uri={videoUri}
            playerRef={playerRef}
            scrubbingRef={scrubbingRef}
            onReady={() => setVideoReady(true)}
            onDurationMs={setDurationMillis}
            onPositionMs={ms => {
              positionMillisRef.current = ms;
              setPositionMillis(ms);
            }}
            onPlayingChange={setIsPlaying}
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

      <PetitmoPrimaryPressable
        style={styles.cta}
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
      </PetitmoPrimaryPressable>
    </View>
  );
}

function PosterPickerPreview({
  uri,
  playerRef,
  scrubbingRef,
  onReady,
  onDurationMs,
  onPositionMs,
  onPlayingChange,
}: {
  uri: string;
  playerRef: MutableRefObject<VideoPlayer | null>;
  scrubbingRef: MutableRefObject<boolean>;
  onReady: () => void;
  onDurationMs: (ms: number) => void;
  onPositionMs: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const player = useVideoPlayer(uri, instance => {
    instance.loop = false;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.033;
  });
  playerRef.current = player;

  useEffect(() => {
    const loadSub = player.addListener('sourceLoad', ({ duration }) => {
      if (duration > 0) onDurationMs(Math.round(duration * 1000));
      onReady();
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (!scrubbingRef.current) onPositionMs(Math.round(currentTime * 1000));
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => {
      onPlayingChange(isPlaying);
    });
    return () => {
      loadSub.remove();
      timeSub.remove();
      playSub.remove();
    };
  }, [player, onDurationMs, onPlayingChange, onPositionMs, onReady, scrubbingRef]);

  return (
    <PetitmoVideoView
      player={player}
      contentFit="cover"
      style={styles.previewVideo}
      onFirstFrameRender={onReady}
    />
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
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  ctaText: {
    color: THEME.captureScreenCtaForeground,
    fontSize: 15,
    fontWeight: '700',
  },
});

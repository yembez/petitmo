import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { PetitmoVideoView } from '@/components/PetitmoVideoView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Play, Pause } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { petitmoCtaStyles, PETITMO_CTA_SPINNER_COLOR } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { VideoTrimEditor, type VideoTrimEditorValue } from '@/components/VideoTrimEditor';
import {
  ensureVideoFileUri,
  isVideoTrimNativeAvailable,
  VIDEO_TRIM_FILMSTRIP_COUNT,
} from '@/services/videoTrimNative';
import * as VideoThumbnails from 'expo-video-thumbnails';

/** Plage choisie — le parent ferme la modale puis lance le trim natif (moins de RAM). */
export type VideoTrimModalConfirmResult = {
  startSec: number;
  endSec: number;
};

type Props = {
  visible: boolean;
  videoUri: string;
  /** Indice seulement ; la durée réelle vient du lecteur (`sourceLoad`). */
  durationSec: number;
  maxDurationSec: number;
  isFreeTier: boolean;
  /** Fenêtre déjà choisie (réouverture) — sinon 0 → min(durée, max). */
  initialTrim?: { startSec: number; endSec: number } | null;
  onCancel: () => void;
  onConfirm: (result: VideoTrimModalConfirmResult) => void;
  onUpgrade?: () => void;
};

function clampTrimRange(
  startSec: number,
  endSec: number,
  durationSec: number,
  maxDurationSec: number,
): VideoTrimEditorValue {
  const total = Math.max(1, durationSec);
  const maxClip = Math.max(1, maxDurationSec);
  let s = Math.max(0, Math.min(total, startSec));
  let e = Math.max(0, Math.min(total, endSec));
  if (e <= s) {
    e = Math.min(total, s + Math.min(maxClip, total));
  }
  if (e - s > maxClip) {
    e = s + maxClip;
    if (e > total) {
      e = total;
      s = Math.max(0, e - maxClip);
    }
  }
  if (e - s < 1) {
    e = Math.min(total, s + 1);
  }
  return { startSec: s, endSec: e };
}

/** Première ouverture : toute la vidéo (bornée par le plafond plan). */
function defaultTrimRange(durationSec: number, maxDurationSec: number): VideoTrimEditorValue {
  const total = Math.max(1, durationSec);
  return clampTrimRange(0, Math.min(total, maxDurationSec), total, maxDurationSec);
}

export function VideoTrimModal({
  visible,
  videoUri,
  durationSec,
  maxDurationSec,
  isFreeTier,
  initialTrim = null,
  onCancel,
  onConfirm,
  onUpgrade,
}: Props) {
  const { t } = useAppTranslation('common');
  const insets = useSafeAreaInsets();
  const playerRef = useRef<VideoPlayer | null>(null);
  const trimRef = useRef<VideoTrimEditorValue>(defaultTrimRange(1, maxDurationSec));
  const isPlayingRef = useRef(false);
  const exportingRef = useRef(false);
  const dragActiveRef = useRef(false);
  const initialTrimRef = useRef(initialTrim);
  initialTrimRef.current = initialTrim;
  const appliedDurationForTrimRef = useRef(0);

  const [playbackUri, setPlaybackUri] = useState('');
  const [effectiveDurationSec, setEffectiveDurationSec] = useState(0);
  const [trim, setTrim] = useState<VideoTrimEditorValue>(() =>
    defaultTrimRange(1, maxDurationSec),
  );
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [filmstripUris, setFilmstripUris] = useState<Array<string | object | null>>([]);
  const filmstripLoadedKeyRef = useRef('');

  trimRef.current = trim;
  const sessionKeyRef = useRef('');

  useEffect(() => {
    if (!visible) {
      try {
        playerRef.current?.pause();
      } catch {
        /* ignore */
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      exportingRef.current = false;
      setIsConfirming(false);
      /** Force un rechargement filmstrip + trim à chaque réouverture. */
      sessionKeyRef.current = '';
      filmstripLoadedKeyRef.current = '';
      appliedDurationForTrimRef.current = 0;
      setFilmstripUris([]);
      setVideoReady(false);
      setPlaybackUri('');
      return;
    }

    const sessionKey = `${videoUri}|${initialTrim?.startSec ?? 'x'}|${initialTrim?.endSec ?? 'x'}`;
    if (sessionKeyRef.current === sessionKey) return;
    sessionKeyRef.current = sessionKey;

    const seed = durationSec > 0 ? durationSec : 0;
    const preferred = initialTrimRef.current;
    const initial =
      seed > 0
        ? preferred
          ? clampTrimRange(preferred.startSec, preferred.endSec, seed, maxDurationSec)
          : defaultTrimRange(seed, maxDurationSec)
        : preferred && preferred.endSec > preferred.startSec
          ? preferred
          : { startSec: 0, endSec: 1 };
    trimRef.current = initial;
    setTrim(initial);
    setEffectiveDurationSec(seed);
    appliedDurationForTrimRef.current = seed > 0 ? seed : 0;
    setPlaybackUri(normalizeVideoPlaybackUri(videoUri));
    setVideoReady(false);
    setIsPlaying(false);
    isPlayingRef.current = false;
    exportingRef.current = false;
    setIsConfirming(false);
    setFilmstripUris([]);
    filmstripLoadedKeyRef.current = '';
  }, [visible, videoUri, durationSec, maxDurationSec, initialTrim]);

  useEffect(() => {
    if (!visible || effectiveDurationSec <= 0) return;
    if (appliedDurationForTrimRef.current === effectiveDurationSec) return;
    appliedDurationForTrimRef.current = effectiveDurationSec;
    const preferred = initialTrimRef.current;
    const next = preferred
      ? clampTrimRange(preferred.startSec, preferred.endSec, effectiveDurationSec, maxDurationSec)
      : defaultTrimRange(effectiveDurationSec, maxDurationSec);
    trimRef.current = next;
    setTrim(next);
  }, [visible, effectiveDurationSec, maxDurationSec]);

  /**
   * Vignettes fichier via expo-video-thumbnails (fiable à chaque ouverture).
   * Pause le lecteur pendant l’extraction (conflit AVFoundation sinon).
   */
  useEffect(() => {
    if (!visible || !videoReady || effectiveDurationSec <= 0 || !videoUri.trim()) return;
    const key = `${videoUri}|${Math.round(effectiveDurationSec)}`;
    if (filmstripLoadedKeyRef.current === key) return;

    let alive = true;
    setFilmstripUris(Array.from({ length: VIDEO_TRIM_FILMSTRIP_COUNT }, () => null));

    const timer = setTimeout(() => {
      void (async () => {
        const input = ensureVideoFileUri(videoUri);
        if (!alive || !input) return;
        try {
          playerRef.current?.pause();
        } catch {
          /* ignore */
        }
        const slots: Array<string | null> = Array.from(
          { length: VIDEO_TRIM_FILMSTRIP_COUNT },
          () => null,
        );
        let gotAny = false;
        for (let i = 0; i < VIDEO_TRIM_FILMSTRIP_COUNT; i += 1) {
          if (!alive || exportingRef.current) break;
          const timeMs = Math.round(
            ((i + 0.5) / VIDEO_TRIM_FILMSTRIP_COUNT) * effectiveDurationSec * 1000,
          );
          try {
            const { uri } = await VideoThumbnails.getThumbnailAsync(input, {
              time: Math.max(0, timeMs),
              quality: 0.45,
            });
            const frame = uri?.trim() ? ensureVideoFileUri(uri.trim()) : '';
            if (frame) {
              slots[i] = frame;
              gotAny = true;
              if (!alive) break;
              setFilmstripUris(prev => {
                const next = [...prev];
                next[i] = frame;
                return next;
              });
            }
          } catch {
            /* case vide */
          }
        }
        if (alive && gotAny) {
          filmstripLoadedKeyRef.current = key;
        } else if (alive) {
          /** Échec : laisser réessayer à la prochaine ouverture. */
          filmstripLoadedKeyRef.current = '';
        }
        try {
          if (playerRef.current) {
            playerRef.current.currentTime = trimRef.current.startSec;
          }
        } catch {
          /* ignore */
        }
      })();
    }, 160);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [visible, videoReady, effectiveDurationSec, videoUri]);

  const seekToTrimStart = useCallback(() => {
    try {
      if (playerRef.current) playerRef.current.currentTime = trimRef.current.startSec;
    } catch {
      /* ignore */
    }
  }, []);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    try {
      playerRef.current?.pause();
    } catch {
      /* ignore */
    }
  }, []);

  const startPlayback = useCallback(() => {
    if (!videoReady) return;
    const startSec = trimRef.current.startSec;
    const endSec = trimRef.current.endSec;
    try {
      const pos = playerRef.current?.currentTime ?? 0;
      if (pos < startSec || pos >= endSec) {
        if (playerRef.current) playerRef.current.currentTime = startSec;
      }
      playerRef.current?.play();
      isPlayingRef.current = true;
      setIsPlaying(true);
    } catch {
      /* ignore */
    }
  }, [videoReady]);

  const togglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [startPlayback, stopPlayback]);

  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubSecRef = useRef<number | null>(null);

  const handleTrimChange = useCallback((next: VideoTrimEditorValue) => {
    trimRef.current = next;
    setTrim(next);
  }, []);

  const handleScrubPreview = useCallback((sec: number | null, _edge: 'start' | 'end' | null) => {
    if (sec == null) {
      pendingScrubSecRef.current = null;
      if (scrubRafRef.current != null) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      return;
    }
    pendingScrubSecRef.current = sec;
    if (scrubRafRef.current != null) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      const t = pendingScrubSecRef.current;
      if (t == null || !playerRef.current) return;
      try {
        playerRef.current.currentTime = t;
      } catch {
        /* ignore */
      }
    });
  }, []);

  const handleDragActiveChange = useCallback((active: boolean) => {
    dragActiveRef.current = active;
    if (!active) {
      try {
        if (playerRef.current) playerRef.current.currentTime = trimRef.current.startSec;
      } catch {
        /* ignore */
      }
    } else {
      stopPlayback();
    }
  }, [stopPlayback]);

  const handleCancel = useCallback(() => {
    exportingRef.current = false;
    setIsConfirming(false);
    stopPlayback();
    onCancel();
  }, [onCancel, stopPlayback]);

  const handleConfirm = useCallback(async () => {
    if (exportingRef.current) return;
    if (!isVideoTrimNativeAvailable()) {
      Alert.alert(t('videoTrim.needsRebuildTitle'), t('videoTrim.needsRebuildBody'));
      return;
    }
    if (!videoReady || effectiveDurationSec <= 0) {
      return;
    }
    const range = trimRef.current;
    const clipSec = Math.max(0, range.endSec - range.startSec);
    if (clipSec < 1) {
      Alert.alert(t('videoTrim.tooShortTitle'), t('videoTrim.tooShortBody'));
      return;
    }
    if (clipSec > maxDurationSec + 1) {
      Alert.alert(t('videoTrim.stillTooLongTitle'), t('videoTrim.stillTooLongBody', { max: maxDurationSec }));
      return;
    }

    exportingRef.current = true;
    setIsConfirming(true);
    stopPlayback();
    try {
      playerRef.current?.pause();
    } catch {
      /* ignore */
    }
    setPlaybackUri('');
    setVideoReady(false);
    setFilmstripUris([]);
    onConfirm({ startSec: range.startSec, endSec: range.endSec });
  }, [effectiveDurationSec, maxDurationSec, onConfirm, stopPlayback, t, videoReady]);

  const editorReady = videoReady && effectiveDurationSec > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleCancel}
    >
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, scale(12)) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('videoTrim.title')}</Text>
          <TouchableOpacity
            onPress={handleCancel}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('videoTrim.cancel')}
          >
            <X size={scale(22)} color={THEME.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        <View style={styles.previewWrap}>
          {playbackUri && visible && !isConfirming ? (
            <TrimVideoPreview
              uri={playbackUri}
              playerRef={playerRef}
              playingRef={isPlayingRef}
              getTrim={() => trimRef.current}
              onReady={() => {
                setVideoReady(true);
                seekToTrimStart();
              }}
              onDurationSec={sec => {
                if (!(sec > 0)) return;
                setEffectiveDurationSec(prev => (prev > 0 ? Math.max(prev, sec) : sec));
              }}
              onPlayToEnd={() => {
                seekToTrimStart();
                isPlayingRef.current = false;
                setIsPlaying(false);
              }}
            />
          ) : (
            <View style={styles.previewPlaceholder} />
          )}
          {!editorReady ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={styles.previewLoadingText}>{t('mediaPrep.videoReady')}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.playFab}
            onPress={togglePlayback}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? t('videoTrim.pauseA11y') : t('videoTrim.playA11y')}
            disabled={!editorReady || isConfirming}
          >
            {isPlaying ? (
              <Pause size={scale(26)} color="#FFFFFF" fill="#FFFFFF" />
            ) : (
              <Play size={scale(26)} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: scale(3) }} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.editorBlock} pointerEvents={editorReady && !isConfirming ? 'auto' : 'none'}>
          <VideoTrimEditor
            durationSec={Math.max(1, effectiveDurationSec)}
            value={trim}
            maxClipSec={maxDurationSec}
            onChange={handleTrimChange}
            onDragActiveChange={handleDragActiveChange}
            onScrubPreview={handleScrubPreview}
            filmstripUris={filmstripUris}
            title={t('videoTrim.editorTitle')}
            subtitle={
              isFreeTier
                ? t('videoTrim.subtitleFree', { max: maxDurationSec })
                : t('videoTrim.subtitlePaid', { max: maxDurationSec })
            }
            subscribeLabel={isFreeTier && onUpgrade ? t('videoTrim.subscribe') : undefined}
            onSubscribe={isFreeTier && onUpgrade && !isConfirming ? onUpgrade : undefined}
            handleStartA11y={t('videoTrim.handleStartA11y')}
            handleEndA11y={t('videoTrim.handleEndA11y')}
            handleRangeA11y={t('videoTrim.handleRangeA11y')}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleCancel}
          >
            <Text style={styles.secondaryBtnText}>{t('videoTrim.cancel')}</Text>
          </TouchableOpacity>
          <PetitmoPrimaryPressable
            style={styles.primaryBtn}
            onPress={() => void handleConfirm()}
            disabled={!editorReady || isConfirming}
          >
            {isConfirming ? (
              <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
            ) : (
              <Text style={petitmoCtaStyles.primaryText}>{t('videoTrim.confirm')}</Text>
            )}
          </PetitmoPrimaryPressable>
        </View>
      </View>
    </Modal>
  );
}

function TrimVideoPreview({
  uri,
  playerRef,
  playingRef,
  getTrim,
  onReady,
  onDurationSec,
  onPlayToEnd,
}: {
  uri: string;
  playerRef: MutableRefObject<VideoPlayer | null>;
  playingRef: MutableRefObject<boolean>;
  getTrim: () => VideoTrimEditorValue;
  onReady: () => void;
  onDurationSec: (sec: number) => void;
  onPlayToEnd: () => void;
}) {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const readyOnceRef = useRef(false);

  useEffect(() => {
    readyOnceRef.current = false;
    const instance = createVideoPlayer(null);
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.05;
    playerRef.current = instance;
    setPlayer(instance);

    let cancelled = false;
    void (async () => {
      try {
        await instance.replaceAsync(uri);
      } catch (e) {
        console.warn('[VideoTrimModal] replaceAsync', e);
        if (!cancelled) {
          try {
            instance.replace(uri, true);
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current = null;
      try {
        instance.pause();
      } catch {
        /* ignore */
      }
      try {
        instance.release();
      } catch {
        /* ignore */
      }
      setPlayer(null);
    };
  }, [uri, playerRef]);

  useEffect(() => {
    if (!player) return;
    const loadSub = player.addListener('sourceLoad', ({ duration }) => {
      if (duration > 0) onDurationSec(Math.max(1, Math.round(duration)));
      if (!readyOnceRef.current) {
        readyOnceRef.current = true;
        onReady();
      }
      try {
        player.currentTime = getTrim().startSec;
      } catch {
        /* ignore */
      }
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const { startSec, endSec } = getTrim();
      if (currentTime >= endSec - 0.08) {
        try {
          player.currentTime = startSec;
          if (playingRef.current) player.play();
        } catch {
          /* ignore */
        }
      }
    });
    const endSub = player.addListener('playToEnd', () => {
      onPlayToEnd();
    });
    return () => {
      loadSub.remove();
      timeSub.remove();
      endSub.remove();
    };
  }, [player, getTrim, onDurationSec, onPlayToEnd, onReady, playingRef]);

  if (!player) {
    return <View style={styles.previewPlaceholder} />;
  }

  return (
    <PetitmoVideoView
      player={player}
      contentFit="contain"
      style={styles.previewVideo}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: THEME.bg,
    paddingHorizontal: scale(16),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: verticalScale(12),
  },
  headerTitle: {
    flex: 1,
    fontSize: scale(18),
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  closeBtn: {
    width: scale(40),
    height: scale(40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewWrap: {
    flex: 1,
    minHeight: verticalScale(220),
    borderRadius: scale(14),
    overflow: 'hidden',
    backgroundColor: '#111111',
    marginBottom: verticalScale(16),
  },
  previewVideo: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    backgroundColor: '#1A1A1A',
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: scale(10),
  },
  previewLoadingText: {
    color: '#FFFFFF',
    fontSize: scale(13),
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
  editorBlock: {
    marginBottom: verticalScale(8),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
    marginTop: verticalScale(8),
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: verticalScale(15),
    borderRadius: scale(20),
    borderWidth: 1,
    borderColor: THEME.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: scale(15),
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  primaryBtn: {
    flex: 1.4,
    paddingVertical: verticalScale(15),
  },
});

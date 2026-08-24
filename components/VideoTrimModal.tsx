import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
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
  isVideoTrimNativeAvailable,
  loadVideoTrimFilmstripUris,
  VIDEO_TRIM_FILMSTRIP_COUNT,
} from '@/services/videoTrimNative';

/** Plage choisie — le parent ferme la modale puis lance le trim natif (moins de RAM). */
export type VideoTrimModalConfirmResult = {
  startSec: number;
  endSec: number;
};

type Props = {
  visible: boolean;
  videoUri: string;
  durationSec: number;
  maxDurationSec: number;
  isFreeTier: boolean;
  onCancel: () => void;
  onConfirm: (result: VideoTrimModalConfirmResult) => void;
  onUpgrade?: () => void;
};

function initialTrimRange(durationSec: number, maxDurationSec: number): VideoTrimEditorValue {
  const total = Math.max(1, durationSec);
  const clip = Math.min(total, Math.max(1, maxDurationSec));
  return { startSec: 0, endSec: clip };
}

export function VideoTrimModal({
  visible,
  videoUri,
  durationSec,
  maxDurationSec,
  isFreeTier,
  onCancel,
  onConfirm,
  onUpgrade,
}: Props) {
  const { t } = useAppTranslation('common');
  const insets = useSafeAreaInsets();
  const videoRef = useRef<Video>(null);
  const trimRef = useRef<VideoTrimEditorValue>(initialTrimRange(durationSec, maxDurationSec));
  const isPlayingRef = useRef(false);
  const exportingRef = useRef(false);

  const [playbackUri, setPlaybackUri] = useState('');
  const [effectiveDurationSec, setEffectiveDurationSec] = useState(durationSec);
  const [trim, setTrim] = useState<VideoTrimEditorValue>(() =>
    initialTrimRange(durationSec, maxDurationSec),
  );
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [filmstripUris, setFilmstripUris] = useState<string[]>([]);

  trimRef.current = trim;

  useEffect(() => {
    if (!visible) return;
    const initial = initialTrimRange(durationSec, maxDurationSec);
    trimRef.current = initial;
    setTrim(initial);
    setEffectiveDurationSec(durationSec);
    setPlaybackUri(normalizeVideoPlaybackUri(videoUri));
    setVideoReady(false);
    setIsPlaying(false);
    isPlayingRef.current = false;
    exportingRef.current = false;
    setIsConfirming(false);
    setFilmstripUris([]);

    return () => {
      void videoRef.current?.stopAsync().catch(() => {});
      void videoRef.current?.unloadAsync().catch(() => {});
    };
  }, [visible, videoUri, durationSec, maxDurationSec]);

  useEffect(() => {
    if (!visible || effectiveDurationSec <= 0) return;
    setTrim(prev => {
      if (prev.endSec > 0 && prev.endSec <= effectiveDurationSec) return prev;
      const next = initialTrimRange(effectiveDurationSec, maxDurationSec);
      trimRef.current = next;
      return next;
    });
  }, [visible, effectiveDurationSec, maxDurationSec]);

  /**
   * Vignettes une fois le lecteur prêt : on évite de décoder les images en même temps
   * que le chargement de la preview. Extraction interrompue si la modale se ferme.
   */
  const filmstripLoadedForRef = useRef('');
  useEffect(() => {
    if (!visible || !videoReady || effectiveDurationSec <= 0) return;
    if (filmstripLoadedForRef.current === videoUri) return;
    filmstripLoadedForRef.current = videoUri;

    let alive = true;
    setFilmstripUris(Array.from({ length: VIDEO_TRIM_FILMSTRIP_COUNT }, () => ''));
    void loadVideoTrimFilmstripUris(videoUri, effectiveDurationSec, {
      shouldContinue: () => alive && !exportingRef.current,
      onFrame: (index, uri) => {
        if (!alive) return;
        setFilmstripUris(prev => {
          const next = [...prev];
          next[index] = uri;
          return next;
        });
      },
    });

    return () => {
      alive = false;
    };
  }, [visible, videoReady, effectiveDurationSec, videoUri]);

  const seekToTrimStart = useCallback(async () => {
    const startMs = Math.round(trimRef.current.startSec * 1000);
    try {
      await videoRef.current?.setPositionAsync(startMs);
    } catch {
      /* ignore */
    }
  }, []);

  const stopPlayback = useCallback(async () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    try {
      await videoRef.current?.pauseAsync();
    } catch {
      /* ignore */
    }
  }, []);

  const startPlayback = useCallback(async () => {
    if (!videoReady) return;
    const startMs = Math.round(trimRef.current.startSec * 1000);
    const endMs = Math.round(trimRef.current.endSec * 1000);
    try {
      const status = await videoRef.current?.getStatusAsync();
      const pos = status && 'positionMillis' in status ? status.positionMillis : 0;
      if (pos < startMs || pos >= endMs) {
        await videoRef.current?.setPositionAsync(startMs);
      }
      await videoRef.current?.playAsync();
      isPlayingRef.current = true;
      setIsPlaying(true);
    } catch {
      /* ignore */
    }
  }, [videoReady]);

  const togglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      void stopPlayback();
    } else {
      void startPlayback();
    }
  }, [startPlayback, stopPlayback]);

  const onPlaybackStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      if (status.durationMillis && status.durationMillis > 0) {
        const fromPlayer = Math.max(1, Math.round(status.durationMillis / 1000));
        setEffectiveDurationSec(prev => (prev > 0 ? Math.max(prev, fromPlayer) : fromPlayer));
      }
      const endMs = Math.round(trimRef.current.endSec * 1000);
      const startMs = Math.round(trimRef.current.startSec * 1000);
      if (status.positionMillis >= endMs - 80) {
        void videoRef.current?.setPositionAsync(startMs).then(() => {
          if (isPlayingRef.current) {
            void videoRef.current?.playAsync().catch(() => {});
          }
        });
      }
      if (status.didJustFinish) {
        void seekToTrimStart();
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    },
    [seekToTrimStart],
  );

  const handleTrimChange = useCallback(
    (next: VideoTrimEditorValue) => {
      trimRef.current = next;
      setTrim(next);
      void (async () => {
        try {
          const status = await videoRef.current?.getStatusAsync();
          const pos = status && 'positionMillis' in status ? status.positionMillis : 0;
          const startMs = Math.round(next.startSec * 1000);
          const endMs = Math.round(next.endSec * 1000);
          if (pos < startMs || pos > endMs) {
            await videoRef.current?.setPositionAsync(startMs);
          }
        } catch {
          /* ignore */
        }
      })();
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    if (exportingRef.current) return;
    if (!isVideoTrimNativeAvailable()) {
      Alert.alert(t('videoTrim.needsRebuildTitle'), t('videoTrim.needsRebuildBody'));
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
    await stopPlayback();
    try {
      await videoRef.current?.unloadAsync();
    } catch {
      /* ignore */
    }
    setPlaybackUri('');
    setVideoReady(false);
    setFilmstripUris([]);
    // Remonter la plage : le parent démonte la modale puis lance FFmpeg.
    onConfirm({ startSec: range.startSec, endSec: range.endSec });
  }, [maxDurationSec, onConfirm, stopPlayback, t]);

  const subtitle = isFreeTier
    ? t('videoTrim.subtitleFree', { max: maxDurationSec })
    : t('videoTrim.subtitlePaid', { max: maxDurationSec });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, scale(12)) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('videoTrim.title')}</Text>
          <TouchableOpacity
            onPress={onCancel}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('videoTrim.cancel')}
            disabled={isConfirming}
          >
            <X size={scale(22)} color={THEME.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        <View style={styles.previewWrap}>
          {playbackUri ? (
            <Video
              ref={videoRef}
              source={{ uri: playbackUri }}
              style={styles.previewVideo}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={false}
              isLooping={false}
              onLoad={() => {
                setVideoReady(true);
                void seekToTrimStart();
              }}
              onPlaybackStatusUpdate={onPlaybackStatus}
            />
          ) : (
            <View style={styles.previewPlaceholder} />
          )}
          {!videoReady ? (
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
            disabled={!videoReady || isConfirming}
          >
            {isPlaying ? (
              <Pause size={scale(26)} color="#FFFFFF" fill="#FFFFFF" />
            ) : (
              <Play size={scale(26)} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: scale(3) }} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.editorBlock}>
          <VideoTrimEditor
            durationSec={effectiveDurationSec}
            value={trim}
            maxClipSec={maxDurationSec}
            onChange={handleTrimChange}
            filmstripUris={filmstripUris}
            title={t('videoTrim.editorTitle')}
            subtitle={subtitle}
            handleStartA11y={t('videoTrim.handleStartA11y')}
            handleEndA11y={t('videoTrim.handleEndA11y')}
            handleRangeA11y={t('videoTrim.handleRangeA11y')}
          />
        </View>

        {isFreeTier && onUpgrade ? (
          <TouchableOpacity onPress={onUpgrade} style={styles.upgradeLink} disabled={isConfirming}>
            <Text style={styles.upgradeLinkText}>{t('parent.freeTierLimit.ctaPlus')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.secondaryBtn, isConfirming && styles.btnDisabled]}
            onPress={onCancel}
            disabled={isConfirming}
          >
            <Text style={styles.secondaryBtnText}>{t('videoTrim.cancel')}</Text>
          </TouchableOpacity>
          <PetitmoPrimaryPressable
            style={styles.primaryBtn}
            onPress={() => void handleConfirm()}
            disabled={isConfirming}
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
  upgradeLink: {
    alignSelf: 'center',
    paddingVertical: verticalScale(6),
    marginBottom: verticalScale(4),
  },
  upgradeLinkText: {
    fontSize: scale(14),
    fontWeight: '600',
    color: THEME.brandPrimary,
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
  btnDisabled: {
    opacity: 0.5,
  },
});

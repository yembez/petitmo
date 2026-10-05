import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { leaveCaptureFlowScreen } from '@/utils/leaveCaptureFlowScreen';
import {
  ChevronLeft,
  Mic,
  Square,
  Play,
  Pause,
  ImagePlus,
  Heart,
  Save,
  Lock,
  Pencil,
  ImageIcon,
  FolderOpen,
} from 'lucide-react-native';
import { Audio } from 'expo-av';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryMorphButton, {
  type PetitmoMorphPhase,
} from '@/components/PetitmoPrimaryMorphButton';
import { MOTION_CTA_MORPH_DISK_PT } from '@/constants/motion';
import PermissionModal from '@/components/PermissionModal';
import { uploadMedia } from '@/services/media';
import { getOrSelectFirstChild } from '@/services/children';
import { armFeedSnapToLatestOnFocus } from '@/services/feedScrollRestore';
import {
  enrichMemoryLocationInBackground,
  markLocationSoftPromptDeferred,
  requestForegroundLocationPermission,
  resolveCurrentPlaceLabelSilent,
  shouldShowLocationSoftPrompt,
} from '@/lib/memoryLocation';
import { getUserTier } from '@/lib/userTier';
import { FREE_TIER_LIMIT, FREE_TIER_VOICE_MAX_DURATION, PAID_TIER_VOICE_MAX_DURATION, checkMemoryLimit } from '@/lib/limits';
import { promptFreeTierLimitThenPaywall } from '@/utils/freeTierLimitGate';
import { isAudioTrimAvailable, trimAudioToLocalFile } from '@/services/audioTrim';
import { AudioTrimEditor } from '@/components/AudioTrimEditor';
import {
  emptyLiveMeterBars,
  LiveRecordingEnvelope,
  normalizeRecordingMeterDb,
  RecordingPulseControl,
} from '@/components/LiveRecordingVisual';
import {
  downsampleMeterHistory,
  serializeVoiceWavePeaks,
  sliceWavePeaks,
  VOICE_WAVE_PEAKS_COUNT,
} from '@/utils/voiceWavePeaks';
import { isVoiceDocumentPickerAvailable } from '@/services/voiceImport';
import { takePendingSharedVoice } from '@/lib/pendingShareMedia';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { isDeviceStorageFullError } from '@/utils/deviceStorageFull';
import {
  estimatedVoiceFileBytes,
  preflightVoiceCapture,
  readFreeDiskBytes,
  releaseVoiceCaptureSlot,
  voiceKeepReserveBytes,
  type VoiceCapturePreflightFailReason,
} from '@/utils/voiceCapturePreflight';
import { Sentry } from '@/lib/sentry';
import { copyAsync, getInfoAsync } from 'expo-file-system/legacy';

async function voiceFileBytes(uri: string | null): Promise<number> {
  if (!uri) return 0;
  try {
    const info = await getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number' && info.size > 0) return info.size;
  } catch {
    /* taille inconnue — le précontrôle retombe sur l’estimation */
  }
  return 0;
}

async function shareVoiceFile(uri: string): Promise<void> {
  try {
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(uri, {
      mimeType: 'audio/mp4',
      UTI: 'public.mpeg-4-audio',
    });
  } catch (e) {
    console.warn('[record-voice] share', e);
  }
}

export default function RecordVoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  /** Enveloppe needles live (metering expo-av) + niveau pour pulse. */
  const [meterBars, setMeterBars] = useState(emptyLiveMeterBars);
  const [meterLevel, setMeterLevel] = useState(0);
  const meterLevelRef = useRef(0);
  /** Historique metering complet → pics persistés pour la lecture. */
  const meterHistoryRef = useRef<number[]>([]);
  const [wavePeaks, setWavePeaks] = useState<number[] | null>(null);
  const [hasRecording, setHasRecording] = useState(false);
  /** Prise durable, mais le souvenir ne peut pas être écrit — pas d’écran « terminé ». */
  const [saveBlockReason, setSaveBlockReason] = useState<VoiceCapturePreflightFailReason | null>(null);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ctaPhase, setCtaPhase] = useState<PetitmoMorphPhase>('idle');
  const pendingAfterSuccessRef = useRef<(() => void) | null>(null);
  const pendingSaveAfterLocationRef = useRef<(() => void) | null>(null);
  const locationForNextSaveRef = useRef<string | null | undefined>(undefined);
  const [isImporting, setIsImporting] = useState(false);
  /** Masqué tant que le binaire natif n’inclut pas ExpoDocumentPicker (rebuild EAS). */
  const [importAvailable] = useState(() => isVoiceDocumentPickerAvailable());
  /** Photo d’illustration optionnelle (fond derrière le lecteur sur le fil) */
  const [coverUri, setCoverUri] = useState<string | null>(null);
  /** Extrait sélectionné (secondes) */
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);
  /** Lecture de l’extrait sélectionné (bouton play principal après enregistrement). */
  const [isExcerptPlaying, setIsExcerptPlaying] = useState(false);
  /** Évite que le ScrollView capte le geste horizontal des poignées de coupe. */
  const [trimScrollLocked, setTrimScrollLocked] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  /** Conservé avant stopAndUnloadAsync — getURI() peut être vide après déchargement. */
  const recordingFileUriRef = useRef<string | null>(null);
  /** Pour reprendre la pause seulement si les poignées n’ont pas bougé. */
  const lastExcerptTrimKeyRef = useRef<string>('');
  /** Repère l’extrait au moment où la lecture a démarré ; si le trim change pendant la lecture, on relance depuis le nouveau début. */
  const playingTrimBaselineRef = useRef<string | null>(null);
  /** Évite les lectures superposées : une seule session `startExcerptPlayback` active. */
  const excerptSessionRef = useRef({
    id: 0,
    stopTimer: null as ReturnType<typeof setTimeout> | null,
  });
  /** Pause demandée pendant que `createAsync` / seek n’a pas fini — ne pas forcer play. */
  const userStoppedPreviewRef = useRef(false);
  const isExcerptPlayingRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sharedVoiceConsumedRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const stoppingRef = useRef(false);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  /** Fichier d’accueil écrit avant le micro — libéré seulement si on n’a pas démarré. */
  const reserveUriRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const t = await getUserTier();
        setTier(t);
      } catch {
        setTier('free');
      }
    })();
    checkPermissions();

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      releaseVoiceCaptureSlot(reserveUriRef.current);
      reserveUriRef.current = null;
    };
  }, []);

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      checkPermissions();
    }
  };

  const checkPermissions = async () => {
    const result = await Audio.getPermissionsAsync();
    setHasPermission(result.granted);
  };

  const blockCopy = useCallback(
    (reason: VoiceCapturePreflightFailReason): string => {
      switch (reason) {
        case 'storage':
          return t('recordVoice.preflightStorage');
        case 'write':
          return t('recordVoice.preflightWrite');
        case 'auth':
          return t('recordVoice.preflightAuth');
        case 'no_child':
          return t('recordVoice.preflightNoChild');
        case 'limit':
          return t('parent.freeTierLimit.memoriesBody', { count: FREE_TIER_LIMIT });
        case 'capture_locked':
          return t('parent.freeTierLimit.captureLockedBody');
        default:
          return t('recordVoice.preflightUnknown');
      }
    },
    [t],
  );

  const promptMicSettings = useCallback(() => {
    Alert.alert(t('recordVoice.blockedTitle'), t('recordVoice.preflightMicDenied'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('recordVoice.preflightMicSettings'),
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]);
  }, [t]);

  const presentVoicePreflightBlock = useCallback(
    (
      pre: { ok: false; reason: VoiceCapturePreflightFailReason },
      opts: { takeKept: boolean },
    ) => {
      if (!opts.takeKept && (pre.reason === 'limit' || pre.reason === 'capture_locked')) {
        promptFreeTierLimitThenPaywall({
          kind: pre.reason === 'capture_locked' ? 'capture_locked' : 'memories',
          router,
          returnTo: 'fil',
        });
        return;
      }
      if (!opts.takeKept && pre.reason === 'no_child') {
        Alert.alert(t('recordVoice.blockedTitle'), t('recordVoice.preflightNoChild'));
        router.push('/create-child');
        return;
      }
      if (!opts.takeKept) {
        Alert.alert(t('recordVoice.blockedTitle'), blockCopy(pre.reason));
        return;
      }

      const uri = recordingFileUriRef.current;
      const buttons: {
        text: string;
        style?: 'cancel';
        onPress?: () => void;
      }[] = [];
      if (uri) {
        buttons.push({
          text: t('recordVoice.keepInFiles'),
          onPress: () => {
            void shareVoiceFile(uri);
          },
        });
      }
      if (pre.reason === 'limit' || pre.reason === 'capture_locked') {
        buttons.push({ text: t('parent.freeTierLimit.later'), style: 'cancel' });
        buttons.push({
          text: t('parent.freeTierLimit.ctaPlus'),
          onPress: () => {
            router.push({
              pathname: '/paywall',
              params: {
                context: pre.reason === 'capture_locked' ? 'EX_SUBSCRIBER' : 'LIMIT_REACHED',
              },
            });
          },
        });
      } else {
        buttons.push({ text: t('ok'), style: 'cancel' });
      }
      Alert.alert(t('recordVoice.notAddedTitle'), blockCopy(pre.reason), buttons);
    },
    [blockCopy, router, t],
  );

  const handleRequestPermission = async () => {
    const result = await Audio.requestPermissionsAsync();
    if (result.granted) {
      setHasPermission(true);
      setShowPermissionModal(false);
      /**
       * iOS : le dialog système doit se fermer avant `Recording.createAsync`,
       * sinon plantage intermittent au 1er grant.
       */
      await new Promise<void>(r => setTimeout(r, 400));
      await startRecording();
    } else {
      setShowPermissionModal(false);
      if (result.canAskAgain === false) promptMicSettings();
    }
  };

  const handleCancelPermission = () => {
    setShowPermissionModal(false);
  };

  const applyLoadedAudio = useCallback(
    async (uri: string, durationSec: number) => {
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      setIsExcerptPlaying(false);
      lastExcerptTrimKeyRef.current = '';
      recordingFileUriRef.current = uri;
      setHasRecording(true);
      setIsRecording(false);
      setCoverUri(null);
      meterHistoryRef.current = [];
      setWavePeaks(null);
      const total = Math.max(0, durationSec);
      setRecordingDuration(total);
      const maxClip =
        tier === 'free' ? FREE_TIER_VOICE_MAX_DURATION : PAID_TIER_VOICE_MAX_DURATION;
      setTrimStartSec(0);
      setTrimEndSec(Math.max(0, Math.min(total, maxClip)));
    },
    [tier],
  );

  /** Partager → Petitmo (Dictaphone) : audio déjà en sandbox. */
  useEffect(() => {
    if (sharedVoiceConsumedRef.current) return;
    const pending = takePendingSharedVoice();
    if (!pending) return;
    sharedVoiceConsumedRef.current = true;
    void (async () => {
      try {
        setIsImporting(true);
        const bytes = await voiceFileBytes(pending.uri);
        const pre = await preflightVoiceCapture({
          reserveBytes: voiceKeepReserveBytes(
            bytes || estimatedVoiceFileBytes(pending.durationSec),
          ),
        });
        if (!pre.ok) {
          recordingFileUriRef.current = pending.uri;
          await applyLoadedAudio(pending.uri, pending.durationSec);
          setSaveBlockReason(pre.reason);
          presentVoicePreflightBlock(pre, { takeKept: true });
          return;
        }
        setSaveBlockReason(null);
        await applyLoadedAudio(pending.uri, pending.durationSec);
      } catch (e) {
        if (isDeviceStorageFullError(e)) {
          Alert.alert(t('recordVoice.blockedTitle'), t('recordVoice.preflightStorage'));
        } else {
          console.error('[record-voice] shared voice', e);
          Alert.alert(t('error'), t('recordVoice.importFailed'));
        }
      } finally {
        setIsImporting(false);
      }
    })();
  }, [applyLoadedAudio, presentVoicePreflightBlock, t]);

  const startRecording = async () => {
    try {
      const perm = await Audio.getPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain === false) {
          promptMicSettings();
          return;
        }
        setShowPermissionModal(true);
        return;
      }
      setHasPermission(true);

      releaseVoiceCaptureSlot(reserveUriRef.current);
      reserveUriRef.current = null;

      const pre = await preflightVoiceCapture({ allocateSlot: true });
      if (!pre.ok) {
        presentVoicePreflightBlock(pre, { takeKept: false });
        return;
      }
      reserveUriRef.current = pre.reserveUri ?? null;

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setIsExcerptPlaying(false);
      lastExcerptTrimKeyRef.current = '';

      const armAudioSession = async () => {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        await new Promise<void>(r => setTimeout(r, 120));
      };

      await armAudioSession();

      meterLevelRef.current = 0;
      meterHistoryRef.current = [];
      setMeterBars(emptyLiveMeterBars());
      setMeterLevel(0);
      setWavePeaks(null);

      const onRecordingStatus = (status: Audio.RecordingStatus) => {
        if (!status.isRecording || typeof status.metering !== 'number') return;
        const norm = normalizeRecordingMeterDb(status.metering);
        const smoothed = meterLevelRef.current * 0.55 + norm * 0.45;
        meterLevelRef.current = smoothed;
        meterHistoryRef.current.push(smoothed);
        setMeterLevel(smoothed);
        setMeterBars(prev => {
          const next = prev.slice(1);
          next.push(Math.max(0.06, smoothed));
          return next;
        });
      };

      let recording: Audio.Recording;
      try {
        ({ recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
          onRecordingStatus,
          50,
        ));
      } catch (firstErr) {
        console.warn('[record-voice] createAsync retry after session settle', firstErr);
        await armAudioSession();
        ({ recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
          onRecordingStatus,
          50,
        ));
      }

      recordingRef.current = recording;
      recordingFileUriRef.current = null;
      recordingDurationRef.current = 0;
      setIsRecording(true);
      setHasRecording(false);
      setSaveBlockReason(null);
      setRecordingDuration(0);
      setCoverUri(null);

      timerRef.current = setInterval(() => {
        recordingDurationRef.current += 1;
        const sec = recordingDurationRef.current;
        setRecordingDuration(sec);
        if (sec % 2 !== 0) return;
        const free = readFreeDiskBytes();
        const need = voiceKeepReserveBytes(estimatedVoiceFileBytes(sec));
        if (free != null && free < need) {
          void stopRecordingRef.current();
        }
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      releaseVoiceCaptureSlot(reserveUriRef.current);
      reserveUriRef.current = null;
      setIsRecording(false);
      Alert.alert(
        t('recordVoice.blockedTitle'),
        isDeviceStorageFullError(error)
          ? t('recordVoice.preflightStorage')
          : t('recordVoice.startFailed'),
      );
    }
  };

  const importAudio = async () => {
    if (isRecording || isImporting || isSaving) return;
    if (!importAvailable) {
      Alert.alert(t('error'), t('recordVoice.importNeedsRebuild'));
      return;
    }
    try {
      const pre = await preflightVoiceCapture();
      if (!pre.ok) {
        presentVoicePreflightBlock(pre, { takeKept: false });
        return;
      }

      setIsImporting(true);
      const { pickVoiceAudioFromFiles } = await import('@/services/voiceImport');
      const picked = await pickVoiceAudioFromFiles();
      if (!picked) return;
      const bytes = await voiceFileBytes(picked.uri);
      const filePre = await preflightVoiceCapture({
        reserveBytes: voiceKeepReserveBytes(
          bytes || estimatedVoiceFileBytes(picked.durationSec),
        ),
      });
      if (!filePre.ok) {
        recordingFileUriRef.current = picked.uri;
        await applyLoadedAudio(picked.uri, picked.durationSec);
        setSaveBlockReason(filePre.reason);
        presentVoicePreflightBlock(filePre, { takeKept: true });
        return;
      }
      setSaveBlockReason(null);
      await applyLoadedAudio(picked.uri, picked.durationSec);
    } catch (e) {
      if (e instanceof Error && e.message === 'DOCUMENT_PICKER_UNAVAILABLE') {
        Alert.alert(t('error'), t('recordVoice.importNeedsRebuild'));
        return;
      }
      if (isDeviceStorageFullError(e)) {
        Alert.alert(t('recordVoice.blockedTitle'), t('recordVoice.preflightStorage'));
        return;
      }
      if (e instanceof Error && e.message === 'AUDIO_TOO_SHORT') {
        Alert.alert(t('error'), t('recordVoice.importTooShort'));
        return;
      }
      console.error('importAudio', e);
      Alert.alert(t('error'), t('recordVoice.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const onPressImport = () => {
    void importAudio();
  };

  const stopRecording = async () => {
    if (stoppingRef.current) return;
    if (!recordingRef.current) return;
    stoppingRef.current = true;
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      setIsRecording(false);
      setMeterLevel(0);
      meterLevelRef.current = 0;
      setMeterBars(emptyLiveMeterBars());
      const peaks = downsampleMeterHistory(meterHistoryRef.current, VOICE_WAVE_PEAKS_COUNT);
      setWavePeaks(peaks.length >= 8 ? peaks : null);
      const fileUri = recordingRef.current.getURI() ?? null;
      const takenSec = recordingDurationRef.current;
      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => {});

      const slot = reserveUriRef.current;
      let durableUri: string | null = null;
      if (fileUri && slot) {
        try {
          await copyAsync({ from: fileUri, to: slot });
          durableUri = slot;
          reserveUriRef.current = null;
        } catch (copyErr) {
          console.warn('[record-voice] persist take into reserved slot', copyErr);
          durableUri = fileUri;
        }
      } else if (fileUri) {
        durableUri = fileUri;
      }
      recordingFileUriRef.current = durableUri;

      if (!durableUri) {
        releaseVoiceCaptureSlot(slot);
        reserveUriRef.current = null;
        setHasRecording(false);
        setSaveBlockReason(null);
        setRecordingDuration(0);
        recordingDurationRef.current = 0;
        Alert.alert(t('recordVoice.blockedTitle'), t('recordVoice.startFailed'));
        return;
      }

      const bytes = await voiceFileBytes(durableUri);
      const pre = await preflightVoiceCapture({
        reserveBytes: voiceKeepReserveBytes(bytes || estimatedVoiceFileBytes(takenSec)),
      });
      const maxClip =
        tier === 'free' ? FREE_TIER_VOICE_MAX_DURATION : PAID_TIER_VOICE_MAX_DURATION;
      setTrimStartSec(0);
      setTrimEndSec(Math.max(0, Math.min(takenSec, maxClip)));
      setHasRecording(true);
      if (!pre.ok) {
        setSaveBlockReason(pre.reason);
        presentVoicePreflightBlock(pre, { takeKept: true });
        return;
      }
      setSaveBlockReason(null);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      const fallback = recordingRef.current?.getURI() ?? recordingFileUriRef.current;
      if (fallback) {
        recordingFileUriRef.current = fallback;
        setHasRecording(true);
        setSaveBlockReason(null);
        return;
      }
      releaseVoiceCaptureSlot(reserveUriRef.current);
      reserveUriRef.current = null;
      setHasRecording(false);
      setSaveBlockReason(null);
      Alert.alert(
        t('recordVoice.blockedTitle'),
        isDeviceStorageFullError(error)
          ? t('recordVoice.preflightStorage')
          : t('recordVoice.startFailed'),
      );
    } finally {
      stoppingRef.current = false;
    }
  };
  stopRecordingRef.current = stopRecording;

  useEffect(() => {
    if (!isRecording) return;
    const maxSec =
      tier === 'paid' ? PAID_TIER_VOICE_MAX_DURATION : FREE_TIER_VOICE_MAX_DURATION;
    if (recordingDuration < maxSec) return;
    void stopRecording();
  }, [isRecording, recordingDuration, tier]);

  const clampTrim = useCallback(
    (nextStart: number, nextEnd: number) => {
      const total = Math.max(0, recordingDuration);
      let s = Math.max(0, Math.min(total, nextStart));
      let e = Math.max(0, Math.min(total, nextEnd));
      if (e < s) e = s;
      const maxClip =
        tier === 'free' ? FREE_TIER_VOICE_MAX_DURATION : PAID_TIER_VOICE_MAX_DURATION;
      if (e - s > maxClip) {
        e = s + maxClip;
        if (e > total) {
          e = total;
          s = Math.max(0, e - maxClip);
        }
      }
      const q = (x: number) => Math.round(Math.max(0, x) * 1000) / 1000;
      setTrimStartSec(q(s));
      setTrimEndSec(q(e));
    },
    [recordingDuration, tier]
  );

  useEffect(() => {
    isExcerptPlayingRef.current = isExcerptPlaying;
  }, [isExcerptPlaying]);

  const stopExcerptPlayback = useCallback(async () => {
    excerptSessionRef.current.id += 1;
    if (excerptSessionRef.current.stopTimer) {
      clearTimeout(excerptSessionRef.current.stopTimer);
      excerptSessionRef.current.stopTimer = null;
    }
    userStoppedPreviewRef.current = true;
    setIsExcerptPlaying(false);
    lastExcerptTrimKeyRef.current = '';
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }, []);

  const startExcerptPlayback = useCallback(async (startSec: number, endSec: number) => {
    excerptSessionRef.current.id += 1;
    const runId = excerptSessionRef.current.id;
    if (excerptSessionRef.current.stopTimer) {
      clearTimeout(excerptSessionRef.current.stopTimer);
      excerptSessionRef.current.stopTimer = null;
    }
    userStoppedPreviewRef.current = false;

    const stopAtMs = endSec * 1000;

    const finishExcerpt = () => {
      if (runId !== excerptSessionRef.current.id) return;
      if (excerptSessionRef.current.stopTimer) {
        clearTimeout(excerptSessionRef.current.stopTimer);
        excerptSessionRef.current.stopTimer = null;
      }
      setIsExcerptPlaying(false);
      lastExcerptTrimKeyRef.current = '';
      void soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };

    const onPlaybackStatusUpdate = (status: { isLoaded: boolean; didJustFinish?: boolean; positionMillis?: number }) => {
      if (runId !== excerptSessionRef.current.id) return;
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        finishExcerpt();
        return;
      }
      const pos = typeof status.positionMillis === 'number' ? status.positionMillis : 0;
      if (pos >= stopAtMs - 80) {
        void soundRef.current?.stopAsync().catch(() => {});
        finishExcerpt();
      }
    };

    try {
      const uri = recordingFileUriRef.current ?? recordingRef.current?.getURI();
      if (!uri) return;
      if (endSec - startSec < 0.01) return;

      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      if (runId !== excerptSessionRef.current.id) {
        await sound.unloadAsync().catch(() => {});
        return;
      }
      if (userStoppedPreviewRef.current) {
        await sound.unloadAsync().catch(() => {});
        return;
      }

      soundRef.current = sound;
      setIsExcerptPlaying(true);

      const windowMs = Math.max(0, stopAtMs - startSec * 1000);
      excerptSessionRef.current.stopTimer = setTimeout(() => {
        excerptSessionRef.current.stopTimer = null;
        if (runId !== excerptSessionRef.current.id) return;
        void sound.stopAsync().catch(() => {});
        finishExcerpt();
      }, windowMs + 400);

      await sound.setPositionAsync(startSec * 1000);
      if (runId !== excerptSessionRef.current.id || userStoppedPreviewRef.current) {
        await sound.unloadAsync().catch(() => {});
        if (soundRef.current === sound) soundRef.current = null;
        return;
      }
      await sound.playAsync();
    } catch (e) {
      console.error('startExcerptPlayback', e);
      if (runId === excerptSessionRef.current.id) {
        setIsExcerptPlaying(false);
        lastExcerptTrimKeyRef.current = '';
        void soundRef.current?.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      Alert.alert('Erreur', "Impossible d'écouter l’extrait.");
    }
  }, []);

  const toggleExcerptPlayback = useCallback(async () => {
    const uri = recordingFileUriRef.current ?? recordingRef.current?.getURI();
    if (!uri || trimEndSec - trimStartSec < 0.01) return;

    const trimKey = `${trimStartSec}-${trimEndSec}`;
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            userStoppedPreviewRef.current = true;
            await soundRef.current.pauseAsync();
            setIsExcerptPlaying(false);
            return;
          }
          if (lastExcerptTrimKeyRef.current === trimKey) {
            userStoppedPreviewRef.current = false;
            await soundRef.current.playAsync();
            setIsExcerptPlaying(true);
            return;
          }
        }
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }

      lastExcerptTrimKeyRef.current = trimKey;
      await startExcerptPlayback(trimStartSec, trimEndSec);
    } catch (e) {
      console.error('toggleExcerptPlayback', e);
      await stopExcerptPlayback();
      Alert.alert('Erreur', "Impossible d'écouter l’extrait.");
    }
  }, [startExcerptPlayback, stopExcerptPlayback, trimEndSec, trimStartSec]);

  useEffect(() => {
    if (!isExcerptPlaying) {
      playingTrimBaselineRef.current = null;
      return;
    }
    const key = `${trimStartSec}-${trimEndSec}`;
    if (playingTrimBaselineRef.current === null) {
      playingTrimBaselineRef.current = key;
      return;
    }
    if (playingTrimBaselineRef.current === key) return;
    playingTrimBaselineRef.current = key;

    const debounceMs = 90;
    const startAt = trimStartSec;
    const endAt = trimEndSec;
    const t = setTimeout(() => {
      if (!isExcerptPlayingRef.current) return;
      const latestKey = `${startAt}-${endAt}`;
      if (latestKey !== playingTrimBaselineRef.current) return;
      lastExcerptTrimKeyRef.current = latestKey;
      void startExcerptPlayback(startAt, endAt);
    }, debounceMs);

    return () => clearTimeout(t);
  }, [trimStartSec, trimEndSec, isExcerptPlaying, startExcerptPlayback]);

  const assertVoiceCanBeSaved = async (): Promise<boolean> => {
    const uri = recordingFileUriRef.current;
    const bytes = await voiceFileBytes(uri);
    const pre = await preflightVoiceCapture({
      reserveBytes: voiceKeepReserveBytes(
        bytes || estimatedVoiceFileBytes(recordingDurationRef.current || recordingDuration),
      ),
    });
    if (!pre.ok) {
      setSaveBlockReason(pre.reason);
      presentVoicePreflightBlock(pre, { takeKept: true });
      return false;
    }
    setSaveBlockReason(null);
    return true;
  };

  const saveRecording = async () => {
    if (!hasRecording || (!recordingFileUriRef.current && !recordingRef.current)) return;
    if (ctaPhase !== 'idle') return;
    if (!(await assertVoiceCanBeSaved())) return;

    if (await shouldShowLocationSoftPrompt()) {
      pendingSaveAfterLocationRef.current = () => {
        void saveRecordingAfterLocationReady();
      };
      setShowLocationModal(true);
      return;
    }

    await saveRecordingAfterLocationReady();
  };

  const saveRecordingAfterLocationReady = async () => {
    if (!hasRecording || (!recordingFileUriRef.current && !recordingRef.current)) return;
    if (!(await assertVoiceCanBeSaved())) return;

    try {
      setIsSaving(true);
      setCtaPhase('busy');

      const childId = await getOrSelectFirstChild();
      if (!childId) {
        setCtaPhase('idle');
        setIsSaving(false);
        setSaveBlockReason('no_child');
        presentVoicePreflightBlock({ ok: false, reason: 'no_child' }, { takeKept: true });
        return;
      }

      if (tier === 'free') {
        const memLimit = await checkMemoryLimit(childId, { skipRemotePull: true });
        if (!memLimit.canCreate) {
          const reason = memLimit.reason === 'capture_locked' ? 'capture_locked' : 'limit';
          setSaveBlockReason(reason);
          setCtaPhase('idle');
          setIsSaving(false);
          presentVoicePreflightBlock({ ok: false, reason }, { takeKept: true });
          return;
        }
      }

      const uri = recordingFileUriRef.current ?? recordingRef.current?.getURI();
      if (!uri) {
        Alert.alert('Erreur', "Aucun enregistrement trouvé");
        setCtaPhase('error');
        setIsSaving(false);
        return;
      }

      // Trim : découpe native si dispo ; sinon fichier complet + `voice_playback_start_sec` (lecture fenêtrée).
      let finalUri = uri;
      let finalDuration = recordingDuration;
      let voicePlaybackStartSec: number | null = null;
      const s = Math.max(0, trimStartSec);
      const e = Math.max(s, trimEndSec);
      const clipDur = e - s;
      const needsTrim =
        clipDur > 0.01 && (s > 1e-3 || e < recordingDuration - 1e-3);

      if (tier === 'free' && clipDur > FREE_TIER_VOICE_MAX_DURATION + 0.01) {
        Alert.alert('Dernière étape', 'En plan gratuit, choisis un extrait de 1 minute maximum.');
        setCtaPhase('idle');
        setIsSaving(false);
        return;
      }
      if (tier === 'paid' && clipDur > PAID_TIER_VOICE_MAX_DURATION + 0.01) {
        Alert.alert('Dernière étape', 'Choisis un extrait de 5 minutes maximum.');
        setCtaPhase('idle');
        setIsSaving(false);
        return;
      }

      if (needsTrim) {
        if (isAudioTrimAvailable()) {
          try {
            const out = await trimAudioToLocalFile({ inputUri: uri, startSec: s, endSec: e });
            finalUri = out.outputUri;
            finalDuration = Math.round(out.durationSec);
            voicePlaybackStartSec = null;
          } catch {
            finalUri = uri;
            finalDuration = Math.round(clipDur);
            voicePlaybackStartSec = Math.round(s * 1000) / 1000;
          }
        } else {
          finalUri = uri;
          finalDuration = Math.round(clipDur);
          voicePlaybackStartSec = Math.round(s * 1000) / 1000;
        }
      } else if (tier === 'free' && recordingDuration > FREE_TIER_VOICE_MAX_DURATION) {
        Alert.alert('Dernière étape', 'En plan gratuit, choisis un extrait de 1 minute maximum.');
        setCtaPhase('idle');
        setIsSaving(false);
        return;
      } else if (tier === 'paid' && recordingDuration > PAID_TIER_VOICE_MAX_DURATION) {
        Alert.alert('Dernière étape', 'Choisis un extrait de 5 minutes maximum.');
        setCtaPhase('idle');
        setIsSaving(false);
        return;
      }

      const locationOverride =
        locationForNextSaveRef.current !== undefined
          ? locationForNextSaveRef.current
          : null;
      locationForNextSaveRef.current = undefined;

      const peaksForSave =
        wavePeaks && wavePeaks.length >= 8
          ? needsTrim
            ? sliceWavePeaks(wavePeaks, s, e, recordingDuration)
            : wavePeaks
          : null;

      const result = await uploadMedia({
        uri: finalUri,
        type: 'voice',
        childId,
        duration: finalDuration,
        voiceCoverUri: coverUri,
        voicePlaybackStartSec,
        voiceWavePeaks: serializeVoiceWavePeaks(peaksForSave),
        locationOverride,
      });

      if (result) {
        if (!result.location?.trim()) {
          void enrichMemoryLocationInBackground(result.id);
        }
        armFeedSnapToLatestOnFocus();
        pendingAfterSuccessRef.current = () => {
          router.push('/(tabs)/fil');
        };
        setCtaPhase('success');
      } else {
        setCtaPhase('idle');
        Alert.alert(t('error'), t('recordVoice.saveFailedKeep'));
      }
    } catch (error) {
      if (error instanceof Error && (error.message === 'LIMIT_REACHED' || error.message === 'CAPTURE_LOCKED' || error.message === 'VIDEO_LIMIT_REACHED')) {
        const reason = error.message === 'CAPTURE_LOCKED' ? 'capture_locked' : 'limit';
        setSaveBlockReason(reason);
        setCtaPhase('idle');
        presentVoicePreflightBlock({ ok: false, reason }, { takeKept: true });
        return;
      }
      Sentry.captureException(error, {
        tags: { 'app.errorScope': 'recordVoice.save' },
      });
      console.error('Failed to save recording:', error);
      setCtaPhase('idle');
      if (isDeviceStorageFullError(error)) {
        setSaveBlockReason('storage');
        Alert.alert(t('recordVoice.notAddedTitle'), t('recordVoice.preflightStorage'));
      } else {
        Alert.alert(t('recordVoice.notAddedTitle'), t('recordVoice.saveFailedKeep'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const onLocationAuthorize = useCallback(() => {
    setShowLocationModal(false);
    void (async () => {
      const granted = await requestForegroundLocationPermission();
      let label: string | null = null;
      if (granted) {
        label = await resolveCurrentPlaceLabelSilent({ timeoutMs: 12000 });
        if (!label) {
          await new Promise<void>(r => setTimeout(r, 800));
          label = await resolveCurrentPlaceLabelSilent({ timeoutMs: 12000 });
        }
      }
      locationForNextSaveRef.current = label;
      const next = pendingSaveAfterLocationRef.current;
      pendingSaveAfterLocationRef.current = null;
      next?.();
    })();
  }, []);

  const onLocationLater = useCallback(() => {
    setShowLocationModal(false);
    void (async () => {
      await markLocationSoftPromptDeferred();
      locationForNextSaveRef.current = null;
      const next = pendingSaveAfterLocationRef.current;
      pendingSaveAfterLocationRef.current = null;
      next?.();
    })();
  }, []);

  const resetCtaIdle = useCallback(() => {
    setCtaPhase('idle');
  }, []);

  const discardRecordingAndLeave = useCallback(() => {
    if (isSaving || ctaPhase !== 'idle') return;
    void (async () => {
      try {
        await stopExcerptPlayback();
      } catch {
        /* */
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {
          /* */
        }
        recordingRef.current = null;
      }
      recordingFileUriRef.current = null;
      releaseVoiceCaptureSlot(reserveUriRef.current);
      reserveUriRef.current = null;
      setHasRecording(false);
      setSaveBlockReason(null);
      setIsRecording(false);
      setCoverUri(null);
      setTrimStartSec(0);
      setTrimEndSec(0);
      setCtaPhase('idle');
      leaveCaptureFlowScreen(router);
    })();
  }, [ctaPhase, isSaving, router, stopExcerptPlayback]);

  const onHeaderBack = useCallback(() => {
    if (hasRecording && !isRecording) {
      discardRecordingAndLeave();
      return;
    }
    leaveCaptureFlowScreen(router);
  }, [discardRecordingAndLeave, hasRecording, isRecording, router]);

  const onSaveSuccessHoldEnd = useCallback(() => {
    const next = pendingAfterSuccessRef.current;
    pendingAfterSuccessRef.current = null;
    next?.();
  }, []);

  /** Opt-in compte + demande iOS si besoin. */
  const pickCoverImage = async () => {
    try {
      const { ensureMediaLibraryPickerAllowed } = await import('@/lib/mediaLibraryOptIn');
      if (!(await ensureMediaLibraryPickerAllowed())) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
        aspect: [4, 5],
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setCoverUri(result.assets[0].uri);
      }
    } catch (e) {
      console.error('pickCoverImage', e);
      Alert.alert('Erreur', 'Impossible de choisir une image.');
    }
  };

  const formatDuration = (seconds: number) => {
    const totalSec = Math.max(0, Math.round(seconds));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (hasPermission === null) {
    return <View style={styles.container} />;
  }

  const showPostRecordFooter = hasRecording && !isRecording;
  const voiceMaxSec =
    tier === 'free' ? FREE_TIER_VOICE_MAX_DURATION : PAID_TIER_VOICE_MAX_DURATION;
  const needsTrimCoach = showPostRecordFooter && recordingDuration > voiceMaxSec + 0.01;

  return (
    <View style={styles.container}>
      <PermissionModal
        visible={showPermissionModal}
        type="microphone"
        onRequestPermission={() => void handleRequestPermission()}
        onCancel={handleCancelPermission}
      />
      <PermissionModal
        visible={showLocationModal}
        type="location"
        onRequestPermission={onLocationAuthorize}
        onCancel={onLocationLater}
      />

      <View style={[styles.header, showPostRecordFooter && styles.headerTight]}>
        <TouchableOpacity
          onPress={onHeaderBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('recordVoice.cancel')}
        >
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
        {showPostRecordFooter ? (
          <TouchableOpacity
            onPress={discardRecordingAndLeave}
            style={styles.headerCancel}
            disabled={isSaving || ctaPhase !== 'idle'}
            accessibilityRole="button"
            accessibilityLabel={t('recordVoice.cancel')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.headerCancelText,
                (isSaving || ctaPhase !== 'idle') && styles.cancelButtonTextDisabled,
              ]}
            >
              {t('recordVoice.cancel')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerCancelSpacer} />
        )}
      </View>

      {showPostRecordFooter ? (
        <ScrollView
          style={styles.postScroll}
          contentContainerStyle={[
            styles.postScrollContent,
            { paddingBottom: Math.max(insets.bottom, verticalScale(20)) },
          ]}
          scrollEnabled={!trimScrollLocked}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {saveBlockReason ? (
            <View style={styles.postRecordHead}>
              <Text style={styles.limitHint}>{t('recordVoice.subtitleBlocked')}</Text>
              <Text style={styles.limitHint}>{blockCopy(saveBlockReason)}</Text>
            </View>
          ) : needsTrimCoach ? (
            <View style={styles.postRecordHead}>
              <Text style={styles.limitHint}>
                {tier === 'free' ? t('recordVoice.limitFree') : t('recordVoice.limitPaid')}
              </Text>
            </View>
          ) : null}

          <View style={styles.editSurfaceCard}>
            <AudioTrimEditor
              presentation="editorCard"
              durationSec={recordingDuration}
              tier={tier}
              showCoachTitle={needsTrimCoach}
              coachTitle={t('recordVoice.pickBestMoment')}
              value={{ startSec: trimStartSec, endSec: trimEndSec }}
              onChange={v => clampTrim(v.startSec, v.endSec)}
              onDragActiveChange={setTrimScrollLocked}
              wavePeaks={wavePeaks}
            />
            <TouchableOpacity
              style={styles.playMaquette}
              onPress={() => void toggleExcerptPlayback()}
              accessibilityLabel={isExcerptPlaying ? 'Pause' : 'Lire l’extrait'}
            >
              {isExcerptPlaying ? (
                <Pause size={scale(22)} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
              ) : (
                <Play size={scale(22)} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.rerecordInCard} onPress={() => void startRecording()} activeOpacity={0.8}>
              <Mic size={scale(18)} color={THEME.textPrimary} strokeWidth={2} />
              <Text style={styles.rerecordInCardText}>{t('recordVoice.rerecord')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bookBanner}>
            <Heart
              size={scale(20)}
              color="#D4784A"
              fill="#D4784A"
              strokeWidth={0}
              style={styles.bookBannerIcon}
            />
            <Text style={styles.bookBannerText}>
              Ce souvenir pourra être réécouté dans ton{' '}
              <Text style={styles.bookBannerBold}>livre imprimé</Text>.
            </Text>
          </View>

          <View style={styles.illustrateBlock}>
            {coverUri ? (
              <>
                <View style={styles.coverFrame}>
                  <Image source={{ uri: coverUri }} style={styles.coverPreviewLarge} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.pencilFab}
                    onPress={pickCoverImage}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Changer la photo"
                  >
                    <Pencil size={scale(16)} color="#FFFFFF" strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.changePhotoRow}
                  onPress={pickCoverImage}
                  activeOpacity={0.85}
                >
                  <ImageIcon size={scale(20)} color={THEME.textPrimary} strokeWidth={2} />
                  <Text style={styles.changePhotoText}>Changer la photo</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.coverAddMaquette} onPress={pickCoverImage} activeOpacity={0.85}>
                <ImagePlus size={scale(22)} color={THEME.textPrimary} strokeWidth={2} />
                <Text style={styles.coverAddMaquetteText}>Ajouter une photo</Text>
              </TouchableOpacity>
            )}
          </View>

          <PetitmoPrimaryMorphButton
            style={styles.saveButtonMaquette}
            height={MOTION_CTA_MORPH_DISK_PT}
            phase={ctaPhase}
            onPress={() => void saveRecording()}
            disabled={isSaving || ctaPhase !== 'idle'}
            onSuccessHoldEnd={onSaveSuccessHoldEnd}
            onErrorShakeEnd={resetCtaIdle}
            accessibilityLabel={t('recordVoice.save')}
          >
            <View style={styles.saveButtonMaquetteInner}>
              <Save size={scale(18)} color={THEME.captureScreenCtaForeground} strokeWidth={2} />
              <Text style={[petitmoCtaStyles.primaryText, styles.saveButtonMaquetteText]}>
                {t('recordVoice.save')}
              </Text>
            </View>
          </PetitmoPrimaryMorphButton>

          {saveBlockReason ? null : (
            <View style={styles.privacyRow}>
              <Lock size={scale(14)} color={THEME.textMuted} strokeWidth={2} />
              <Text style={styles.privacyText}>Enregistré de façon privée et sécurisée</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.preRecordBody}>
          <View style={styles.titleSection}>
            <Text style={styles.title}>{t('recordVoice.title')}</Text>
          </View>

          {isRecording ? (
            <>
              <View style={styles.visualSection}>
                <View style={styles.waveformContainer}>
                  <LiveRecordingEnvelope bars={meterBars} />
                </View>
                <Text style={styles.duration}>{formatDuration(recordingDuration)}</Text>
              </View>
              <View style={styles.controls}>
                <RecordingPulseControl
                  level={meterLevel}
                  onPress={() => void stopRecording()}
                  style={styles.stopButton}
                  accessibilityLabel={t('recordVoice.stopA11y')}
                >
                  <Square size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                </RecordingPulseControl>
              </View>
            </>
          ) : (
            <View style={styles.idleCluster}>
              <View style={styles.quotaBlock}>
                <Text style={styles.quotaHint}>
                  {tier === 'free' ? t('recordVoice.quotaHintFree') : t('recordVoice.quotaHintPaid')}
                </Text>
                {tier === 'free' ? (
                  <>
                    <Text style={styles.quotaHint}>{t('recordVoice.quotaHintFreeUpgrade')}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        router.push({ pathname: '/paywall', params: { context: 'GENERAL' } });
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="link"
                      accessibilityLabel={t('recordVoice.subscribe')}
                      style={styles.subscribeHit}
                    >
                      <Text style={styles.subscribeLink}>{t('recordVoice.subscribe')}</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
              <View style={styles.controls}>
                <View style={styles.preRecordActions}>
                  <View style={styles.preRecordActionCol}>
                    <TouchableOpacity
                      style={styles.recordButton}
                      onPress={() => void startRecording()}
                      accessibilityRole="button"
                      accessibilityLabel={t('recordVoice.mic')}
                    >
                      <Mic size={scale(40)} color="#FFFFFF" strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.preRecordActionLabel}>{t('recordVoice.mic')}</Text>
                  </View>
                  {importAvailable ? (
                    <View style={styles.preRecordActionCol}>
                      <TouchableOpacity
                        style={[styles.importButton, isImporting && styles.importButtonDisabled]}
                        onPress={onPressImport}
                        disabled={isImporting}
                        accessibilityRole="button"
                        accessibilityLabel={t('recordVoice.importA11y')}
                      >
                        {isImporting ? (
                          <ActivityIndicator color={THEME.brandCtaOrange} />
                        ) : (
                          <FolderOpen size={scale(32)} color={THEME.brandCtaOrange} strokeWidth={2} />
                        )}
                      </TouchableOpacity>
                      <Text style={styles.preRecordActionLabel}>{t('recordVoice.import')}</Text>
                    </View>
                  ) : null}
                </View>
                {importAvailable ? (
                  <Text style={styles.importHint}>{t('recordVoice.importHintBody')}</Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(40),
    paddingBottom: SPACING.md,
  },
  headerTight: {
    paddingTop: verticalScale(28),
    paddingBottom: SPACING.xs,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerCancel: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  headerCancelText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '500',
    color: THEME.textMuted,
  },
  headerCancelSpacer: {
    width: scale(64),
  },
  preRecordBody: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
  },
  postRecordHead: {
    alignItems: 'center',
    marginBottom: verticalScale(8),
  },
  limitHint: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
  },
  postScroll: {
    flex: 1,
  },
  postScrollContent: {
    paddingHorizontal: SPACING.xl,
    paddingTop: verticalScale(4),
  },
  editSurfaceCard: {
    width: '100%',
    backgroundColor: THEME.bg,
    borderRadius: scale(16),
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(12),
    paddingBottom: verticalScale(14),
    alignItems: 'center',
    marginTop: verticalScale(8),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.08,
    shadowRadius: scale(12),
    elevation: 3,
  },
  playMaquette: {
    marginTop: verticalScale(12),
    width: scale(56),
    height: scale(56),
    borderRadius: scale(28),
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(2) },
    shadowOpacity: 0.12,
    shadowRadius: scale(8),
    elevation: 4,
  },
  rerecordInCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    marginTop: verticalScale(16),
    paddingVertical: verticalScale(6),
  },
  rerecordInCardText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textPrimary,
    fontWeight: '500',
  },
  bookBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginTop: verticalScale(18),
    paddingVertical: verticalScale(14),
    paddingHorizontal: SPACING.md,
    borderRadius: scale(14),
    backgroundColor: '#FFF0E8',
  },
  bookBannerIcon: {
    marginRight: scale(10),
    marginTop: scale(2),
  },
  bookBannerText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: '#5C4033',
    lineHeight: scale(20),
  },
  bookBannerBold: {
    fontWeight: '700',
    color: '#3D2A22',
  },
  illustrateBlock: {
    width: '100%',
    marginTop: verticalScale(22),
    alignItems: 'center',
  },
  coverFrame: {
    width: '100%',
    maxWidth: scale(280),
    aspectRatio: 4 / 5,
    borderRadius: scale(14),
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E8ECF0',
  },
  coverPreviewLarge: {
    width: '100%',
    height: '100%',
  },
  pencilFab: {
    position: 'absolute',
    top: scale(10),
    right: scale(10),
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    marginTop: verticalScale(12),
    paddingVertical: verticalScale(6),
  },
  changePhotoText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textPrimary,
    fontWeight: '500',
  },
  coverAddMaquette: {
    width: '100%',
    maxWidth: scale(280),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    paddingVertical: verticalScale(16),
    paddingHorizontal: SPACING.md,
    borderRadius: scale(14),
    borderWidth: 1.5,
    borderColor: 'rgba(60, 60, 67, 0.22)',
    backgroundColor: 'rgba(245, 247, 250, 0.85)',
  },
  coverAddMaquetteText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textPrimary,
    fontWeight: '500',
  },
  saveButtonMaquette: {
    width: '100%',
    marginTop: verticalScale(28),
  },
  saveButtonMaquetteInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    paddingHorizontal: SPACING.sm,
  },
  saveButtonMaquetteText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  cancelButtonTextDisabled: {
    opacity: 0.45,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(6),
    marginTop: verticalScale(12),
    marginBottom: verticalScale(8),
    paddingHorizontal: SPACING.sm,
  },
  privacyText: {
    fontSize: FONT_SIZES.xs,
    color: THEME.textMuted,
    textAlign: 'center',
  },
  titleSection: {
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '600',
    color: '#3F4A5A',
    textAlign: 'center',
    lineHeight: FONT_SIZES.xxl + scale(8),
  },
  idleCluster: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: verticalScale(24),
  },
  quotaBlock: {
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: verticalScale(28),
  },
  quotaHint: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '400',
    color: THEME.textPrimary,
    textAlign: 'center',
    lineHeight: FONT_SIZES.lg + scale(8),
  },
  subscribeHit: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  subscribeLink: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.brandPrimary,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  visualSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(24),
  },
  waveformContainer: {
    height: scale(128),
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  duration: {
    fontSize: FONT_SIZES.xxl,
    color: '#3F4A5A',
    fontWeight: '500',
    marginTop: SPACING.md,
  },
  controls: {
    alignItems: 'center',
  },
  preRecordActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: scale(36),
  },
  preRecordActionCol: {
    alignItems: 'center',
    width: scale(110),
  },
  preRecordActionLabel: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
  },
  recordButton: {
    width: scale(100),
    height: scale(100),
    borderRadius: scale(50),
    backgroundColor: THEME.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.2,
    shadowRadius: scale(12),
    elevation: 8,
  },
  importButton: {
    width: scale(100),
    height: scale(100),
    borderRadius: scale(50),
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: THEME.brandCtaOrange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(2) },
    shadowOpacity: 0.08,
    shadowRadius: scale(8),
    elevation: 3,
  },
  importButtonDisabled: {
    opacity: 0.65,
  },
  importHint: {
    marginTop: verticalScale(20),
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZES.xs,
    lineHeight: scale(18),
    color: THEME.textMuted,
    textAlign: 'center',
    maxWidth: scale(320),
  },
  stopButton: {
    width: scale(100),
    height: scale(100),
    borderRadius: scale(50),
    backgroundColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.2,
    shadowRadius: scale(12),
    elevation: 8,
  },
});

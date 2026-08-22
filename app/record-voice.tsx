import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
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
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import PermissionModal from '@/components/PermissionModal';
import { uploadMedia } from '@/services/media';
import { getOrSelectFirstChild } from '@/services/children';
import { armFeedSnapToLatestOnFocus } from '@/services/feedScrollRestore';
import { getUserTier } from '@/lib/userTier';
import { FREE_TIER_VOICE_MAX_DURATION, PAID_TIER_VOICE_MAX_DURATION, checkMemoryLimit, checkVoiceLimit } from '@/lib/limits';
import { promptFreeTierLimitThenPaywall, promptFreeTierLimitFromError } from '@/utils/freeTierLimitGate';
import { isAudioTrimAvailable, trimAudioToLocalFile } from '@/services/audioTrim';
import { AudioTrimEditor } from '@/components/AudioTrimEditor';
import { isVoiceDocumentPickerAvailable } from '@/services/voiceImport';
import { takePendingSharedVoice } from '@/lib/pendingShareMedia';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { isDeviceStorageFullError } from '@/utils/deviceStorageFull';

export default function RecordVoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  const handleRequestPermission = async () => {
    const result = await Audio.requestPermissionsAsync();
    if (result.granted) {
      setHasPermission(true);
      setShowPermissionModal(false);
      void startRecording();
    } else {
      setShowPermissionModal(false);
    }
  };

  const handleCancelPermission = () => {
    setShowPermissionModal(false);
  };

  const ensureVoiceQuotaOk = async (): Promise<string | null> => {
    const childId = await getOrSelectFirstChild();
    if (!childId) {
      Alert.alert('Aucun enfant trouvé', "Crée d'abord un profil d'enfant");
      router.push('/create-child');
      return null;
    }
    if (tier === 'free') {
      const memLimit = await checkMemoryLimit(childId, { skipRemotePull: true });
      if (!memLimit.canCreate) {
        promptFreeTierLimitThenPaywall({ kind: 'memories', router, returnTo: 'fil' });
        return null;
      }
      const voiceLimit = await checkVoiceLimit(childId, { skipRemotePull: true });
      if (!voiceLimit.canCreate) {
        promptFreeTierLimitThenPaywall({ kind: 'voices', router, returnTo: 'fil' });
        return null;
      }
    }
    return childId;
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
        const childId = await ensureVoiceQuotaOk();
        if (!childId) return;
        await applyLoadedAudio(pending.uri, pending.durationSec);
      } catch (e) {
        if (isDeviceStorageFullError(e)) {
          Alert.alert(t('error'), t('bookOrder.storageFull'));
        } else {
          console.error('[record-voice] shared voice', e);
          Alert.alert(t('error'), t('recordVoice.importFailed'));
        }
      } finally {
        setIsImporting(false);
      }
    })();
  }, [applyLoadedAudio, t]);

  const startRecording = async () => {
    try {
      const perm = await Audio.getPermissionsAsync();
      if (!perm.granted) {
        setShowPermissionModal(true);
        return;
      }
      setHasPermission(true);

      const childId = await ensureVoiceQuotaOk();
      if (!childId) return;

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setIsExcerptPlaying(false);
      lastExcerptTrimKeyRef.current = '';

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      recordingFileUriRef.current = null;
      setIsRecording(true);
      setHasRecording(false);
      setRecordingDuration(0);
      setCoverUri(null);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Erreur', "Impossible de démarrer l'enregistrement");
    }
  };

  const importAudio = async () => {
    if (isRecording || isImporting || isSaving) return;
    if (!importAvailable) {
      Alert.alert(t('error'), t('recordVoice.importNeedsRebuild'));
      return;
    }
    try {
      const childId = await ensureVoiceQuotaOk();
      if (!childId) return;

      setIsImporting(true);
      const { pickVoiceAudioFromFiles } = await import('@/services/voiceImport');
      const picked = await pickVoiceAudioFromFiles();
      if (!picked) return;
      await applyLoadedAudio(picked.uri, picked.durationSec);
    } catch (e) {
      if (e instanceof Error && e.message === 'DOCUMENT_PICKER_UNAVAILABLE') {
        Alert.alert(t('error'), t('recordVoice.importNeedsRebuild'));
        return;
      }
      if (isDeviceStorageFullError(e)) {
        Alert.alert(t('error'), t('bookOrder.storageFull'));
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
    try {
      if (!recordingRef.current) return;

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      setIsRecording(false);
      const fileUri = recordingRef.current.getURI() ?? null;
      await recordingRef.current.stopAndUnloadAsync();
      recordingFileUriRef.current = fileUri;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      setHasRecording(true);
      // Préremplir l’extrait : max 60 s free / 5 min paid.
      const maxClip =
        tier === 'free' ? FREE_TIER_VOICE_MAX_DURATION : PAID_TIER_VOICE_MAX_DURATION;
      setTrimStartSec(0);
      setTrimEndSec(Math.max(0, Math.min(recordingDuration, maxClip)));
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Erreur', "Impossible d'arrêter l'enregistrement");
    }
  };

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

  const saveRecording = async () => {
    if (!hasRecording || (!recordingFileUriRef.current && !recordingRef.current)) return;

    try {
      setIsSaving(true);

      const childId = await getOrSelectFirstChild();
      if (!childId) {
        Alert.alert('Aucun enfant trouvé', 'Crée d\'abord un profil d\'enfant');
        setIsSaving(false);
        router.push('/create-child');
        return;
      }

      if (tier === 'free') {
        const voiceLimit = await checkVoiceLimit(childId, { skipRemotePull: true });
        if (!voiceLimit.canCreate) {
          promptFreeTierLimitThenPaywall({ kind: 'voices', router, returnTo: 'fil' });
          setIsSaving(false);
          return;
        }
      }

      const uri = recordingFileUriRef.current ?? recordingRef.current?.getURI();
      if (!uri) {
        Alert.alert('Erreur', "Aucun enregistrement trouvé");
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
        return;
      }
      if (tier === 'paid' && clipDur > PAID_TIER_VOICE_MAX_DURATION + 0.01) {
        Alert.alert('Dernière étape', 'Choisis un extrait de 5 minutes maximum.');
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
        return;
      } else if (tier === 'paid' && recordingDuration > PAID_TIER_VOICE_MAX_DURATION) {
        Alert.alert('Dernière étape', 'Choisis un extrait de 5 minutes maximum.');
        return;
      }

      const result = await uploadMedia({
        uri: finalUri,
        type: 'voice',
        childId,
        duration: finalDuration,
        voiceCoverUri: coverUri,
        voicePlaybackStartSec,
      });

      if (result) {
        Alert.alert('Succès', 'Souvenir sonore sauvegardé avec succès');
        armFeedSnapToLatestOnFocus();
        router.push('/(tabs)/fil');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder le souvenir');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        promptFreeTierLimitFromError(error.message, { router, returnTo: 'fil' })
      ) {
        return;
      }
      console.error('Failed to save recording:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder le souvenir');
    } finally {
      setIsSaving(false);
    }
  };

  const pickCoverImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Accès refusé', 'Autorise l’accès aux photos pour ajouter une illustration.');
        return;
      }
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

  return (
    <View style={styles.container}>
      <PermissionModal
        visible={showPermissionModal}
        type="microphone"
        onRequestPermission={() => void handleRequestPermission()}
        onCancel={handleCancelPermission}
      />

      <View style={[styles.header, showPostRecordFooter && styles.headerTight]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
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
          <View style={styles.postRecordHead}>
            <Text style={styles.titlePostRecord}>{t('recordVoice.title')}</Text>
            <Text style={styles.subtitlePostRecord}>{t('recordVoice.subtitleDone')}</Text>
          </View>

          <View style={styles.editSurfaceCard}>
            <AudioTrimEditor
              presentation="editorCard"
              durationSec={recordingDuration}
              tier={tier}
              value={{ startSec: trimStartSec, endSec: trimEndSec }}
              onChange={v => clampTrim(v.startSec, v.endSec)}
              onDragActiveChange={setTrimScrollLocked}
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
            <Text style={styles.illustrateTitle}>Illustrer ce souvenir (optionnel)</Text>
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

          <PetitmoPrimaryPressable
            style={[petitmoCtaStyles.primaryFullWidth, styles.saveButtonMaquette]}
            onPress={() => void saveRecording()}
            disabled={isSaving}
            activeOpacity={0.88}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={PETITMO_CTA_SPINNER_COLOR} />
            ) : (
              <>
                <Save size={scale(22)} color={THEME.captureScreenCtaForeground} strokeWidth={2} />
                <Text style={[petitmoCtaStyles.primaryText, styles.saveButtonMaquetteText]}>
                  {t('recordVoice.save')}
                </Text>
              </>
            )}
          </PetitmoPrimaryPressable>

          <View style={styles.privacyRow}>
            <Lock size={scale(14)} color={THEME.textMuted} strokeWidth={2} />
            <Text style={styles.privacyText}>Enregistré de façon privée et sécurisée</Text>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.preRecordBody}>
          <View style={styles.titleSection}>
            <Text style={styles.title}>{t('recordVoice.title')}</Text>
            <Text style={styles.subtitle}>
              {isRecording
                ? t('recordVoice.subtitleRecording')
                : t('recordVoice.subtitleIdle')}
            </Text>
          </View>

          <View style={styles.visualSection}>
            <View style={styles.waveformContainer}>
              {isRecording && (
                <View style={styles.waveformBars}>
                  {[...Array(5)].map((_, i) => (
                    <View key={i} style={[styles.waveformBar, { height: 40 + Math.random() * 60 }]} />
                  ))}
                </View>
              )}
            </View>

            {isRecording && (
              <Text style={styles.duration}>{formatDuration(recordingDuration)}</Text>
            )}
          </View>

          <View style={styles.controls}>
            {!isRecording ? (
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
            ) : (
              <TouchableOpacity style={styles.stopButton} onPress={() => void stopRecording()}>
                <Square size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
              </TouchableOpacity>
            )}
            {!isRecording && importAvailable ? (
              <Text style={styles.importHint}>{t('recordVoice.importHintBody')}</Text>
            ) : null}
          </View>
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
    justifyContent: 'flex-start',
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
  preRecordBody: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
  },
  postRecordHead: {
    alignItems: 'center',
    marginBottom: verticalScale(4),
  },
  titlePostRecord: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#3F4A5A',
    marginBottom: scale(2),
  },
  subtitlePostRecord: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
    textAlign: 'center',
    marginBottom: verticalScale(4),
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
  illustrateTitle: {
    alignSelf: 'stretch',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#3F4A5A',
    marginBottom: verticalScale(12),
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    marginTop: verticalScale(28),
    minHeight: scale(54),
  },
  saveButtonMaquetteText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
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
    marginTop: SPACING.xl,
    marginBottom: verticalScale(60),
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: '#3F4A5A',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: '#8791A1',
    textAlign: 'center',
  },
  visualSection: {
    alignItems: 'center',
    marginBottom: verticalScale(80),
  },
  waveformContainer: {
    height: scale(120),
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveformBars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
  },
  waveformBar: {
    width: scale(6),
    backgroundColor: THEME.accent,
    borderRadius: scale(3),
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

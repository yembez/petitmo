import { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Mic, Square, Play, Pause, ImagePlus, X } from 'lucide-react-native';
import { Audio } from 'expo-av';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import PermissionModal from '@/components/PermissionModal';
import { uploadMedia } from '@/services/media';
import { getOrSelectFirstChild } from '@/services/children';
import { getUserTier } from '@/lib/userTier';
import { FREE_TIER_VOICE_MAX_DURATION } from '@/lib/limits';

export default function RecordVoiceScreen() {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /** Photo d’illustration optionnelle (fond derrière le lecteur sur le fil) */
  const [coverUri, setCoverUri] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    if (recordingDuration < FREE_TIER_VOICE_MAX_DURATION) return;
    void (async () => {
      const tier = await getUserTier();
      if (tier !== 'free') return;
      await stopRecording();
      router.push({ pathname: '/paywall', params: { context: 'VOICE_LIMIT_REACHED' } });
    })();
  }, [isRecording, recordingDuration, router]);

  useEffect(() => {
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

    if (!result.granted && !result.canAskAgain) {
      router.back();
      return;
    }

    if (!result.granted) {
      setShowPermissionModal(true);
    }

    setHasPermission(result.granted);
  };

  const handleRequestPermission = async () => {
    const result = await Audio.requestPermissionsAsync();
    if (result.granted) {
      setHasPermission(true);
      setShowPermissionModal(false);
    } else {
      setShowPermissionModal(false);
      router.back();
    }
  };

  const handleCancelPermission = () => {
    setShowPermissionModal(false);
    router.back();
  };

  const startRecording = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
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

  const stopRecording = async () => {
    try {
      if (!recordingRef.current) return;

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      setIsRecording(false);
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      setHasRecording(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Erreur', "Impossible d'arrêter l'enregistrement");
    }
  };

  const playRecording = async () => {
    try {
      if (!recordingRef.current) return;

      if (soundRef.current) {
        if (isPlaying) {
          await soundRef.current.pauseAsync();
          setIsPlaying(false);
          return;
        } else {
          await soundRef.current.playAsync();
          setIsPlaying(true);
          return;
        }
      }

      const uri = recordingRef.current.getURI();
      if (!uri) return;

      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
        }
      });

      await sound.playAsync();
      setIsPlaying(true);
    } catch (error) {
      console.error('Failed to play recording:', error);
      Alert.alert('Erreur', "Impossible de lire l'enregistrement");
    }
  };

  const saveRecording = async () => {
    if (!hasRecording || !recordingRef.current) return;

    try {
      setIsSaving(true);

      const childId = await getOrSelectFirstChild();
      if (!childId) {
        Alert.alert('Aucun enfant trouvé', 'Veuillez d\'abord créer un profil d\'enfant');
        setIsSaving(false);
        router.push('/create-child');
        return;
      }

      const uri = recordingRef.current.getURI();
      if (!uri) {
        Alert.alert('Erreur', "Aucun enregistrement trouvé");
        setIsSaving(false);
        return;
      }

      const result = await uploadMedia({
        uri,
        type: 'voice',
        childId,
        duration: recordingDuration,
        voiceCoverUri: coverUri,
      });

      if (result) {
        Alert.alert('Succès', 'Souvenir sonore sauvegardé avec succès');
        router.push('/(tabs)/fil');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder le souvenir');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'LIMIT_REACHED') {
          router.push({ pathname: '/paywall', params: { context: 'LIMIT_REACHED' } });
          return;
        }
        if (error.message === 'VIDEO_LIMIT_REACHED') {
          router.push({ pathname: '/paywall', params: { context: 'VIDEO_LIMIT_REACHED' } });
          return;
        }
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
        Alert.alert('Accès refusé', 'Autorisez l’accès aux photos pour ajouter une illustration.');
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
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (hasPermission === null) {
    return <View style={styles.container} />;
  }

  if (!hasPermission) {
    return (
      <>
        <View style={styles.container} />
        <PermissionModal
          visible={showPermissionModal}
          type="microphone"
          onRequestPermission={handleRequestPermission}
          onCancel={handleCancelPermission}
        />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
        {hasRecording && (
          <TouchableOpacity
            onPress={saveRecording}
            style={styles.saveButton}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={THEME.accent} />
            ) : (
              <Text style={styles.saveButtonText}>Enregistrer</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.titleSection}>
          <Text style={styles.title}>Capturez des sons</Text>
          <Text style={styles.subtitle}>
            {isRecording
              ? 'Enregistrement en cours...'
              : hasRecording
              ? 'Enregistrement terminé'
              : 'Sa voix, un chant, un message pour plus tard...'}
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

          {(isRecording || hasRecording) && (
            <Text style={styles.duration}>{formatDuration(recordingDuration)}</Text>
          )}
        </View>

        <View style={styles.controls}>
          {!isRecording && !hasRecording && (
            <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
              <Mic size={scale(40)} color="#FFFFFF" strokeWidth={2} />
            </TouchableOpacity>
          )}

          {isRecording && (
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <Square size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
            </TouchableOpacity>
          )}

          {hasRecording && !isRecording && (
            <View style={styles.playbackControls}>
              <TouchableOpacity style={styles.playButton} onPress={playRecording}>
                {isPlaying ? (
                  <Pause size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                ) : (
                  <Play size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.rerecordButton} onPress={startRecording}>
                <Mic size={ICON_SIZES.md} color={THEME.accent} strokeWidth={2} />
                <Text style={styles.rerecordText}>Réenregistrer</Text>
              </TouchableOpacity>

              <View style={styles.coverSection}>
                <Text style={styles.coverHint}>Illustrer le son (optionnel)</Text>
                {coverUri ? (
                  <View style={styles.coverPreviewWrap}>
                    <Image source={{ uri: coverUri }} style={styles.coverPreview} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.coverRemove}
                      onPress={() => setCoverUri(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <X size={scale(18)} color="#FFFFFF" strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.coverAddButton} onPress={pickCoverImage} activeOpacity={0.8}>
                    <ImagePlus size={scale(22)} color={THEME.accent} strokeWidth={2} />
                    <Text style={styles.coverAddText}>Photo de fond</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
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
  backButton: {
    padding: SPACING.sm,
  },
  saveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: THEME.accent,
    borderRadius: scale(100),
  },
  saveButtonText: {
    fontSize: FONT_SIZES.base,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
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
  playbackControls: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  playButton: {
    width: scale(80),
    height: scale(80),
    borderRadius: scale(40),
    backgroundColor: THEME.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.2,
    shadowRadius: scale(12),
    elevation: 8,
  },
  rerecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: scale(12),
    paddingHorizontal: SPACING.md,
  },
  rerecordText: {
    fontSize: FONT_SIZES.base,
    color: THEME.accent,
    fontWeight: '600',
  },
  coverSection: {
    marginTop: verticalScale(24),
    alignItems: 'center',
    width: '100%',
  },
  coverHint: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
    marginBottom: SPACING.sm,
  },
  coverAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(18),
    borderRadius: scale(12),
    borderWidth: 1.5,
    borderColor: 'rgba(92, 143, 166, 0.45)',
    backgroundColor: 'rgba(92, 143, 166, 0.06)',
  },
  coverAddText: {
    fontSize: FONT_SIZES.base,
    color: THEME.accent,
    fontWeight: '600',
  },
  coverPreviewWrap: {
    width: scale(120),
    height: scale(150),
    borderRadius: scale(12),
    overflow: 'hidden',
    position: 'relative',
  },
  coverPreview: {
    width: '100%',
    height: '100%',
  },
  coverRemove: {
    position: 'absolute',
    top: scale(6),
    right: scale(6),
    width: scale(28),
    height: scale(28),
    borderRadius: scale(14),
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

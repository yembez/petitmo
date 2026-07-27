import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus, Alert, ActivityIndicator, Image, Dimensions, BackHandler } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronLeft, RotateCw, Camera, Video, Square } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import PermissionModal from '@/components/PermissionModal';
import { uploadMedia } from '@/services/media';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { getOrSelectFirstChild } from '@/services/children';
import { getUserTier } from '@/lib/userTier';
import { checkMemoryLimit, checkVideoLimit, FREE_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';
import { promptFreeTierLimitThenPaywall } from '@/utils/freeTierLimitGate';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function CameraScreen() {
  const router = useRouter();
  const { startBackgroundUploadNavigateToFeed } = usePendingMediaUploads();
  const { from } = useLocalSearchParams<{ from?: string }>();

  /** Depuis le fil, `router.back()` peut rouvrir l’onglet Capturer au lieu du fil — on cible explicitement le fil. */
  const leaveCamera = useCallback(() => {
    if (from === 'fil') {
      router.replace('/(tabs)/fil');
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [from, router]);

  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentVideoUriRef = useRef<string | null>(null);

  const MAX_RECORDING_TIME = 60;

  useEffect(() => {
    checkPermission();
  }, [permission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isRecording || isProcessing) return false;
        leaveCamera();
        return true;
      });
      return () => sub.remove();
    }, [isRecording, isProcessing, leaveCamera])
  );

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      checkPermission();
    }
  };

  const checkPermission = async () => {
    if (!permission) return;

    if (!permission.granted && !permission.canAskAgain) {
      leaveCamera();
      return;
    }

    if (!permission.granted) {
      setShowPermissionModal(true);
      setHasPermission(false);
    } else {
      setHasPermission(true);
      setShowPermissionModal(false);
    }
  };

  const handleRequestPermission = async () => {
    const result = await requestPermission();
    if (result.granted) {
      setHasPermission(true);
      setShowPermissionModal(false);
    } else {
      setShowPermissionModal(false);
      leaveCamera();
    }
  };

  const handleCancelPermission = () => {
    setShowPermissionModal(false);
    leaveCamera();
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
          type="camera"
          onRequestPermission={handleRequestPermission}
          onCancel={handleCancelPermission}
        />
      </>
    );
  }

  const toggleCameraFacing = () => {
    if (!isRecording) {
      setFacing(current => (current === 'back' ? 'front' : 'back'));
    }
  };

  const takePicture = async () => {
    if (cameraRef.current && !isRecording && !isProcessing) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.85,
        });

        if (photo && photo.uri) {
          setIsProcessing(true);
          const childId = await getOrSelectFirstChild();
          if (!childId) {
            Alert.alert('Aucun enfant trouvé', "Crée d'abord un profil d'enfant");
            setIsProcessing(false);
            router.push('/create-child');
            return;
          }
          const limitCheck = await checkMemoryLimit(childId, { skipRemotePull: true });
          if (!limitCheck.canCreate) {
            setIsProcessing(false);
            promptFreeTierLimitThenPaywall({ kind: 'memories', router, returnTo: 'fil' });
            return;
          }
          const localUri = photo.uri;
          setIsProcessing(false);
          startBackgroundUploadNavigateToFeed({
            previewUris: [localUri],
            upload: async () => {
              const m = await uploadMedia({
                uri: localUri,
                type: 'photo',
                childId,
              });
              return m ? [m] : null;
            },
          });
        }
      } catch (error) {
        console.error('Error taking picture:', error);
        Alert.alert('Erreur', 'Impossible de prendre la photo');
      }
    }
  };

  // Plus d'étape "preview + enregistrer" pour les photos (upload direct après capture)

  const startRecording = async () => {
    if (cameraRef.current && !isRecording && !isProcessing) {
      try {
        const childId = await getOrSelectFirstChild();
        if (!childId) {
          Alert.alert('Aucun enfant trouvé', 'Crée d\'abord un profil d\'enfant');
          router.push('/create-child');
          return;
        }
        const memLimit = await checkMemoryLimit(childId, { skipRemotePull: true });
        if (!memLimit.canCreate) {
          promptFreeTierLimitThenPaywall({ kind: 'memories', router, returnTo: 'fil' });
          return;
        }
        const videoLimit = await checkVideoLimit(childId, { skipRemotePull: true });
        if (!videoLimit.canCreate) {
          promptFreeTierLimitThenPaywall({ kind: 'videos', router, returnTo: 'fil' });
          return;
        }

        setIsRecording(true);
        setRecordingTime(0);

        recordingTimerRef.current = setInterval(() => {
          setRecordingTime(prev => {
            if (prev >= MAX_RECORDING_TIME - 1) {
              stopRecording();
              return prev;
            }
            return prev + 1;
          });
        }, 1000);

        const tier = await getUserTier();
        const isFree = tier === 'free';
        const maxDuration = isFree ? FREE_TIER_VIDEO_MAX_DURATION : MAX_RECORDING_TIME;
        const video = await cameraRef.current.recordAsync({
          maxDuration,
        });

        if (video && video.uri) {
          currentVideoUriRef.current = video.uri;
          await saveVideo(video.uri, recordingTime);
        }
      } catch (error) {
        console.error('Error recording video:', error);
        Alert.alert('Erreur', 'Impossible d\'enregistrer la vidéo');
        setIsRecording(false);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const saveVideo = async (uri: string, duration: number) => {
    try {
      setIsProcessing(true);

      const childId = await getOrSelectFirstChild();
      if (!childId) {
        Alert.alert('Aucun enfant trouvé', 'Crée d\'abord un profil d\'enfant');
        setIsProcessing(false);
        setRecordingTime(0);
        router.push('/create-child');
        return;
      }

      setIsProcessing(false);
      setRecordingTime(0);
      const limitCheck = await checkMemoryLimit(childId, { skipRemotePull: true });
      if (!limitCheck.canCreate) {
        promptFreeTierLimitThenPaywall({ kind: 'memories', router, returnTo: 'fil' });
        return;
      }
      const videoLimitCheck = await checkVideoLimit(childId, { skipRemotePull: true });
      if (!videoLimitCheck.canCreate) {
        promptFreeTierLimitThenPaywall({ kind: 'videos', router, returnTo: 'fil' });
        return;
      }
      startBackgroundUploadNavigateToFeed({
        kind: 'video',
        previewUris: [uri],
        upload: async () => {
          const m = await uploadMedia({
            uri,
            type: 'video',
            childId,
            duration,
          });
          return m ? [m] : null;
        },
      });
    } catch (error) {
      console.error('Error saving video:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder la vidéo');
      setIsProcessing(false);
      setRecordingTime(0);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => !isRecording && !isProcessing && leaveCamera()}
          style={styles.backButton}
          disabled={isRecording || isProcessing}
        >
          <ChevronLeft size={ICON_SIZES.xl} color={isRecording || isProcessing ? 'rgba(255, 255, 255, 0.3)' : '#FFFFFF'} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.cameraWrapper}>
        <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.processingText}>Enregistrement...</Text>
            </View>
          )}

          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                {formatTime(recordingTime)} / {formatTime(MAX_RECORDING_TIME)}
              </Text>
            </View>
          )}
        </CameraView>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.flipButton}
          onPress={toggleCameraFacing}
          disabled={isRecording || isProcessing}
        >
          <RotateCw size={ICON_SIZES.lg} color={isRecording || isProcessing ? 'rgba(255, 255, 255, 0.3)' : '#FFFFFF'} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.centerButtons}>
          {isRecording ? (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={stopRecording}
              disabled={isProcessing}
            >
              <Square size={scale(32)} color="#FFFFFF" fill="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.photoButton}
                onPress={takePicture}
                disabled={isProcessing}
              >
                <Camera size={scale(36)} color="#FFFFFF" strokeWidth={2} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.videoButton}
                onPress={startRecording}
                disabled={isProcessing}
              >
                <Video size={scale(36)} color="#FFFFFF" strokeWidth={2} />
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.flipButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  header: {
    paddingTop: verticalScale(40),
    paddingHorizontal: SPACING.md,
    zIndex: 10,
  },
  cameraWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * (4 / 3),
    overflow: 'hidden',
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  backButton: {
    width: scale(44),
    height: scale(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingIndicator: {
    position: 'absolute',
    top: SPACING.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: scale(20),
  },
  recordingDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    backgroundColor: '#FF3B30',
    marginRight: SPACING.xs,
  },
  recordingText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  controls: {
    paddingBottom: verticalScale(50),
    paddingHorizontal: SPACING.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  centerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  photoButton: {
    width: scale(72),
    height: scale(72),
    borderRadius: scale(36),
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoButton: {
    width: scale(72),
    height: scale(72),
    borderRadius: scale(36),
    backgroundColor: 'rgba(255, 59, 48, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    width: scale(80),
    height: scale(80),
    borderRadius: scale(20),
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButton: {
    width: scale(44),
    height: scale(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
  },
  previewImage: {
    flex: 1,
    backgroundColor: '#000000',
  },
  savePhotoButton: {
    width: scale(80),
    height: scale(80),
    borderRadius: scale(40),
    backgroundColor: THEME.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

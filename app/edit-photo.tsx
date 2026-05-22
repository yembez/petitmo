import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Dimensions,
  Image as RNImage,
  Platform,
  Modal,
  DeviceEventEmitter,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, RotateCw, Crop, Undo, X } from 'lucide-react-native';
import { scale as scaleUtil, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { getCachedUserMode } from '@/lib/userMode';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { ensureLocalPhotoDerivatives, persistOriginalToSandbox } from '@/services/memoryLocalStore';
import { persistFeedLocalThumbnail } from '@/services/feedLocalPhotoCache';
import type { Memory } from '@/types/local';
import {
  downloadAsync,
  documentDirectory,
  getInfoAsync,
  deleteAsync,
} from 'expo-file-system/legacy';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CROP_FRAME_SIZE = SCREEN_WIDTH * 0.85;

type EditHistoryItem = {
  uri: string;
  size: { width: number; height: number };
};

export default function EditPhotoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const imageUri = params.uri as string;
  const memoryId = params.memoryId as string;

  const [originalImageUri, setOriginalImageUri] = useState<string>('');
  const [editedImage, setEditedImage] = useState<string>('');
  const [editHistory, setEditHistory] = useState<EditHistoryItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [tempFiles, setTempFiles] = useState<string[]>([]);
  const [showCropModal, setShowCropModal] = useState(false);

  const cropScale = useSharedValue(1);
  const savedCropScale = useSharedValue(1);
  const cropTranslateX = useSharedValue(0);
  const cropTranslateY = useSharedValue(0);
  const savedCropTranslateX = useSharedValue(0);
  const savedCropTranslateY = useSharedValue(0);

  const [cropImageSize, setCropImageSize] = useState({ width: 0, height: 0 });

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cropTranslateX.value },
      { translateY: cropTranslateY.value },
      { scale: cropScale.value },
    ],
  }));

  useEffect(() => {
    // CORRECTION: Vérifier que imageUri existe avant de charger
    if (!imageUri) {
      console.error('No imageUri provided');
      Alert.alert(
        'Erreur', 
        'Aucune image à éditer. Retour à l\'écran précédent.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      setIsLoading(false);
      return;
    }

    loadImage();
    
    return () => {
      cleanupTempFiles();
    };
  }, [imageUri]);

  const loadImage = async () => {
    // CORRECTION: Double vérification
    if (!imageUri) {
      console.error('imageUri is undefined or null');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      console.log('Loading image from URI:', imageUri);

      if (Platform.OS === 'web') {
        setOriginalImageUri(imageUri);
        setEditedImage(imageUri);

        RNImage.getSize(
          imageUri,
          (width, height) => {
            console.log('Image size:', width, height);
            setImageSize({ width, height });
            setIsLoading(false);
          },
          (error) => {
            console.error('Error getting image size:', error);
            Alert.alert('Erreur', 'Impossible de charger les dimensions de l\'image');
            setImageSize({ width: 1000, height: 1000 });
            setIsLoading(false);
          }
        );
      } else {
        // CORRECTION: Vérification de l'URI avant download
        if (!imageUri || imageUri === '') {
          throw new Error('Invalid image URI');
        }

        const fileUri = documentDirectory + `temp_original_${Date.now()}.jpg`;
        console.log('Downloading to:', fileUri);
        
        const downloadResult = await downloadAsync(imageUri, fileUri);

        if (downloadResult.status === 200) {
          console.log('Download successful:', downloadResult.uri);
          setOriginalImageUri(downloadResult.uri);
          setEditedImage(downloadResult.uri);
          setTempFiles([downloadResult.uri]);

          RNImage.getSize(
            downloadResult.uri,
            (width, height) => {
              console.log('Image size:', width, height);
              setImageSize({ width, height });
              setIsLoading(false);
            },
            (error) => {
              console.error('Error getting image size:', error);
              Alert.alert('Erreur', 'Impossible de charger les dimensions de l\'image');
              setImageSize({ width: 1000, height: 1000 });
              setIsLoading(false);
            }
          );
        } else {
          throw new Error(`Download failed with status: ${downloadResult.status}`);
        }
      }
    } catch (error) {
      console.error('Error loading image:', error);
      Alert.alert(
        'Erreur', 
        'Impossible de charger l\'image. Vérifiez que l\'URL est valide.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      setIsLoading(false);
    }
  };

  const addToHistory = (uri: string, size: { width: number; height: number }) => {
    setEditHistory(prev => [...prev, { uri: editedImage, size: imageSize }]);
    setEditedImage(uri);
    setImageSize(size);
  };

  const undoEdit = async () => {
    if (editHistory.length === 0 || isProcessing) return;

    const previousEdit = editHistory[editHistory.length - 1];

    setEditedImage(previousEdit.uri);
    setImageSize(previousEdit.size);
    setEditHistory(prev => prev.slice(0, -1));
  };

  const rotateImage = async () => {
    if (isProcessing || !editedImage) return;

    try {
      setIsProcessing(true);

      const result = await ImageManipulator.manipulateAsync(
        editedImage,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      addToHistory(result.uri, { width: imageSize.height, height: imageSize.width });

      if (Platform.OS !== 'web') {
        setTempFiles(prev => [...prev, result.uri]);
      }
    } catch (error) {
      console.error('Error rotating image:', error);
      Alert.alert('Erreur', 'Impossible de pivoter l\'image');
    } finally {
      setIsProcessing(false);
    }
  };

  const openCropModal = () => {
    cropScale.value = 1;
    savedCropScale.value = 1;
    cropTranslateX.value = 0;
    cropTranslateY.value = 0;
    savedCropTranslateX.value = 0;
    savedCropTranslateY.value = 0;

    RNImage.getSize(
      editedImage,
      (width, height) => {
        const aspectRatio = width / height;
        let displayWidth = CROP_FRAME_SIZE;
        let displayHeight = CROP_FRAME_SIZE;

        if (aspectRatio > 1) {
          displayHeight = CROP_FRAME_SIZE / aspectRatio;
        } else {
          displayWidth = CROP_FRAME_SIZE * aspectRatio;
        }

        setCropImageSize({ width: displayWidth, height: displayHeight });
      },
      (error) => {
        console.error('Error getting image size for crop:', error);
        setCropImageSize({ width: CROP_FRAME_SIZE, height: CROP_FRAME_SIZE });
      }
    );

    setShowCropModal(true);
  };

  const applyCrop = async () => {
    if (isProcessing || !editedImage) return;

    try {
      setIsProcessing(true);

      const currentScale = savedCropScale.value;
      const currentTranslateX = savedCropTranslateX.value;
      const currentTranslateY = savedCropTranslateY.value;

      const scaleX = imageSize.width / cropImageSize.width;
      const scaleY = imageSize.height / cropImageSize.height;

      const scaledImageWidth = cropImageSize.width * currentScale;
      const scaledImageHeight = cropImageSize.height * currentScale;

      const imageDisplayCenterX = CROP_FRAME_SIZE / 2 + currentTranslateX;
      const imageDisplayCenterY = CROP_FRAME_SIZE / 2 + currentTranslateY;

      const imageDisplayLeft = imageDisplayCenterX - scaledImageWidth / 2;
      const imageDisplayTop = imageDisplayCenterY - scaledImageHeight / 2;

      const frameCenterX = CROP_FRAME_SIZE / 2;
      const frameCenterY = CROP_FRAME_SIZE / 2;
      const frameLeft = frameCenterX - CROP_FRAME_SIZE / 2;
      const frameTop = frameCenterY - CROP_FRAME_SIZE / 2;

      const cropDisplayLeft = frameLeft - imageDisplayLeft;
      const cropDisplayTop = frameTop - imageDisplayTop;

      const originX = (cropDisplayLeft / currentScale) * scaleX;
      const originY = (cropDisplayTop / currentScale) * scaleY;
      const cropWidth = (CROP_FRAME_SIZE / currentScale) * scaleX;
      const cropHeight = (CROP_FRAME_SIZE / currentScale) * scaleY;

      const finalOriginX = Math.max(0, Math.round(originX));
      const finalOriginY = Math.max(0, Math.round(originY));
      const finalWidth = Math.min(
        imageSize.width - finalOriginX,
        Math.round(cropWidth)
      );
      const finalHeight = Math.min(
        imageSize.height - finalOriginY,
        Math.round(cropHeight)
      );

      if (finalWidth <= 0 || finalHeight <= 0) {
        Alert.alert('Erreur', 'Zone de recadrage invalide');
        setIsProcessing(false);
        return;
      }

      const result = await ImageManipulator.manipulateAsync(
        editedImage,
        [{
          crop: {
            originX: finalOriginX,
            originY: finalOriginY,
            width: finalWidth,
            height: finalHeight,
          }
        }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      addToHistory(result.uri, { width: finalWidth, height: finalHeight });

      if (Platform.OS !== 'web') {
        setTempFiles(prev => [...prev, result.uri]);
      }

      setShowCropModal(false);
    } catch (error) {
      console.error('Error cropping image:', error);
      Alert.alert('Erreur', 'Impossible de recadrer l\'image');
    } finally {
      setIsProcessing(false);
    }
  };

  const cleanupTempFiles = async () => {
    if (Platform.OS === 'web') return;

    try {
      for (const file of tempFiles) {
        try {
          const fileInfo = await getInfoAsync(file);
          if (fileInfo.exists) {
            await deleteAsync(file, { idempotent: true });
          }
        } catch (fileError) {
          console.warn('Could not delete temp file:', file);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  };

  const savePhoto = async () => {
    if (isProcessing || !memoryId || !editedImage) return;

    try {
      setIsProcessing(true);

      const mode = await getCachedUserMode();
      if (mode === 'local') {
        if (Platform.OS === 'web') {
          Alert.alert(
            'Non disponible',
            "L'enregistrement des retouches photo en mode local sur le web n'est pas pris en charge pour l'instant.",
          );
          return;
        }

        const mem = getLocalMemoryById(memoryId);
        if (!mem || mem.type !== 'photo') {
          Alert.alert('Erreur', 'Souvenir introuvable ou type non pris en charge');
          return;
        }

        const { localOriginalUri } = await persistOriginalToSandbox({
          memoryId,
          type: 'photo',
          sourceUri: editedImage,
        });
        const src = (localOriginalUri ?? editedImage).trim();
        const d = await ensureLocalPhotoDerivatives({ memoryId, localOriginalUri: src });
        await persistFeedLocalThumbnail(memoryId, editedImage, 0);

        let fileSize: number | null = mem.file_size;
        try {
          const f = new FileSystem.File(src);
          const b = await f.bytes();
          fileSize = b.length;
        } catch {
          /* conserve fileSize existant */
        }

        const thumb = d.localThumbUri ?? mem.local_thumb_path ?? src;
        const display = d.localDisplayUri ?? d.localThumbUri ?? mem.display_url;
        const next: Memory = {
          ...mem,
          local_media_path: d.localThumbUri ?? src,
          local_original_path: localOriginalUri,
          local_thumb_path: d.localThumbUri,
          local_display_path: d.localDisplayUri,
          local_print_path: d.localPrintUri,
          original_px_w: d.originalPx?.w ?? mem.original_px_w,
          original_px_h: d.originalPx?.h ?? mem.original_px_h,
          print_px_w: d.printPx?.w ?? mem.print_px_w,
          print_px_h: d.printPx?.h ?? mem.print_px_h,
          file_size: fileSize,
          thumb_url: typeof thumb === 'string' ? thumb : null,
          display_url: typeof display === 'string' ? display : null,
          media_url: null,
          media_path: null,
          print_url: null,
          updated_at: new Date().toISOString(),
          sync_status: 'local',
          upload_status: 'full',
        };
        upsertLocalMemory(next);
        DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId });
        await cleanupTempFiles();
        Alert.alert('Succès', 'Photo enregistrée sur cet appareil');
        router.back();
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Erreur', 'Utilisateur non connecté');
        return;
      }

      const { data: memory } = await supabase
        .from('memories')
        .select('child_id')
        .eq('id', memoryId)
        .maybeSingle();

      if (!memory) {
        Alert.alert('Erreur', 'Mémoire introuvable');
        return;
      }

      const timestamp = Date.now();
      const fileName = `${user.id}/${memory.child_id}/photo/edited_${timestamp}.jpg`;

      if (Platform.OS === 'web') {
        const response = await fetch(editedImage);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          Alert.alert('Erreur', 'Impossible de sauvegarder la photo');
          return;
        }
      } else {
        const fileInfo = await getInfoAsync(editedImage);
        if (!fileInfo.exists) {
          Alert.alert('Erreur', 'Fichier image introuvable');
          return;
        }

        const formData = new FormData();
        const filePart = {
          uri: editedImage,
          name: fileName,
          type: 'image/jpeg',
        };
        formData.append('file', filePart as unknown as Blob);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          Alert.alert('Erreur', 'Session expirée');
          return;
        }

        const uploadUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/media/${fileName}`;

        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json();
          console.error('Upload error:', errorData);
          Alert.alert('Erreur', 'Impossible de sauvegarder la photo');
          return;
        }
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from('media')
        .createSignedUrl(fileName, 60 * 60 * 24 * 7);

      if (signErr || !signed?.signedUrl) {
        Alert.alert('Erreur', 'Impossible de récupérer l\'URL de la photo');
        return;
      }

      const { error: updateError } = await supabase
        .from('memories')
        .update({
          media_url: signed.signedUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', memoryId);

      if (updateError) {
        console.error('Update error:', updateError);
        Alert.alert('Erreur', 'Impossible de mettre à jour la photo');
        return;
      }

      await cleanupTempFiles();

      Alert.alert('Succès', 'Photo éditée sauvegardée avec succès');
      router.back();
    } catch (error) {
      console.error('Error saving photo:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder la photo');
    } finally {
      setIsProcessing(false);
    }
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      cropScale.value = Math.max(1, Math.min(savedCropScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedCropScale.value = cropScale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      cropTranslateX.value = savedCropTranslateX.value + e.translationX;
      cropTranslateY.value = savedCropTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedCropTranslateX.value = cropTranslateX.value;
      savedCropTranslateY.value = cropTranslateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={THEME.accent} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  // CORRECTION: Si pas d'image, afficher un message d'erreur
  if (!editedImage) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Aucune image à éditer</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[petitmoCtaStyles.primary, styles.errorButton]}
        >
          <Text style={[petitmoCtaStyles.primaryText, styles.errorButtonText]}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          disabled={isProcessing}
        >
          <ChevronLeft size={ICON_SIZES.xl} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Éditer</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.imageContainer}>
        <View style={styles.imageWrapper}>
          <RNImage
            source={{ uri: editedImage }}
            style={styles.image}
            resizeMode="contain"
          />
        </View>
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Outils</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolsContainer}
        >
          <TouchableOpacity
            style={styles.toolButton}
            onPress={openCropModal}
            disabled={isProcessing}
          >
            <View style={styles.toolIconWrapper}>
              <Crop size={ICON_SIZES.md} color="#FFFFFF" strokeWidth={2} />
            </View>
            <Text style={styles.toolButtonText}>Recadrer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolButton}
            onPress={rotateImage}
            disabled={isProcessing}
          >
            <View style={styles.toolIconWrapper}>
              <RotateCw size={ICON_SIZES.md} color="#FFFFFF" strokeWidth={2} />
            </View>
            <Text style={styles.toolButtonText}>Pivoter</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolButton}
            onPress={undoEdit}
            disabled={isProcessing || editHistory.length === 0}
          >
            <View style={[
              styles.toolIconWrapper,
              editHistory.length === 0 && styles.toolDisabled
            ]}>
              <Undo
                size={ICON_SIZES.md}
                color={editHistory.length === 0 ? "#666666" : "#FFFFFF"}
                strokeWidth={2}
              />
            </View>
            <Text style={[
              styles.toolButtonText,
              editHistory.length === 0 && styles.toolTextDisabled
            ]}>Annuler</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolButton}
            onPress={savePhoto}
            disabled={isProcessing}
          >
            <View style={[styles.toolIconWrapper, styles.okIconWrapper]}>
              <Check size={ICON_SIZES.md} color="#FFFFFF" strokeWidth={2} />
            </View>
            <Text style={styles.toolButtonText}>OK</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Modal
        visible={showCropModal}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setShowCropModal(false)}
      >
        <View style={styles.cropModalContainer}>
          <View style={styles.cropHeader}>
            <TouchableOpacity
              onPress={() => setShowCropModal(false)}
              style={styles.cropHeaderButton}
            >
              <X size={ICON_SIZES.lg} color="#FFFFFF" strokeWidth={2} />
            </TouchableOpacity>
            <Text style={styles.cropTitle}>Recadrer</Text>
            <View style={styles.cropHeaderButton} />
          </View>

          <View style={styles.cropContainer}>
            <GestureDetector gesture={composedGesture}>
              <Animated.View style={styles.cropImageContainer}>
                <Animated.Image
                  source={{ uri: editedImage }}
                  style={[
                    {
                      width: cropImageSize.width,
                      height: cropImageSize.height,
                    },
                    animatedImageStyle,
                  ]}
                  resizeMode="contain"
                />
              </Animated.View>
            </GestureDetector>

            <View style={styles.cropFrame} pointerEvents="none">
              <View style={styles.cropFrameBorder} />
            </View>

            <View style={styles.cropOverlay} pointerEvents="none">
              <View style={[styles.overlaySection, styles.overlayTop]} />
              <View style={styles.overlayMiddle}>
                <View style={styles.overlaySide} />
                <View style={styles.cropFrameTransparent} />
                <View style={styles.overlaySide} />
              </View>
              <View style={[styles.overlaySection, styles.overlayBottom]} />
            </View>
          </View>

          {!isProcessing && (
            <TouchableOpacity
              style={styles.cropValidateButton}
              onPress={applyCrop}
              activeOpacity={0.7}
            >
              <Text style={styles.validateButtonText}>OK</Text>
            </TouchableOpacity>
          )}

          <View style={styles.cropHintContainer}>
            <Text style={styles.cropHintText}>
              Pincez pour zoomer, glissez pour déplacer
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    marginTop: SPACING.md,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.lg,
  },
  errorButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  errorButtonText: {
    fontSize: FONT_SIZES.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: verticalScale(50),
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  headerButton: {
    width: scaleUtil(44),
    height: scaleUtil(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  imageWrapper: {
    width: SCREEN_WIDTH - SPACING.md * 2,
    height: SCREEN_HEIGHT * 0.4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: scaleUtil(12),
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  toolbar: {
    backgroundColor: '#1A1A1A',
    paddingBottom: verticalScale(30),
    paddingTop: SPACING.lg,
    borderTopLeftRadius: scaleUtil(24),
    borderTopRightRadius: scaleUtil(24),
  },
  toolbarTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  toolsContainer: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.md,
  },
  toolButton: {
    alignItems: 'center',
    width: scaleUtil(70),
  },
  toolIconWrapper: {
    width: scaleUtil(50),
    height: scaleUtil(50),
    borderRadius: scaleUtil(14),
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  toolButtonText: {
    fontSize: FONT_SIZES.xs,
    color: '#FFFFFF',
    fontWeight: '500',
    textAlign: 'center',
  },
  toolDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  toolTextDisabled: {
    color: '#666666',
  },
  okIconWrapper: {
    backgroundColor: THEME.accent,
  },
  validateButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  cropValidateButton: {
    alignSelf: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginTop: SPACING.lg,
  },
  cropModalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  cropHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: verticalScale(50),
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  cropHeaderButton: {
    width: scaleUtil(44),
    height: scaleUtil(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cropContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropImageContainer: {
    width: CROP_FRAME_SIZE,
    height: CROP_FRAME_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropFrame: {
    position: 'absolute',
    width: CROP_FRAME_SIZE,
    height: CROP_FRAME_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropFrameBorder: {
    width: CROP_FRAME_SIZE,
    height: CROP_FRAME_SIZE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: scaleUtil(8),
  },
  cropOverlay: {
    position: 'absolute',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlaySection: {
    width: SCREEN_WIDTH,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayTop: {
    height: (SCREEN_HEIGHT - CROP_FRAME_SIZE) / 2,
  },
  overlayBottom: {
    height: (SCREEN_HEIGHT - CROP_FRAME_SIZE) / 2,
  },
  overlayMiddle: {
    flexDirection: 'row',
    width: SCREEN_WIDTH,
    height: CROP_FRAME_SIZE,
  },
  overlaySide: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
  },
  cropFrameTransparent: {
    width: CROP_FRAME_SIZE,
    height: CROP_FRAME_SIZE,
  },
  cropHintContainer: {
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  cropHintText: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
});
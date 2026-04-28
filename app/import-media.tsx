import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  AppState,
  AppStateStatus,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import PermissionModal from '@/components/PermissionModal';
import { uploadMedia, uploadPhotoAlbum } from '@/services/media';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { getOrSelectFirstChild } from '@/services/children';
import { buildImportMetadataFromExif, buildImportMetadataFromPickerAsset } from '@/utils/mediaExif';
import { getUserTier } from '@/lib/userTier';
import { checkMemoryLimit, checkVideoLimit, FREE_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';

type ImportStickerPreview = {
  capturedAtIso?: string | null;
  locationLabel?: string | null;
};

const MAX_PHOTOS_AT_ONCE = 10;

const pickerOpts = {
  /** Préserve au mieux EXIF (date, GPS) — pas de recadrage */
  allowsEditing: false as const,
  quality: 1 as const,
  exif: true as const,
};

function assetIsVideo(asset: ImagePicker.ImagePickerAsset): boolean {
  if (asset.type === 'video' || asset.type === 'pairedVideo') return true;
  if (asset.type === 'image' || asset.type === 'livePhoto') return false;
  const mime = (asset.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  if (mime.startsWith('image/')) return false;
  if (asset.duration != null && asset.duration > 0) return true;
  return false;
}

export default function ImportMediaScreen() {
  const router = useRouter();
  const { startBackgroundUploadNavigateToFeed } = usePendingMediaUploads();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [pickAttemptFinished, setPickAttemptFinished] = useState(false);
  /** Dès validation galerie : plus de roue sur cet écran (elle restait car `pickAttemptFinished` restait false). */
  const [navigatingToFeed, setNavigatingToFeed] = useState(false);
  const autoGalleryLaunchedRef = useRef(false);

  useEffect(() => {
    checkPermissions();

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      checkPermissions();
    }
  };

  const checkPermissions = async () => {
    const result = await ImagePicker.getMediaLibraryPermissionsAsync();

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
    const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
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

  /**
   * Enregistre le pending + `replace` fil **sans aucun await** : tout le réseau / EXIF part dans `upload()`.
   * Évite l’écran Importer entre la galerie native (« Ajouter ») et le fil.
   */
  const commitSelection = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[], kind: 'photo' | 'video', preview?: ImportStickerPreview | null) => {
      try {
        setNavigatingToFeed(true);
        const cap = preview?.capturedAtIso ?? null;
        const loc = preview?.locationLabel ?? null;
        const childId = await getOrSelectFirstChild();
        if (!childId) {
          Alert.alert('Aucun enfant trouvé', "Veuillez d'abord créer un profil d'enfant");
          setNavigatingToFeed(false);
          router.push('/create-child');
          return;
        }

        const limitCheck = await checkMemoryLimit(childId);
        if (!limitCheck.canCreate) {
          setNavigatingToFeed(false);
          setPickAttemptFinished(true);
          router.push({ pathname: '/paywall', params: { context: 'LIMIT_REACHED' } });
          return;
        }

        if (kind === 'photo' && assets.length > 1) {
          const first = assets[0];
          const exif = first.exif as Record<string, unknown> | null | undefined;
          const uris = assets.map(a => a.uri);
          startBackgroundUploadNavigateToFeed({
            previewUris: uris,
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const meta = await buildImportMetadataFromExif(exif ?? undefined);
              const locationOverride =
                meta.locationLabel && meta.locationLabel.trim() ? meta.locationLabel.trim() : undefined;
              const m = await uploadPhotoAlbum({
                uris,
                childId,
                capturedAtIso: meta.capturedAtIso,
                locationOverride,
              });
              return m ? [m] : null;
            },
          });
          return;
        }

        const pickedAsset = assets[0];
        const durationSec =
          kind === 'video' && pickedAsset.duration != null
            ? Math.max(1, Math.round(pickedAsset.duration / 1000))
            : undefined;

        if (kind === 'photo') {
          startBackgroundUploadNavigateToFeed({
            previewUris: [pickedAsset.uri],
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const meta = await buildImportMetadataFromPickerAsset(pickedAsset, { isVideo: false });
              const locationOverride =
                meta.locationLabel && meta.locationLabel.trim() ? meta.locationLabel.trim() : undefined;
              const m = await uploadMedia({
                uri: pickedAsset.uri,
                type: 'photo',
                childId,
                capturedAtIso: meta.capturedAtIso,
                locationOverride,
                mimeType: pickedAsset.mimeType ?? null,
                fileName: pickedAsset.fileName ?? null,
              });
              return m ? [m] : null;
            },
          });
        } else {
          const videoLimitCheck = await checkVideoLimit(childId);
          if (!videoLimitCheck.canCreate) {
            setNavigatingToFeed(false);
            setPickAttemptFinished(true);
            router.push({ pathname: '/paywall', params: { context: 'VIDEO_LIMIT_REACHED' } });
            return;
          }
          startBackgroundUploadNavigateToFeed({
            kind: 'video',
            previewUris: [pickedAsset.uri],
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const meta = await buildImportMetadataFromPickerAsset(pickedAsset, { isVideo: true });
              const locationOverride =
                meta.locationLabel && meta.locationLabel.trim() ? meta.locationLabel.trim() : undefined;
              const m = await uploadMedia({
                uri: pickedAsset.uri,
                type: 'video',
                childId,
                duration: durationSec,
                capturedAtIso: meta.capturedAtIso,
                locationOverride,
                mimeType: pickedAsset.mimeType ?? null,
                fileName: pickedAsset.fileName ?? null,
              });
              return m ? [m] : null;
            },
          });
        }
      } catch (error) {
        setNavigatingToFeed(false);
        console.error('Error committing import:', error);
        Alert.alert('Erreur', 'Impossible de lancer l’import.');
      }
    },
    [router, startBackgroundUploadNavigateToFeed]
  );

  type PickResult = 'committed' | 'cancelled' | 'not_committed';

  const pickFromLibrary = useCallback(async (): Promise<PickResult> => {
    try {
      const tier = await getUserTier();
      const isFree = tier === 'free';
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        ...pickerOpts,
        // Pas de recadrage pour les photos : `allowsEditing` ouvre une modale de crop native.
        // La limite vidéo (30s) est appliquée via `videoMaxDuration`.
        allowsEditing: false,
        videoMaxDuration: isFree ? FREE_TIER_VIDEO_MAX_DURATION : 0,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_AT_ONCE,
      });

      if (result.canceled) {
        return 'cancelled';
      }

      if (!result.assets?.length) {
        return 'not_committed';
      }

      const assets = result.assets;
      const videoCount = assets.filter(a => assetIsVideo(a)).length;
      const imageCount = assets.length - videoCount;

      if (videoCount > 0 && imageCount > 0) {
        Alert.alert(
          'Sélection',
          'Tu ne peux pas mélanger photos et vidéo dans le même import. Choisis soit des photos seulement, soit une vidéo seule.'
        );
        return 'not_committed';
      }

      if (videoCount > 1) {
        Alert.alert('Sélection', 'Tu ne peux importer qu’une vidéo à la fois.');
        return 'not_committed';
      }

      if (videoCount === 1) {
        const v = assets.find(a => assetIsVideo(a));
        if (!v) return 'not_committed';
        const meta = await buildImportMetadataFromPickerAsset(v, { isVideo: true });
        commitSelection([v], 'video', {
          capturedAtIso: meta.capturedAtIso ?? null,
          locationLabel: meta.locationLabel ?? null,
        });
        return 'committed';
      }

      if (assets.length > 1) {
        const first = assets[0];
        const exif = first.exif as Record<string, unknown> | null | undefined;
        const meta = await buildImportMetadataFromExif(exif ?? undefined);
        commitSelection(assets, 'photo', {
          capturedAtIso: meta.capturedAtIso ?? null,
          locationLabel: meta.locationLabel ?? null,
        });
        return 'committed';
      }

      const meta = await buildImportMetadataFromPickerAsset(assets[0], { isVideo: false });
      commitSelection(assets, 'photo', {
        capturedAtIso: meta.capturedAtIso ?? null,
        locationLabel: meta.locationLabel ?? null,
      });
      return 'committed';
    } catch (error) {
      console.error('Error picking from library:', error);
      Alert.alert('Erreur', 'Impossible d’ouvrir la bibliothèque média.');
      return 'not_committed';
    }
  }, [commitSelection]);

  useEffect(() => {
    if (hasPermission !== true || autoGalleryLaunchedRef.current) return;
    autoGalleryLaunchedRef.current = true;
    void (async () => {
      const res = await pickFromLibrary();
      if (res === 'cancelled') {
        router.back();
        return;
      }
      if (res !== 'committed') setPickAttemptFinished(true);
    })();
  }, [hasPermission, pickFromLibrary]);

  if (hasPermission === null) {
    return <View style={styles.container} />;
  }

  if (!hasPermission) {
    return (
      <>
        <View style={styles.container} />
        <PermissionModal
          visible={showPermissionModal}
          type="photos"
          onRequestPermission={handleRequestPermission}
          onCancel={handleCancelPermission}
        />
      </>
    );
  }

  if (navigatingToFeed) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {!pickAttemptFinished ? (
          <View style={styles.galleryOpeningWrap}>
            <ActivityIndicator size="large" color={THEME.accent} />
          </View>
        ) : (
          <View style={styles.galleryOpeningWrap}>
            <Text style={styles.subtitle}>
              Aucun média sélectionné. Rouvre la bibliothèque pour choisir des photos ou une vidéo.
            </Text>
            <TouchableOpacity style={styles.fallbackPrimaryBtn} onPress={() => void pickFromLibrary()}>
              <Text style={styles.fallbackPrimaryText}>Ouvrir photos et vidéos</Text>
            </TouchableOpacity>
          </View>
        )}
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
  content: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
  },
  galleryOpeningWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: '#8791A1',
    textAlign: 'center',
  },
  fallbackPrimaryBtn: {
    backgroundColor: THEME.accent,
    borderRadius: scale(16),
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    alignItems: 'center',
    minWidth: scale(260),
  },
  fallbackPrimaryText: {
    fontSize: FONT_SIZES.lg,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

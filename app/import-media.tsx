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
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PermissionModal from '@/components/PermissionModal';
import ImportBatchLayoutModal from '@/components/ImportBatchLayoutModal';
import { uploadMedia, uploadPhotoAlbum } from '@/services/media';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { getOrSelectFirstChild } from '@/services/children';
import { IMPORT_PHOTO_PICKER_OPTS } from '@/constants/importPicker';
import { buildImportMetadataFromPickerAsset } from '@/utils/mediaExif';
import { getUserTier } from '@/lib/userTier';
import { checkMemoryLimit, checkVideoLimit, FREE_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';
import { mediaDurationToSeconds } from '@/utils/mediaDuration';
import { IMPORT_DUPLICATE_ASSET } from '@/lib/importDuplicate';
import { buildAlbumImportFingerprint, dedupePickerAssetsByLibraryId } from '@/utils/importLibraryDedupe';
import {
  openVideoTrimEditorOnUri,
  VideoTrimNativeMissingError,
} from '@/services/videoTrimEditor';

type ImportStickerPreview = {
  capturedAtIso?: string | null;
  locationLabel?: string | null;
};

const MAX_PHOTOS_AT_ONCE = 10;
/** Copie sandbox + miniatures en parallèle (le cloud n’est pas attendu ici). */
const SEPARATE_PHOTOS_IMPORT_CONCURRENCY = 2;

async function importSeparatePhotosWithConcurrency(
  assets: ImagePicker.ImagePickerAsset[],
  childId: string
): Promise<{
  memories: NonNullable<Awaited<ReturnType<typeof uploadMedia>>>[];
  duplicateSkipped: number;
  otherFailed: number;
  limitReached: boolean;
}> {
  type Row = NonNullable<Awaited<ReturnType<typeof uploadMedia>>>;
  const results: (Row | null)[] = new Array(assets.length).fill(null);
  let duplicateSkipped = 0;
  let otherFailed = 0;
  let limitReached = false;
  let next = 0;

  const worker = async () => {
    while (true) {
      if (limitReached) return;
      const idx = next++;
      if (idx >= assets.length) return;
      const asset = assets[idx];
      try {
        const meta = await buildImportMetadataFromPickerAsset(asset, { isVideo: false });
        const locationOverride =
          meta.locationLabel && meta.locationLabel.trim() ? meta.locationLabel.trim() : undefined;
        const m = await uploadMedia({
          uri: asset.uri,
          type: 'photo',
          childId,
          capturedAtIso: meta.capturedAtIso,
          locationOverride,
          mimeType: asset.mimeType ?? null,
          fileName: asset.fileName ?? null,
          suppressFeedEmit: true,
          importAssetId: asset.assetId ?? null,
        });
        results[idx] = m;
      } catch (e) {
        if (e instanceof Error && e.message === IMPORT_DUPLICATE_ASSET) {
          duplicateSkipped += 1;
        } else if (
          e instanceof Error &&
          (e.message === 'LIMIT_REACHED' || e.message === 'VIDEO_LIMIT_REACHED')
        ) {
          limitReached = true;
          return;
        } else {
          otherFailed += 1;
          console.warn('[import-media] importSeparatePhotos', asset?.uri, e);
        }
        results[idx] = null;
      }
    }
  };

  const n = Math.min(SEPARATE_PHOTOS_IMPORT_CONCURRENCY, assets.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  const memories = results.filter((x): x is Row => x != null);
  if (memories.length === 0 && assets.length > 0) {
    console.warn('[import-media] aucun souvenir après import lot', {
      photos: assets.length,
      duplicateSkipped,
      otherFailed,
    });
  }
  return { memories, duplicateSkipped, otherFailed, limitReached };
}

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
  /** Plusieurs photos : choix album vs un post par photo (modale). */
  const [batchChoice, setBatchChoice] = useState<{
    assets: ImagePicker.ImagePickerAsset[];
    preview: ImportStickerPreview;
  } | null>(null);
  const autoGalleryLaunchedRef = useRef(false);
  /** 0 = pas de plafond picker (gratuit : on gère le message 20 s après sélection). */
  const videoMaxDurationRef = useRef(0);
  const isFreeTierRef = useRef(true);

  useEffect(() => {
    void getUserTier().then(tier => {
      isFreeTierRef.current = tier === 'free';
      /** Payant : pas de plafond. Gratuit : 1ʳᵉ sélection libre, puis message + trim système si > 20 s. */
      videoMaxDurationRef.current = 0;
    });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
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
      const res = await pickFromLibrary();
      if (res === 'cancelled') {
        router.back();
        return;
      }
      if (res !== 'committed') setPickAttemptFinished(true);
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
    async (
      assets: ImagePicker.ImagePickerAsset[],
      kind: 'photo' | 'video',
      preview?: ImportStickerPreview | null,
      photoBatchLayout: 'album' | 'separate' = 'album'
    ) => {
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

        const limitCheck = await checkMemoryLimit(childId, { force: true });
        const tier = await getUserTier();
        const dedupedForSeparate =
          kind === 'photo' && photoBatchLayout === 'separate' && assets.length > 1
            ? dedupePickerAssetsByLibraryId(assets)
            : null;
        const slotsNeeded =
          dedupedForSeparate != null
            ? Math.max(1, dedupedForSeparate.length)
            : kind === 'photo' && assets.length > 1
              ? 1
              : 1;

        if (tier === 'free' && limitCheck.current + slotsNeeded > limitCheck.limit) {
          setNavigatingToFeed(false);
          setPickAttemptFinished(true);
          const left = Math.max(0, limitCheck.limit - limitCheck.current);
          Alert.alert(
            'Limite gratuite',
            left === 0
              ? 'Tu as atteint le nombre max de souvenirs pour ce profil.'
              : `Il reste ${left} emplacement${left > 1 ? 's' : ''} pour ce profil. Réduis ta sélection, ou choisis « Un seul post » pour ne créer qu’un souvenir.`
          );
          if (left === 0) {
            router.replace({ pathname: '/paywall', params: { context: 'LIMIT_REACHED', returnTo: 'fil' } });
          }
          return;
        }

        if (!limitCheck.canCreate) {
          setNavigatingToFeed(false);
          setPickAttemptFinished(true);
          router.replace({ pathname: '/paywall', params: { context: 'LIMIT_REACHED', returnTo: 'fil' } });
          return;
        }

        /**
         * Un post par photo : un seul pending + un seul router.replace.
         * Enchaîner N× startBackgroundUploadNavigateToFeed faisait planter l’app (navigation + SQLite / mémoire).
         * Traitement local (sandbox + dérivés) en parallèle (concurrence bornée) ; sync cloud toujours en arrière-plan.
         */
        if (
          kind === 'photo' &&
          photoBatchLayout === 'separate' &&
          dedupedForSeparate != null &&
          dedupedForSeparate.length > 1
        ) {
          const firstUri = dedupedForSeparate[0]?.uri?.trim() ?? '';
          startBackgroundUploadNavigateToFeed({
            previewUris: firstUri ? [firstUri] : [],
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const { memories: inserted, duplicateSkipped, otherFailed, limitReached } =
                await importSeparatePhotosWithConcurrency(dedupedForSeparate, childId);
              if (limitReached && inserted.length === 0) {
                throw new Error('LIMIT_REACHED');
              }
              if (limitReached && inserted.length > 0) {
                requestAnimationFrame(() => {
                  Alert.alert(
                    'Limite gratuite',
                    `Tu as atteint le nombre max de souvenirs (${limitCheck.limit}). Les photos déjà importées restent dans le fil.`
                  );
                  router.replace({ pathname: '/paywall', params: { context: 'LIMIT_REACHED', returnTo: 'fil' } });
                });
              }
              if (duplicateSkipped > 0 || otherFailed > 0) {
                requestAnimationFrame(() => {
                  if (duplicateSkipped > 0 && otherFailed === 0) {
                    Alert.alert(
                      'Déjà dans le fil',
                      `${duplicateSkipped} photo${duplicateSkipped > 1 ? 's' : ''} ${duplicateSkipped > 1 ? 'étaient' : 'était'} déjà importée${duplicateSkipped > 1 ? 's' : ''} pour cet enfant.`
                    );
                  } else if (otherFailed > 0) {
                    const parts: string[] = [];
                    if (duplicateSkipped > 0) {
                      parts.push(
                        `${duplicateSkipped} déjà importée${duplicateSkipped > 1 ? 's' : ''}`
                      );
                    }
                    parts.push(
                      otherFailed === 1
                        ? '1 import a échoué'
                        : `${otherFailed} imports ont échoué`
                    );
                    Alert.alert('Import partiel', parts.join(' · ') + '. Réessaie depuis Importer si besoin.');
                  }
                });
              }
              return inserted.length > 0 ? inserted : null;
            },
          });
          return;
        }

        if (kind === 'photo' && assets.length > 1 && photoBatchLayout === 'album') {
          const first = assets[0];
          const uris = assets.map(a => a.uri);
          startBackgroundUploadNavigateToFeed({
            previewUris: uris,
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const meta = await buildImportMetadataFromPickerAsset(first, { isVideo: false });
              const locationOverride =
                meta.locationLabel && meta.locationLabel.trim() ? meta.locationLabel.trim() : undefined;
              const albumFp = buildAlbumImportFingerprint(assets.map(a => a.assetId));
              const m = await uploadPhotoAlbum({
                uris,
                childId,
                capturedAtIso: meta.capturedAtIso,
                locationOverride,
                importSourceFingerprint: albumFp,
              });
              return m ? [m] : null;
            },
          });
          return;
        }

        const pickedAsset = assets[0];
        const durationSec =
          kind === 'video' && pickedAsset.duration != null
            ? mediaDurationToSeconds(pickedAsset.duration)
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
                importAssetId: pickedAsset.assetId ?? null,
              });
              return m ? [m] : null;
            },
          });
        } else {
          const videoLimitCheck = await checkVideoLimit(childId);
          if (!videoLimitCheck.canCreate) {
            setNavigatingToFeed(false);
            setPickAttemptFinished(true);
            router.replace({ pathname: '/paywall', params: { context: 'VIDEO_LIMIT_REACHED', returnTo: 'fil' } });
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
                importAssetId: pickedAsset.assetId ?? null,
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        ...IMPORT_PHOTO_PICKER_OPTS,
        videoMaxDuration: videoMaxDurationRef.current,
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

        const durationSec = mediaDurationToSeconds(v.duration);

        /** +1 s de marge : métadonnées galerie souvent arrondies (ex. 20,4 → 21). */
        if (
          isFreeTierRef.current &&
          durationSec > FREE_TIER_VIDEO_MAX_DURATION + 1
        ) {
          const trimmedAsset = await new Promise<ImagePicker.ImagePickerAsset | null>(resolve => {
            const runTrimLoop = () => {
              Alert.alert(
                'Vidéo trop longue',
                `En mode gratuit, la vidéo ne peut pas dépasser ${FREE_TIER_VIDEO_MAX_DURATION} secondes pour des raisons de coût de stockage.`,
                [
                  {
                    text: 'Annuler',
                    style: 'cancel',
                    onPress: () => resolve(null),
                  },
                  {
                    text: 'Passer à Petitmo+',
                    onPress: () => {
                      router.replace({
                        pathname: '/paywall',
                        params: { context: 'VIDEO_LIMIT_REACHED', returnTo: 'fil' },
                      });
                      resolve(null);
                    },
                  },
                  {
                    text: 'Raccourcir la vidéo',
                    onPress: () => {
                      void (async () => {
                        try {
                          /** Éditeur natif sur la même URI — pas de 2ᵉ passage galerie. */
                          const trimmed = await openVideoTrimEditorOnUri(v.uri, {
                            maxDurationSec: FREE_TIER_VIDEO_MAX_DURATION,
                          });
                          if (!trimmed?.uri) {
                            /** Annulé dans l’éditeur → on propose encore le choix. */
                            runTrimLoop();
                            return;
                          }
                          const outSec = trimmed.durationSec > 0
                            ? trimmed.durationSec
                            : FREE_TIER_VIDEO_MAX_DURATION;
                          if (outSec > FREE_TIER_VIDEO_MAX_DURATION + 1) {
                            Alert.alert(
                              'Encore trop longue',
                              `Garde un extrait d’au plus ${FREE_TIER_VIDEO_MAX_DURATION} secondes.`,
                              [
                                { text: 'Réessayer', onPress: () => runTrimLoop() },
                                { text: 'Annuler', style: 'cancel', onPress: () => resolve(null) },
                              ],
                            );
                            return;
                          }
                          resolve({
                            ...v,
                            uri: trimmed.uri,
                            duration: outSec * 1000,
                            type: 'video',
                            fileName: v.fileName ?? `trim-${Date.now()}.mp4`,
                            mimeType: v.mimeType ?? 'video/mp4',
                          });
                        } catch (e) {
                          if (e instanceof VideoTrimNativeMissingError) {
                            Alert.alert(
                              'Mise à jour requise',
                              'Le coupe-vidéo nécessite un nouveau build de l’app (dev ou TestFlight). Relance npm run dev:ios:build ou npm run tf:ios, puis réessaie.',
                              [{ text: 'OK', onPress: () => resolve(null) }],
                            );
                            return;
                          }
                          console.warn('[import-media] trim', e);
                          Alert.alert(
                            'Impossible de raccourcir',
                            'Réessaie ou passe à Petitmo+.',
                            [
                              { text: 'Réessayer', onPress: () => runTrimLoop() },
                              { text: 'Annuler', style: 'cancel', onPress: () => resolve(null) },
                            ],
                          );
                        }
                      })();
                    },
                  },
                ],
              );
            };
            runTrimLoop();
          });
          if (!trimmedAsset) return 'not_committed';
          const metaTrim = await buildImportMetadataFromPickerAsset(trimmedAsset, { isVideo: true });
          commitSelection([trimmedAsset], 'video', {
            capturedAtIso: metaTrim.capturedAtIso ?? null,
            locationLabel: metaTrim.locationLabel ?? null,
          });
          return 'committed';
        }

        const meta = await buildImportMetadataFromPickerAsset(v, { isVideo: true });
        commitSelection([v], 'video', {
          capturedAtIso: meta.capturedAtIso ?? null,
          locationLabel: meta.locationLabel ?? null,
        });
        return 'committed';
      }

      if (assets.length > 1) {
        const first = assets[0];
        const meta = await buildImportMetadataFromPickerAsset(first, { isVideo: false });
        setBatchChoice({
          assets,
          preview: {
            capturedAtIso: meta.capturedAtIso ?? null,
            locationLabel: meta.locationLabel ?? null,
          },
        });
        return 'not_committed';
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
  }, [commitSelection, setBatchChoice, router]);

  /** Ouvre la galerie dès le montage (permission + picker enchaînés, sans attendre un 2e rendu). */
  useEffect(() => {
    if (autoGalleryLaunchedRef.current) return;
    autoGalleryLaunchedRef.current = true;

    void (async () => {
      try {
        let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        if (!perm.granted) {
          if (!perm.canAskAgain) {
            router.back();
            return;
          }
          setShowPermissionModal(true);
          setPickAttemptFinished(true);
          setHasPermission(false);
          return;
        }
        setHasPermission(true);

        const res = await pickFromLibrary();
        if (res === 'cancelled') {
          router.back();
          return;
        }
        if (res !== 'committed') setPickAttemptFinished(true);
      } catch (e) {
        console.error('[import-media] ouverture galerie', e);
        setPickAttemptFinished(true);
        Alert.alert('Erreur', 'Impossible d’ouvrir la bibliothèque média.');
      }
    })();
  }, [pickFromLibrary, router]);

  const batchLayoutModalEl = (
    <ImportBatchLayoutModal
      visible={batchChoice != null}
      count={batchChoice?.assets.length ?? 0}
      onChooseSinglePost={() => {
        const b = batchChoice;
        if (!b) return;
        setBatchChoice(null);
        void commitSelection(b.assets, 'photo', b.preview, 'album');
      }}
      onChooseSeparatePosts={() => {
        const b = batchChoice;
        if (!b) return;
        setBatchChoice(null);
        void commitSelection(b.assets, 'photo', b.preview, 'separate');
      }}
      onDismiss={() => setBatchChoice(null)}
    />
  );

  if (hasPermission === null) {
    return (
      <>
        {batchLayoutModalEl}
        <View style={styles.container} />
      </>
    );
  }

  if (!hasPermission) {
    return (
      <>
        {batchLayoutModalEl}
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
    return (
      <>
        {batchLayoutModalEl}
        <View style={styles.container} />
      </>
    );
  }

  return (
    <>
      {batchLayoutModalEl}
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
            <TouchableOpacity
              style={[petitmoCtaStyles.primary, styles.fallbackPrimaryBtn]}
              onPress={() => void pickFromLibrary()}
            >
              <Text style={[petitmoCtaStyles.primaryText, styles.fallbackPrimaryText]}>
                Ouvrir photos et vidéos
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
    </>
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
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    minWidth: scale(260),
  },
  fallbackPrimaryText: {
    fontSize: FONT_SIZES.lg,
  },
});

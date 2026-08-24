import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import ImportBatchLayoutModal from '@/components/ImportBatchLayoutModal';
import { FeedMediaPrepOverlay } from '@/components/FeedMediaPrepOverlay';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { uploadMedia, uploadPhotoAlbum } from '@/services/media';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { getOrSelectFirstChild } from '@/services/children';
import { IMPORT_PHOTO_PICKER_OPTS } from '@/constants/importPicker';
import { buildImportMetadataFromPickerAsset } from '@/utils/mediaExif';
import { getUserTier } from '@/lib/userTier';
import { checkMemoryLimit, checkVideoLimit, FREE_TIER_VIDEO_MAX_DURATION, PAID_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';
import { mediaDurationToSeconds } from '@/utils/mediaDuration';
import { promptFreeTierLimitThenPaywall } from '@/utils/freeTierLimitGate';
import { IMPORT_DUPLICATE_ASSET } from '@/lib/importDuplicate';
import { buildAlbumImportFingerprint, dedupePickerAssetsByLibraryId } from '@/utils/importLibraryDedupe';
import { VideoTrimModal } from '@/components/VideoTrimModal';
import {
  isVideoTrimNativeAvailable,
  trimVideoClipToLocalFile,
  VideoTrimNativeMissingError,
} from '@/services/videoTrimNative';
import { takePendingSharedImport } from '@/lib/pendingShareMedia';

type ImportStickerPreview = {
  capturedAtIso?: string | null;
  locationLabel?: string | null;
};

const MAX_PHOTOS_AT_ONCE = 10;
/** Copie sandbox + miniatures en parallèle (le cloud n’est pas attendu ici). */
const SEPARATE_PHOTOS_IMPORT_CONCURRENCY = 3;

async function importSeparatePhotosWithConcurrency(
  assets: ImagePicker.ImagePickerAsset[],
  childId: string,
  opts?: {
    onProgress?: (done: number, total: number) => void;
    onInserted?: (memory: NonNullable<Awaited<ReturnType<typeof uploadMedia>>>) => void;
    /** URIs encore en file (pour la preview pending). */
    onRemainingPreviewUris?: (uris: string[]) => void;
  },
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
  let doneCount = 0;
  const total = assets.length;
  const remainingUris = assets.map(a => a.uri).filter(u => !!u?.trim());

  const markUriDone = (uri: string | undefined) => {
    const u = uri?.trim();
    if (!u) return;
    const i = remainingUris.indexOf(u);
    if (i >= 0) remainingUris.splice(i, 1);
    opts?.onRemainingPreviewUris?.(remainingUris.slice());
  };

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
        if (m) opts?.onInserted?.(m);
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
      } finally {
        markUriDone(asset.uri);
        doneCount += 1;
        opts?.onProgress?.(doneCount, total);
      }
    }
  };

  opts?.onProgress?.(0, total);
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
  const { t } = useAppTranslation('common');
  const { startBackgroundUploadNavigateToFeed } = usePendingMediaUploads();
  const [pickAttemptFinished, setPickAttemptFinished] = useState(false);
  /** Dès validation galerie : plus de roue sur cet écran (elle restait car `pickAttemptFinished` restait false). */
  const [navigatingToFeed, setNavigatingToFeed] = useState(false);
  /** Plusieurs photos : choix album vs un post par photo (modale). */
  const [batchChoice, setBatchChoice] = useState<{
    assets: ImagePicker.ImagePickerAsset[];
    preview: ImportStickerPreview;
  } | null>(null);
  const [videoTrimRequest, setVideoTrimRequest] = useState<{
    asset: ImagePicker.ImagePickerAsset;
    maxDurationSec: number;
    resolve: (asset: ImagePicker.ImagePickerAsset | null) => void;
  } | null>(null);
  /** Trim FFmpeg hors modale (évite WatchdogTermination / Low memory). */
  const [videoTrimExporting, setVideoTrimExporting] = useState(false);
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

        /** Vidéo : fil immédiat (quotas / EXIF dans upload) — pas d’attente Importer. */
        if (kind === 'video') {
          const pickedAsset = assets[0];
          if (!pickedAsset) {
            setNavigatingToFeed(false);
            return;
          }
          const durationSec =
            pickedAsset.duration != null
              ? mediaDurationToSeconds(pickedAsset.duration)
              : undefined;
          startBackgroundUploadNavigateToFeed({
            kind: 'video',
            previewUris: [pickedAsset.uri],
            capturedAtPreviewIso: cap,
            locationPreview: loc,
            upload: async () => {
              const childIdForVideo = await getOrSelectFirstChild();
              if (!childIdForVideo) throw new Error('NO_CHILD');
              const memLimit = await checkMemoryLimit(childIdForVideo, { force: true });
              if (!memLimit.canCreate) throw new Error('LIMIT_REACHED');
              const videoLimitCheck = await checkVideoLimit(childIdForVideo);
              if (!videoLimitCheck.canCreate) throw new Error('VIDEO_LIMIT_REACHED');
              const meta = await buildImportMetadataFromPickerAsset(pickedAsset, { isVideo: true });
              const locationOverride =
                meta.locationLabel && meta.locationLabel.trim()
                  ? meta.locationLabel.trim()
                  : loc?.trim() || undefined;
              const m = await uploadMedia({
                uri: pickedAsset.uri,
                type: 'video',
                childId: childIdForVideo,
                duration: durationSec,
                capturedAtIso: meta.capturedAtIso ?? cap ?? undefined,
                locationOverride,
                mimeType: pickedAsset.mimeType ?? null,
                fileName: pickedAsset.fileName ?? null,
                importAssetId: pickedAsset.assetId ?? null,
              });
              return m ? [m] : null;
            },
          });
          return;
        }

        const childId = await getOrSelectFirstChild();
        if (!childId) {
          Alert.alert('Aucun enfant trouvé', "Crée d'abord un profil d'enfant");
          setNavigatingToFeed(false);
          router.push('/create-child');
          return;
        }

        const limitCheck = await checkMemoryLimit(childId, {
          force: true,
          skipRemotePull: true,
        });
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
          if (left === 0) {
            router.replace('/(tabs)/fil');
            promptFreeTierLimitThenPaywall({
              kind: 'memories',
              router,
              replace: true,
              returnTo: 'fil',
            });
            return;
          }
          Alert.alert(
            'Limite gratuite',
            `Il reste ${left} emplacement${left > 1 ? 's' : ''} pour ce profil. Réduis ta sélection, ou choisis « Un seul post » pour ne créer qu’un souvenir.`
          );
          return;
        }

        if (!limitCheck.canCreate) {
          setNavigatingToFeed(false);
          router.replace('/(tabs)/fil');
          promptFreeTierLimitThenPaywall({
            kind: 'memories',
            router,
            replace: true,
            returnTo: 'fil',
          });
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
            batchTotal: dedupedForSeparate.length,
            upload: async helpers => {
              const notifiedIds = new Set<string>();
              const { memories: inserted, duplicateSkipped, otherFailed, limitReached } =
                await importSeparatePhotosWithConcurrency(dedupedForSeparate, childId, {
                  onProgress: (done, total) => helpers.reportProgress(done, total),
                  onRemainingPreviewUris: uris => {
                    if (uris[0]) helpers.setPreviewUris([uris[0]]);
                  },
                  onInserted: m => {
                    notifiedIds.add(m.id);
                    helpers.notifyInserted([m]);
                  },
                });
              if (limitReached && inserted.length === 0) {
                throw new Error('LIMIT_REACHED');
              }
              if (limitReached && inserted.length > 0) {
                requestAnimationFrame(() => {
                  promptFreeTierLimitThenPaywall({
                    kind: 'memories',
                    router,
                    replace: true,
                    returnTo: 'fil',
                  });
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
              /**
               * Déjà poussées une par une : retirer le pending sans re-émettre le lot.
               */
              if (notifiedIds.size > 0) {
                helpers.dismissPending();
                return null;
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
      } catch (error) {
        setNavigatingToFeed(false);
        console.error('Error committing import:', error);
        Alert.alert('Erreur', 'Impossible de lancer l’import.');
      }
    },
    [router, startBackgroundUploadNavigateToFeed]
  );

  type PickResult = 'committed' | 'cancelled' | 'not_committed' | 'left' | 'batch_choice';

  /** Traite une sélection (galerie ou Share Extension) — local-first, pas d’attente cloud. */
  const processPickedAssets = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]): Promise<PickResult> => {
      try {
        if (!assets?.length) {
          return 'not_committed';
        }

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

          /**
           * Gratuit : d’abord le plafond **nombre** de vidéos (et souvenirs),
           * ensuite seulement le trim si la durée dépasse 20 s.
           */
          if (isFreeTierRef.current) {
            const childId = await getOrSelectFirstChild();
            if (childId) {
              const videoLimitCheck = await checkVideoLimit(childId, {
                skipRemotePull: true,
              });
              if (!videoLimitCheck.canCreate) {
                router.replace('/(tabs)/fil');
                promptFreeTierLimitThenPaywall({
                  kind: 'videos',
                  router,
                  replace: true,
                  returnTo: 'fil',
                });
                return 'left';
              }
              const memLimit = await checkMemoryLimit(childId, {
                force: true,
                skipRemotePull: true,
              });
              if (!memLimit.canCreate) {
                router.replace('/(tabs)/fil');
                promptFreeTierLimitThenPaywall({
                  kind: 'memories',
                  router,
                  replace: true,
                  returnTo: 'fil',
                });
                return 'left';
              }
            }
          }

          const durationSec = mediaDurationToSeconds(v.duration);
          const maxVideoSec = isFreeTierRef.current
            ? FREE_TIER_VIDEO_MAX_DURATION
            : PAID_TIER_VIDEO_MAX_DURATION;

          /** +1 s de marge : métadonnées galerie souvent arrondies. */
          if (durationSec > maxVideoSec + 1) {
            if (!isVideoTrimNativeAvailable()) {
              Alert.alert(
                t('videoTrim.needsRebuildTitle'),
                t('videoTrim.needsRebuildBody'),
                [{ text: 'OK', onPress: () => router.replace('/(tabs)/fil') }],
              );
              return 'left';
            }

            const trimmedAsset = await new Promise<ImagePicker.ImagePickerAsset | null>(resolve => {
              setVideoTrimRequest({
                asset: v,
                maxDurationSec: maxVideoSec,
                resolve,
              });
            });
            if (!trimmedAsset) {
              router.replace('/(tabs)/fil');
              return 'left';
            }
            const outSec = mediaDurationToSeconds(trimmedAsset.duration);
            if (outSec > maxVideoSec + 1) {
              Alert.alert(
                t('videoTrim.stillTooLongTitle'),
                t('videoTrim.stillTooLongBody', { max: maxVideoSec }),
                [{ text: 'OK', onPress: () => router.replace('/(tabs)/fil') }],
              );
              return 'left';
            }
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
          /** Modale immédiatement — pas d’attente EXIF (évite le flash « Ouvrir photos… »). */
          setBatchChoice({
            assets,
            preview: { capturedAtIso: null, locationLabel: null },
          });
          void buildImportMetadataFromPickerAsset(assets[0], { isVideo: false }).then(meta => {
            setBatchChoice(prev => {
              if (!prev || prev.assets !== assets) return prev;
              return {
                ...prev,
                preview: {
                  capturedAtIso: meta.capturedAtIso ?? null,
                  locationLabel: meta.locationLabel ?? null,
                },
              };
            });
          });
          return 'batch_choice';
        }

        const meta = await buildImportMetadataFromPickerAsset(assets[0], { isVideo: false });
        commitSelection(assets, 'photo', {
          capturedAtIso: meta.capturedAtIso ?? null,
          locationLabel: meta.locationLabel ?? null,
        });
        return 'committed';
      } catch (error) {
        console.error('Error processing import assets:', error);
        Alert.alert('Erreur', 'Impossible d’importer ce média.');
        return 'not_committed';
      }
    },
    [commitSelection, setBatchChoice, router, t],
  );

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

      return processPickedAssets(result.assets);
    } catch (error) {
      console.error('Error picking from library:', error);
      Alert.alert('Erreur', 'Impossible d’ouvrir la bibliothèque média.');
      return 'not_committed';
    }
  }, [processPickedAssets]);

  /**
   * Ouvre la galerie dès le montage — ou consomme un partage iOS (Share Extension).
   *
   * Aucune demande d’autorisation photothèque : `launchImageLibraryAsync` passe par le
   * sélecteur système (PHPicker) qui n’expose que les médias choisis. Demander l’accès
   * ajouterait une boîte iOS inutile avant la grille de photos.
   */
  useEffect(() => {
    if (autoGalleryLaunchedRef.current) return;
    autoGalleryLaunchedRef.current = true;

    void (async () => {
      try {
        const shared = takePendingSharedImport();
        if (shared?.length) {
          const res = await processPickedAssets(shared);
          if (res === 'cancelled' || res === 'not_committed') {
            router.back();
            return;
          }
          if (res === 'left') return;
          if (res === 'batch_choice') return;
          if (res !== 'committed') setPickAttemptFinished(true);
          return;
        }

        const res = await pickFromLibrary();
        if (res === 'cancelled') {
          router.back();
          return;
        }
        /** Quota : déjà `replace` fil + Alert — ne pas afficher « Ouvrir photos et vidéos ». */
        if (res === 'left') return;
        /** Modale lot album / posts séparés — garder le fond neutre (spinner), pas le CTA fallback. */
        if (res === 'batch_choice') return;
        if (res !== 'committed') setPickAttemptFinished(true);
      } catch (e) {
        console.error('[import-media] ouverture galerie', e);
        setPickAttemptFinished(true);
        Alert.alert('Erreur', 'Impossible d’ouvrir la bibliothèque média.');
      }
    })();
  }, [pickFromLibrary, processPickedAssets, router]);

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
      onDismiss={() => {
        setBatchChoice(null);
        setPickAttemptFinished(true);
      }}
    />
  );

  const videoTrimModalEl = (
    <VideoTrimModal
      visible={videoTrimRequest != null}
      videoUri={videoTrimRequest?.asset.uri ?? ''}
      durationSec={
        videoTrimRequest?.asset.duration != null
          ? mediaDurationToSeconds(videoTrimRequest.asset.duration)
          : 0
      }
      maxDurationSec={videoTrimRequest?.maxDurationSec ?? FREE_TIER_VIDEO_MAX_DURATION}
      isFreeTier={isFreeTierRef.current}
      onCancel={() => {
        const req = videoTrimRequest;
        setVideoTrimRequest(null);
        req?.resolve(null);
      }}
      onConfirm={range => {
        const req = videoTrimRequest;
        if (!req) return;
        setVideoTrimRequest(null);
        void (async () => {
          setVideoTrimExporting(true);
          // Laisser la modale / player se démonter avant FFmpeg.
          await new Promise<void>(resolve => setTimeout(resolve, 250));
          try {
            const result = await trimVideoClipToLocalFile({
              inputUri: req.asset.uri,
              startSec: range.startSec,
              endSec: range.endSec,
            });
            req.resolve({
              ...req.asset,
              uri: result.uri,
              duration: result.durationSec * 1000,
              type: 'video',
              fileName: req.asset.fileName ?? `trim-${Date.now()}.mp4`,
              mimeType: req.asset.mimeType ?? 'video/mp4',
            });
          } catch (e) {
            if (e instanceof VideoTrimNativeMissingError) {
              Alert.alert(t('videoTrim.needsRebuildTitle'), t('videoTrim.needsRebuildBody'));
            } else {
              console.warn('[import-media] video trim export', e);
              Alert.alert(t('videoTrim.exportFailedTitle'), t('videoTrim.exportFailedBody'));
            }
            req.resolve(null);
          } finally {
            setVideoTrimExporting(false);
          }
        })();
      }}
      onUpgrade={
        isFreeTierRef.current
          ? () => {
              const req = videoTrimRequest;
              setVideoTrimRequest(null);
              req?.resolve(null);
              router.replace({
                pathname: '/paywall',
                params: { context: 'GENERAL', returnTo: 'fil' },
              });
            }
          : undefined
      }
    />
  );

  if (navigatingToFeed) {
    return (
      <>
        {batchLayoutModalEl}
        {videoTrimModalEl}
        <View style={styles.container}>
          <FeedMediaPrepOverlay label={t('mediaPrep.addingToFeed')} />
        </View>
      </>
    );
  }

  /** Pendant la modale lot : fond neutre + spinner, jamais le CTA « Ouvrir photos… ». */
  if (batchChoice != null) {
    return (
      <>
        {batchLayoutModalEl}
        {videoTrimModalEl}
        <View style={styles.container}>
          <View style={styles.galleryOpeningWrap}>
            <ActivityIndicator size="large" color={THEME.accent} />
          </View>
        </View>
      </>
    );
  }

  /** Pendant l’éditeur de coupe vidéo : modal plein écran uniquement. */
  if (videoTrimExporting) {
    return (
      <>
        {batchLayoutModalEl}
        <View style={styles.container}>
          <FeedMediaPrepOverlay label={t('videoTrim.exporting')} />
        </View>
      </>
    );
  }

  if (videoTrimRequest != null) {
    return (
      <>
        {batchLayoutModalEl}
        {videoTrimModalEl}
        <View style={styles.container} />
      </>
    );
  }

  return (
    <>
      {batchLayoutModalEl}
      {videoTrimModalEl}
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
            <PetitmoPrimaryPressable
              style={styles.fallbackPrimaryBtn}
              onPress={() => void pickFromLibrary()}
            >
              <Text style={[petitmoCtaStyles.primaryText, styles.fallbackPrimaryText]}>
                Ouvrir photos et vidéos
              </Text>
            </PetitmoPrimaryPressable>
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

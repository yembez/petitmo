import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, DeviceEventEmitter, InteractionManager } from 'react-native';
import { useRouter } from 'expo-router';
import type { MemoryRow } from '@/services/media';
import { setFeedBootstrapDisplayUrls, setFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import { armSilentInitialFilLoadAfterMediaImport } from '@/services/feedAfterImportFlags';
import { armFeedSnapToKeyOnFocus } from '@/services/feedScrollRestore';
import { IMPORT_DUPLICATE_ASSET } from '@/lib/importDuplicate';
import { setFeedAutoplayActiveMemoryId } from '@/lib/feedAutoplayStore';
import { extractVideoFrameJpeg } from '@/services/videoPosterLocal';
import { VIDEO_POSTER_FEED_JPEG_QUALITY } from '@/lib/limits';
import {
  peekFeedVideoPosterStableCache,
  setFeedVideoPosterStableCache,
} from '@/hooks/feedVideoPosterStableCache';
import { promptFreeTierLimitFromError } from '@/utils/freeTierLimitGate';

export type PendingMediaKind = 'photo' | 'video';

export type PendingUpload = {
  tempId: string;
  previewUris: string[];
  kind: PendingMediaKind;
  status: 'uploading' | 'error';
  /** Date de prise (EXIF / fichier) pour l’overlay fil pendant l’envoi — distinct de `inserted_at`. */
  capturedAtPreviewIso?: string | null;
  /** Lieu EXIF (géocodé) pour la pastille pendant l’envoi. */
  locationPreview?: string | null;
  /** Frame JPEG extraite tout de suite (vidéo) — évite l’écran noir en attendant le poster sandbox. */
  previewPosterUri?: string | null;
  errorMessage?: string;
  /**
   * Import réussi (1 souvenir) : la ligne « envoi » affiche déjà `FilMemoryRow` avec ce souvenir
   * avant retrait du pending → même slot / même clé FlatList, moins de flash image.
   */
  committedMemory?: MemoryRow;
  /** Lot « un post par photo » : progression affichée sous la roue. */
  batchDone?: number;
  batchTotal?: number;
};

export type PendingUploadHelpers = {
  /** Met à jour la pastille « 3/10 » sur la carte pending. */
  reportProgress: (done: number, total: number) => void;
  /**
   * Insère déjà dans le fil sans retirer le pending (évite l’attente d’un gros lot).
   * Ne pas passer `pendingTempId` ici.
   */
  notifyInserted: (rows: MemoryRow[]) => void;
  /** Remplace l’URI preview (ex. prochaine photo du lot). */
  setPreviewUris: (uris: string[]) => void;
  /**
   * Retire le pending sans ré-émettre (après notifyInserted progressifs).
   * L’`upload` doit alors retourner `null`.
   */
  dismissPending: () => void;
};

type PendingMediaUploadsValue = {
  pending: PendingUpload[];
  /**
   * Affiche les `previewUris` dans le fil tout de suite, lance `upload()` en arrière-plan.
   * `upload` doit retourner les lignes insérées (`MemoryRow[]`) ou `null` si échec.
   */
  startBackgroundUploadNavigateToFeed: (args: {
    previewUris: string[];
    kind?: PendingMediaKind;
    capturedAtPreviewIso?: string | null;
    locationPreview?: string | null;
    /** Si > 1 : pastille de progression sur la carte pending. */
    batchTotal?: number;
    upload: (helpers: PendingUploadHelpers) => Promise<MemoryRow[] | null>;
  }) => void;
};

const PendingMediaUploadsContext = createContext<PendingMediaUploadsValue | null>(null);

export function PendingMediaUploadsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const startBackgroundUploadNavigateToFeed = useCallback(
    ({
      previewUris,
      kind = 'photo',
      capturedAtPreviewIso,
      locationPreview,
      batchTotal,
      upload,
    }: {
      previewUris: string[];
      kind?: PendingMediaKind;
      capturedAtPreviewIso?: string | null;
      locationPreview?: string | null;
      batchTotal?: number;
      upload: (helpers: PendingUploadHelpers) => Promise<MemoryRow[] | null>;
    }) => {
      void (async () => {
        armSilentInitialFilLoadAfterMediaImport();
        const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        /** Scroll vers la carte où qu’elle soit chronologiquement (pas forcément le haut). */
        armFeedSnapToKeyOnFocus(tempId);
        if (kind === 'video') {
          setFeedAutoplayActiveMemoryId(null);
        }

        let previewPosterUri: string | undefined;
        /** Frame JPEG avant navigation (plafond ~0,8 s) — affichage immédiat sans attendre le sandbox. */
        if (kind === 'video' && previewUris[0]?.trim()) {
          setFeedBootstrapVideoUri(tempId, previewUris[0]);
          try {
            const frame = await Promise.race([
              extractVideoFrameJpeg(previewUris[0], {
                quality: VIDEO_POSTER_FEED_JPEG_QUALITY,
              }),
              new Promise<null>(resolve => {
                setTimeout(() => resolve(null), 800);
              }),
            ]);
            const uri = frame?.trim();
            if (uri) {
              previewPosterUri = uri;
              setFeedVideoPosterStableCache(tempId, uri);
            }
          } catch {
            /* ignore */
          }
        } else if (kind === 'photo' && previewUris.some(u => u?.trim())) {
          setFeedBootstrapDisplayUrls(tempId, previewUris.filter(u => u?.trim()));
        }

        const initialBatchTotal =
          typeof batchTotal === 'number' && batchTotal > 1 ? Math.floor(batchTotal) : undefined;

        setPending(p => [
          ...p,
          {
            tempId,
            previewUris,
            kind,
            status: 'uploading',
            ...(capturedAtPreviewIso?.trim()
              ? { capturedAtPreviewIso: capturedAtPreviewIso.trim() }
              : {}),
            ...(locationPreview?.trim() ? { locationPreview: locationPreview.trim() } : {}),
            ...(previewPosterUri ? { previewPosterUri } : {}),
            ...(initialBatchTotal
              ? { batchDone: 0, batchTotal: initialBatchTotal }
              : {}),
          },
        ]);
        router.replace('/(tabs)/fil');

        if (kind === 'video' && previewUris[0]?.trim() && !previewPosterUri) {
          void extractVideoFrameJpeg(previewUris[0], {
            quality: VIDEO_POSTER_FEED_JPEG_QUALITY,
          }).then(frame => {
            const uri = frame?.trim();
            if (!uri) return;
            setFeedVideoPosterStableCache(tempId, uri);
            setPending(p =>
              p.map(x => (x.tempId === tempId ? { ...x, previewPosterUri: uri } : x)),
            );
          });
        }

        let dismissedByHelper = false;
        const helpers: PendingUploadHelpers = {
          reportProgress: (done, total) => {
            setPending(p =>
              p.map(x =>
                x.tempId === tempId
                  ? {
                      ...x,
                      batchDone: Math.max(0, Math.floor(done)),
                      batchTotal: Math.max(1, Math.floor(total)),
                    }
                  : x,
              ),
            );
          },
          notifyInserted: rows => {
            if (!rows.length) return;
            DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: rows });
          },
          setPreviewUris: uris => {
            const next = uris.map(u => u.trim()).filter(Boolean);
            if (kind === 'photo' && next.length) {
              setFeedBootstrapDisplayUrls(tempId, next);
            }
            setPending(p =>
              p.map(x =>
                x.tempId === tempId ? { ...x, previewUris: next.length ? next : x.previewUris } : x,
              ),
            );
          },
          dismissPending: () => {
            dismissedByHelper = true;
            setPending(p => p.filter(x => x.tempId !== tempId));
          },
        };

        try {
          const inserted = await upload(helpers);
          if (dismissedByHelper) return;
          if (!inserted || inserted.length === 0) {
            setPending(p => {
              const rest = p.filter(x => x.tempId !== tempId);
              return [
                ...rest,
                {
                  tempId,
                  previewUris,
                  kind,
                  status: 'error' as const,
                  errorMessage: "L'envoi n'a pas abouti. Réessaie depuis Importer.",
                },
              ];
            });
            return;
          }
          const first = inserted[0];
          if (first?.id && previewUris.length > 0) {
            if (kind === 'video') {
              setFeedBootstrapVideoUri(first.id, previewUris[0]);
              const poster = peekFeedVideoPosterStableCache(tempId);
              if (poster) setFeedVideoPosterStableCache(first.id, poster);
            } else {
              setFeedBootstrapDisplayUrls(first.id, previewUris);
            }
          }
          const singleRow = inserted.length === 1 && first;
          if (singleRow) {
            setPending(p =>
              p.map(x => (x.tempId === tempId ? { ...x, committedMemory: first } : x)),
            );
          }
          DeviceEventEmitter.emit('petitmo:memories-inserted', {
            memories: inserted,
            pendingTempId: tempId,
            previewUris,
          });
          /** Relancer l’autoplay sur la vidéo importée (sinon reste coupé → pas de play / pas de roue). */
          if (kind === 'video' && first?.id) {
            setFeedAutoplayActiveMemoryId(first.id);
          }
          if (singleRow) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setPending(p => p.filter(x => x.tempId !== tempId));
              });
            });
          } else {
            setPending(p => p.filter(x => x.tempId !== tempId));
          }
        } catch (err) {
          if (err instanceof Error) {
            if (err.message === IMPORT_DUPLICATE_ASSET) {
              setPending(p => p.filter(x => x.tempId !== tempId));
              Alert.alert('Déjà importé', 'Ce souvenir est déjà dans le fil pour cet enfant.');
              return;
            }
            if (
              err.message === 'LIMIT_REACHED' ||
              err.message === 'VIDEO_LIMIT_REACHED' ||
              err.message === 'VOICE_LIMIT_REACHED'
            ) {
              setPending(p => p.filter(x => x.tempId !== tempId));
              InteractionManager.runAfterInteractions(() => {
                promptFreeTierLimitFromError(err.message, {
                  router,
                  replace: true,
                  returnTo: 'fil',
                });
              });
              return;
            }
            if (err.message === 'NO_CHILD') {
              setPending(p => p.filter(x => x.tempId !== tempId));
              InteractionManager.runAfterInteractions(() => {
                Alert.alert('Aucun enfant trouvé', "Crée d'abord un profil d'enfant");
                router.replace('/create-child');
              });
              return;
            }
          }
          setPending(p => {
            const rest = p.filter(x => x.tempId !== tempId);
            return [
              ...rest,
              {
                tempId,
                previewUris,
                kind,
                status: 'error' as const,
                errorMessage: "L'envoi n'a pas abouti.",
              },
            ];
          });
        }
      })();
    },
    [router],
  );

  const value = useMemo(
    () => ({ pending, startBackgroundUploadNavigateToFeed }),
    [pending, startBackgroundUploadNavigateToFeed],
  );

  return (
    <PendingMediaUploadsContext.Provider value={value}>{children}</PendingMediaUploadsContext.Provider>
  );
}

export function usePendingMediaUploads(): PendingMediaUploadsValue {
  const ctx = useContext(PendingMediaUploadsContext);
  if (!ctx) {
    throw new Error('usePendingMediaUploads doit être utilisé sous PendingMediaUploadsProvider');
  }
  return ctx;
}

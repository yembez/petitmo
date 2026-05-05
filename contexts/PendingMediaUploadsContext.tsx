import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { useRouter } from 'expo-router';
import type { MemoryRow } from '@/services/media';
import { setFeedBootstrapDisplayUrls, setFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import { armSilentInitialFilLoadAfterMediaImport } from '@/services/feedAfterImportFlags';
import { IMPORT_DUPLICATE_ASSET } from '@/lib/importDuplicate';

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
  errorMessage?: string;
  /**
   * Import réussi (1 souvenir) : la ligne « envoi » affiche déjà `FilMemoryRow` avec ce souvenir
   * avant retrait du pending → même slot / même clé FlatList, moins de flash image.
   */
  committedMemory?: MemoryRow;
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
    upload: () => Promise<MemoryRow[] | null>;
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
      upload,
    }: {
      previewUris: string[];
      kind?: PendingMediaKind;
      capturedAtPreviewIso?: string | null;
      locationPreview?: string | null;
      upload: () => Promise<MemoryRow[] | null>;
    }) => {
      armSilentInitialFilLoadAfterMediaImport();
      const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      /** Dès la carte « envoi » : mêmes URI que `FilMemoryRow` optimiste → pas d’attente du serveur pour le 1er pixel. */
      if (kind === 'video' && previewUris[0]?.trim()) {
        setFeedBootstrapVideoUri(tempId, previewUris[0]);
      } else if (kind === 'photo' && previewUris.some(u => u?.trim())) {
        setFeedBootstrapDisplayUrls(tempId, previewUris.filter(u => u?.trim()));
      }
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
        },
      ]);
      router.replace('/(tabs)/fil');

      void (async () => {
        try {
          console.log('[pending] avant upload()', { tempId });
          const inserted = await upload();
          console.log('[pending] après upload()', { inserted });
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
          /** Mêmes URI que la carte « envoi » → pas de changement de `source` Image au swap pending → souvenir. */
          const first = inserted[0];
          if (first?.id && previewUris.length > 0) {
            if (kind === 'video') {
              setFeedBootstrapVideoUri(first.id, previewUris[0]);
            } else {
              setFeedBootstrapDisplayUrls(first.id, previewUris);
            }
          }
          const singleRow = inserted.length === 1 && first;
          if (singleRow) {
            setPending(p =>
              p.map(x =>
                x.tempId === tempId ? { ...x, committedMemory: first } : x
              )
            );
          }
          DeviceEventEmitter.emit('petitmo:memories-inserted', {
            memories: inserted,
            /** Même clé que la ligne « envoi » dans le FlatList → pas de recycle de cellule. */
            pendingTempId: tempId,
            previewUris,
            /** Plusieurs posts d’un coup : garder l’ordre de la sélection (évite un tri par date identique). */
            preserveInsertionOrder: inserted.length > 1,
          });
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
              Alert.alert(
                'Déjà importé',
                'Ce souvenir est déjà dans le fil pour cet enfant.'
              );
              return;
            }
            if (err.message === 'LIMIT_REACHED') {
              router.push({
                pathname: '/paywall',
                params: { context: 'LIMIT_REACHED' },
              });
              // Nettoyer l'upload en cours : retirer la carte « envoi » du pending
              setPending(p => p.filter(x => x.tempId !== tempId));
              return;
            }
            if (err.message === 'VIDEO_LIMIT_REACHED') {
              router.push({
                pathname: '/paywall',
                params: { context: 'VIDEO_LIMIT_REACHED' },
              });
              setPending(p => p.filter(x => x.tempId !== tempId));
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
    [router]
  );

  const value = useMemo(
    () => ({ pending, startBackgroundUploadNavigateToFeed }),
    [pending, startBackgroundUploadNavigateToFeed]
  );

  return <PendingMediaUploadsContext.Provider value={value}>{children}</PendingMediaUploadsContext.Provider>;
}

export function usePendingMediaUploads(): PendingMediaUploadsValue {
  const ctx = useContext(PendingMediaUploadsContext);
  if (!ctx) {
    throw new Error('usePendingMediaUploads doit être utilisé sous PendingMediaUploadsProvider');
  }
  return ctx;
}

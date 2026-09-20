import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { Swipeable } from 'react-native-gesture-handler';
import type { PendingUpload } from '@/contexts/PendingMediaUploadsContext';
import {
  buildOptimisticMemoryForPending,
  canRenderOptimisticPendingRow,
  type Child,
  type Memory,
} from '@/utils/feedHelpers';
import type { ImmersiveLaunchArgs } from '@/utils/immersiveSharedElement';
import {
  FilMemoryRowMemo,
  PendingFeedUploadCard,
  BatchFeedSlotCard,
  type FeedListItem,
} from '@/components/feed/FilMemoryRow';
import { useAppTranslation } from '@/hooks/useAppTranslation';

function pendingPrepLabelFor(
  p: PendingUpload,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const total = p.batchTotal ?? 0;
  if (total > 1) {
    const done = Math.min(Math.max(0, p.batchDone ?? 0), total);
    return t('mediaPrep.addingPhotos', { done, total });
  }
  return t('mediaPrep.addingPhoto');
}

/** Emplacements encore à peindre : total − déjà faits − la carte `pending` (1ʳᵉ / en cours). */
function batchSlotCount(p: PendingUpload): number {
  const total = p.batchTotal ?? 0;
  if (total <= 1 || p.status === 'error') return 0;
  const done = Math.min(Math.max(0, p.batchDone ?? 0), total);
  return Math.max(0, total - done - 1);
}

export function useFilFeedList(
  memories: Memory[],
  setMemories: Dispatch<SetStateAction<Memory[]>>,
  child: Child | null,
  familyChildren: Child[],
  feedDateFontFamily: string | undefined,
  feedAgeFontFamily: string | undefined,
  feedLocationFilledFontFamily: string | undefined,
  feedLocationPlaceholderFontFamily: string | undefined,
  pendingUploads: PendingUpload[],
  uploadingVoiceCoverId: string | null,
  toggleFavorite: (id: string) => void | Promise<void>,
  handleEditMemory: (m: Memory) => void,
  handleEditLocation: (m: Memory) => void,
  handlePickVoiceCover: (m: Memory) => void | Promise<void>,
  handleDeleteMemory: (m: Memory) => void,
  swipeRefs: MutableRefObject<Map<string, Swipeable | null>>,
  immersiveLaunchRef: RefObject<(args: ImmersiveLaunchArgs) => void>,
): {
  feedData: FeedListItem[];
  renderItem: (info: { item: FeedListItem }) => ReactElement;
} {
  const { t } = useAppTranslation('common');

  const memoryIndexById = useMemo(() => {
    const m = new Map<string, number>();
    memories.forEach((mem, idx) => m.set(mem.id, idx));
    return m;
  }, [memories]);

  const feedData = useMemo((): FeedListItem[] => {
    const bridgedMemoryIds = new Set(
      pendingUploads.map(p => p.committedMemory?.id).filter((id): id is string => !!id?.trim())
    );

    type Ranked = { t: number; ins: number; item: FeedListItem };
    const ranked: Ranked[] = [];

    for (const row of pendingUploads) {
      const iso =
        row.committedMemory?.created_at?.trim() ||
        row.capturedAtPreviewIso?.trim() ||
        new Date().toISOString();
      const insIso =
        row.committedMemory?.inserted_at?.trim() ||
        // Pending en cours : tie-break récent pour ne pas remonter au-dessus d’un jumeau date.
        new Date().toISOString();
      const tMs = new Date(iso).getTime();
      const insMs = new Date(insIso).getTime();
      ranked.push({
        t: tMs,
        ins: insMs,
        item: { rowKind: 'pending', row },
      });
      const slots = batchSlotCount(row);
      for (let i = 0; i < slots; i++) {
        ranked.push({
          t: tMs,
          // Légèrement plus « vieux » que le pending pour rester juste en dessous.
          ins: insMs - (i + 1),
          item: { rowKind: 'batchSlot', parentTempId: row.tempId, slotIndex: i },
        });
      }
    }

    for (const memory of memories) {
      if (bridgedMemoryIds.has(memory.id)) continue;
      ranked.push({
        t: new Date(memory.created_at).getTime(),
        ins: new Date(memory.inserted_at ?? memory.created_at).getTime(),
        item: { rowKind: 'memory', memory },
      });
    }

    ranked.sort((a, b) => {
      if (b.t !== a.t) return b.t - a.t;
      return b.ins - a.ins;
    });
    return ranked.map(r => r.item);
  }, [pendingUploads, memories]);

  const renderMemory = useCallback(
    (
      memory: Memory,
      memoryIndex: number,
      opts?: { isOptimisticFeedPending?: boolean; pendingPrepLabel?: string }
    ) => (
      <FilMemoryRowMemo
        memory={memory}
        memoryIndex={memoryIndex}
        child={child}
        familyChildren={familyChildren}
        feedDateFontFamily={feedDateFontFamily}
        feedAgeFontFamily={feedAgeFontFamily}
        feedLocationFilledFontFamily={feedLocationFilledFontFamily}
        feedLocationPlaceholderFontFamily={feedLocationPlaceholderFontFamily}
        uploadingVoiceCoverId={uploadingVoiceCoverId}
        setMemories={setMemories}
        toggleFavorite={toggleFavorite}
        handleEditMemory={handleEditMemory}
        handleEditLocation={handleEditLocation}
        handlePickVoiceCover={handlePickVoiceCover}
        handleDeleteMemory={handleDeleteMemory}
        swipeRefs={swipeRefs}
        immersiveLaunchRef={immersiveLaunchRef}
        isOptimisticFeedPending={opts?.isOptimisticFeedPending === true}
        pendingPrepLabel={opts?.pendingPrepLabel}
      />
    ),
    [
      child,
      familyChildren,
      feedDateFontFamily,
      feedAgeFontFamily,
      feedLocationFilledFontFamily,
      feedLocationPlaceholderFontFamily,
      uploadingVoiceCoverId,
      setMemories,
      toggleFavorite,
      handleEditMemory,
      handleEditLocation,
      handlePickVoiceCover,
      handleDeleteMemory,
      swipeRefs,
      immersiveLaunchRef,
    ]
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedListItem }) => {
      if (item.rowKind === 'batchSlot') {
        return <BatchFeedSlotCard label={t('mediaPrep.addingPhoto')} />;
      }
      if (item.rowKind === 'pending') {
        const committed = item.row.committedMemory;
        const prepLabel = pendingPrepLabelFor(item.row, t);
        if (committed) {
          const memoryIndex = memoryIndexById.get(committed.id) ?? 0;
          /** Toujours « prep upload » : la roue reste jusqu’au retrait du pending. */
          return renderMemory(committed, memoryIndex, {
            isOptimisticFeedPending: true,
            pendingPrepLabel: prepLabel,
          });
        }
        if (item.row.status === 'error') {
          return (
            <PendingFeedUploadCard
              p={item.row}
              feedLocationFilledFontFamily={feedLocationFilledFontFamily}
            />
          );
        }
        if (canRenderOptimisticPendingRow(item.row)) {
          const optimistic = buildOptimisticMemoryForPending(item.row, child);
          return renderMemory(optimistic, 0, {
            isOptimisticFeedPending: true,
            pendingPrepLabel: prepLabel,
          });
        }
        return (
          <PendingFeedUploadCard
            p={item.row}
            feedLocationFilledFontFamily={feedLocationFilledFontFamily}
          />
        );
      }
      const memoryIndex = memoryIndexById.get(item.memory.id) ?? 0;
      return renderMemory(item.memory, memoryIndex);
    },
    [memoryIndexById, child, renderMemory, feedLocationFilledFontFamily, t]
  );

  return { feedData, renderItem };
}

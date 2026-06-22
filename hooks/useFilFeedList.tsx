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
import {
  FilMemoryRowMemo,
  PendingFeedUploadCard,
  type FeedListItem,
} from '@/components/feed/FilMemoryRow';

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
  immersiveLaunchRef: RefObject<(memoryId: string, albumPhotoIndex?: number) => void>,
): {
  feedData: FeedListItem[];
  renderItem: (info: { item: FeedListItem }) => ReactElement;
} {
  const memoryIndexById = useMemo(() => {
    const m = new Map<string, number>();
    memories.forEach((mem, idx) => m.set(mem.id, idx));
    return m;
  }, [memories]);

  const feedData = useMemo((): FeedListItem[] => {
    const bridgedMemoryIds = new Set(
      pendingUploads.map(p => p.committedMemory?.id).filter((id): id is string => !!id?.trim())
    );
    const pend: FeedListItem[] = pendingUploads.map(row => ({ rowKind: 'pending', row }));
    const mem: FeedListItem[] = memories
      .filter(m => !bridgedMemoryIds.has(m.id))
      .map(memory => ({ rowKind: 'memory', memory }));
    return [...pend, ...mem];
  }, [pendingUploads, memories]);

  const renderMemory = useCallback(
    (
      memory: Memory,
      memoryIndex: number,
      opts?: { isOptimisticFeedPending?: boolean }
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
      if (item.rowKind === 'pending') {
        const committed = item.row.committedMemory;
        if (committed) {
          const memoryIndex = memoryIndexById.get(committed.id) ?? 0;
          return renderMemory(committed, memoryIndex);
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
    [memoryIndexById, child, renderMemory, feedLocationFilledFontFamily]
  );

  return { feedData, renderItem };
}

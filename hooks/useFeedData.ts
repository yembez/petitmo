import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setStatusBarStyle } from 'expo-status-bar';
import {
  getMemories,
  fetchMemoriesByIds,
  requestMissingMediaDerivatives,
} from '@/services/media';
import {
  getChildren,
  getOrSelectFirstChild,
  setSelectedChild,
  sanitizeChildLocalAvatarIfMissing,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
} from '@/services/children';
import { listBooks, type Book } from '@/services/books';
import type { PendingUpload } from '@/contexts/PendingMediaUploadsContext';
import {
  consumeSilentInitialFilLoadAfterMediaImport,
  peekSilentInitialFilLoadArmed,
} from '@/services/feedAfterImportFlags';
import {
  feedBooksHydrationSnapshot,
  feedChildHydrationSnapshot,
  feedMemoriesHydrationSnapshot,
  setFeedHydrationSnapshots,
} from '@/services/tabScreensCache';
import {
  mergeMemoriesListPreservingVisualRowRefs,
  memoryWaitingForFeedDerivatives,
  type Memory,
  type Child,
} from '@/utils/feedHelpers';

export type UseFeedDataResult = {
  memories: Memory[];
  setMemories: Dispatch<SetStateAction<Memory[]>>;
  child: Child | null;
  books: Book[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  memoryFlatListKeyByIdRef: MutableRefObject<Map<string, string>>;
};

export function useFeedData(pendingUploads: PendingUpload[]): UseFeedDataResult {
  const [memories, setMemories] = useState<Memory[]>(() => [...feedMemoriesHydrationSnapshot]);
  const memoriesRef = useRef<Memory[]>([]);
  memoriesRef.current = memories;

  const [child, setChild] = useState<Child | null>(() => feedChildHydrationSnapshot);
  const [books, setBooks] = useState<Book[]>(() => [...feedBooksHydrationSnapshot]);
  const childRef = useRef<Child | null>(child);
  childRef.current = child;
  const pendingLenRef = useRef(0);
  pendingLenRef.current = pendingUploads.length;

  useEffect(() => {
    setFeedHydrationSnapshots(child, memories, books);
  }, [child, memories, books]);

  const [isLoading, setIsLoading] = useState(() => {
    if (pendingUploads.length > 0) return false;
    if (feedChildHydrationSnapshot != null) return false;
    if (peekSilentInitialFilLoadArmed()) return false;
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const autoRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryFlatListKeyByIdRef = useRef<Map<string, string>>(new Map());
  const loadDataSeqRef = useRef(0);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const seq = ++loadDataSeqRef.current;
    try {
      if (!silent) {
        setIsLoading(true);
      }

      const selectedChildId = await getOrSelectFirstChild();
      if (seq !== loadDataSeqRef.current) return;

      if (!selectedChildId) {
        setChild(null);
        setMemories([]);
        setBooks([]);
        return;
      }

      /**
       * Pendant un import (`pending` non vide), l’enfant affiché ne change pas : inutile de rappeler
       * `getChildren` + `setChild` (nouvelle référence) → évite flash header / saut layout.
       * Pull-to-refresh ou `silent` sans pending continue à recharger le profil.
       */
      const skipChildRefetch =
        silent &&
        pendingLenRef.current > 0 &&
        childRef.current !== null &&
        childRef.current.id === selectedChildId;

      let activeChild: Child | null = null;

      if (skipChildRefetch) {
        activeChild = childRef.current;
      } else {
        const children = await getChildren();
        if (seq !== loadDataSeqRef.current) return;

        activeChild = children.find(c => c.id === selectedChildId) ?? null;
        if (!activeChild && children.length > 0) {
          const first = children[0];
          activeChild = first;
          await setSelectedChild(first.id);
        }

        if (!activeChild) {
          setChild(null);
          setMemories([]);
          setBooks([]);
          return;
        }

        setChild(activeChild);
      }

      if (activeChild === null) {
        setChild(null);
        setMemories([]);
        setBooks([]);
        return;
      }

      const [memoriesData, loadedBooks] = await Promise.all([
        getMemories(activeChild.id),
        listBooks(),
      ]);
      if (seq !== loadDataSeqRef.current) return;
      setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, memoriesData));
      setBooks(loadedBooks);
      void requestMissingMediaDerivatives(memoriesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      if (seq === loadDataSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const silentFromImport = consumeSilentInitialFilLoadAfterMediaImport();
    const silent =
      pendingUploads.length > 0 || feedChildHydrationSnapshot != null || silentFromImport;
    void loadData({ silent });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1er montage : silent si pending, réhydratation fil, ou retour import
  }, [loadData]);

  useEffect(() => {
    const subInvalidate = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void loadData({ silent: true });
    });
    const subUpdated = DeviceEventEmitter.addListener('petitmo:memories-updated', () => {
      void loadData({ silent: true });
    });
    const subChildProfile = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: { childId: string }) => {
        void (async () => {
          const id = payload?.childId?.trim();
          if (!id || childRef.current?.id !== id) return;
          try {
            const all = await getChildren();
            const row = all.find(c => c.id === id);
            if (!row) return;
            const cleaned = await sanitizeChildLocalAvatarIfMissing(row);
            setChild(cleaned);
          } catch (e) {
            console.error('Fil: refresh profil enfant', e);
          }
        })();
      }
    );
    const subInserted = DeviceEventEmitter.addListener(
      'petitmo:memories-inserted',
      (payload: unknown) => {
        let rows: Memory[];
        let pendingTempId: string | undefined;
        let preserveInsertionOrder = false;
        if (Array.isArray(payload)) {
          rows = payload as Memory[];
        } else if (
          payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { memories?: unknown }).memories)
        ) {
          const p = payload as {
            memories: Memory[];
            pendingTempId?: string;
            preserveInsertionOrder?: boolean;
          };
          rows = p.memories;
          pendingTempId = p.pendingTempId;
          preserveInsertionOrder = p.preserveInsertionOrder === true;
        } else {
          return;
        }
        if (rows.length === 0) return;
        const ordered = preserveInsertionOrder
          ? [...rows]
          : [...rows].sort((a, b) => {
              const ta = new Date(a.inserted_at ?? a.created_at).getTime();
              const tb = new Date(b.inserted_at ?? b.created_at).getTime();
              return tb - ta;
            });
        if (pendingTempId && ordered.length === 1) {
          memoryFlatListKeyByIdRef.current.set(ordered[0].id, pendingTempId);
        }
        setMemories(prev => {
          const idSet = new Set(ordered.map(r => r.id));
          return [...ordered, ...prev.filter(m => !idSet.has(m.id))];
        });
        void requestMissingMediaDerivatives(ordered);
      }
    );
    return () => {
      subInvalidate.remove();
      subUpdated.remove();
      subChildProfile.remove();
      subInserted.remove();
    };
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('dark');
    }, [])
  );

  const stuckDerivativeIdsKey = useMemo(() => {
    const ids = memories.filter(memoryWaitingForFeedDerivatives).map(m => m.id);
    ids.sort();
    return ids.join('|');
  }, [memories]);

  useEffect(() => {
    if (autoRefreshTimer.current) {
      clearTimeout(autoRefreshTimer.current);
      autoRefreshTimer.current = null;
    }

    if (!stuckDerivativeIdsKey || isLoading || isRefreshing) {
      return;
    }

    let cancelled = false;
    let tries = 0;
    let debounceScheduleId: ReturnType<typeof setTimeout> | null = null;

    const runPoll = async () => {
      if (cancelled) return;
      const list = memoriesRef.current;
      const ids = list.filter(memoryWaitingForFeedDerivatives).map(m => m.id);
      if (ids.length === 0) return;
      if (tries >= 6) return;

      tries += 1;
      const fresh = await fetchMemoriesByIds(ids);
      if (cancelled || fresh.length === 0) return;

      setMemories(prev => {
        const next = prev.map(m => {
          const u = fresh.find(f => f.id === m.id);
          if (!u) return m;
          const sameDisplay =
            (m.thumb_url ?? '') === (u.thumb_url ?? '') &&
            (m.display_url ?? '') === (u.display_url ?? '') &&
            (m.poster_url ?? '') === (u.poster_url ?? '') &&
            (m.thumbnail_url ?? '') === (u.thumbnail_url ?? '') &&
            JSON.stringify(m.extra_thumb_urls ?? []) === JSON.stringify(u.extra_thumb_urls ?? []) &&
            JSON.stringify(m.extra_display_urls ?? []) === JSON.stringify(u.extra_display_urls ?? []);
          return sameDisplay ? m : u;
        });
        const changed = next.some((m, i) => m !== prev[i]);
        return changed ? next : prev;
      });
      void requestMissingMediaDerivatives(fresh);

      if (cancelled || tries >= 6) return;
      debounceScheduleId = setTimeout(() => {
        debounceScheduleId = null;
        if (cancelled || tries >= 6) return;
        const listAfter = memoriesRef.current;
        if (!listAfter.some(memoryWaitingForFeedDerivatives)) return;
        const delayMs = tries <= 2 ? 1100 : 2000;
        autoRefreshTimer.current = setTimeout(() => {
          void runPoll();
        }, delayMs);
      }, 0);
    };

    autoRefreshTimer.current = setTimeout(() => {
      void runPoll();
    }, 1100);

    return () => {
      cancelled = true;
      if (debounceScheduleId) {
        clearTimeout(debounceScheduleId);
        debounceScheduleId = null;
      }
      if (autoRefreshTimer.current) {
        clearTimeout(autoRefreshTimer.current);
        autoRefreshTimer.current = null;
      }
    };
  }, [stuckDerivativeIdsKey, isLoading, isRefreshing]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadData({ silent: true });
    setIsRefreshing(false);
  }, [loadData]);

  return {
    memories,
    setMemories,
    child,
    books,
    isLoading,
    isRefreshing,
    onRefresh,
    memoryFlatListKeyByIdRef,
  };
}

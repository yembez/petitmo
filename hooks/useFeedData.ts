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
import { DeviceEventEmitter, InteractionManager } from 'react-native';
import {
  getLocalMemoryById,
  getLocalChild,
  listLocalChildren,
  getAllLocalMemories,
} from '@/lib/localDb';
import { useFocusEffect } from '@react-navigation/native';
import { setStatusBarStyle } from 'expo-status-bar';
import {
  getFamilyMemories,
  fetchMemoriesByIds,
  requestMissingMediaDerivatives,
} from '@/services/media';
import { pullFamilyMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync';
import { materializeCloudMediaForMemories } from '@/services/memoryCloudMaterialize';
import { scheduleAfterOtaWindow } from '@/services/scheduleAfterOtaWindow';
import { primeFeedVideoPosterStableCache } from '@/services/feedVideoPosterPrime';
import {
  getChildren,
  getOrSelectFirstChild,
  setSelectedChild,
  ensureChildFaceBounds,
  refreshChildProfileFromLocal,
  refreshChildrenFromCloudInBackground,
  childNeedsFaceBoundsBackfill,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
  type ChildProfileUpdatedPayload,
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
  filMemoryVisualEqual,
  mergeMemoriesListPreservingVisualRowRefs,
  memoryWaitingForFeedDerivatives,
  type Memory,
  type Child,
} from '@/utils/feedHelpers';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';

function readFamilyChildrenFromLocal(): Child[] {
  return sortChildrenByBirthdateAsc(listLocalChildren());
}

export type UseFeedDataResult = {
  memories: Memory[];
  setMemories: Dispatch<SetStateAction<Memory[]>>;
  child: Child | null;
  /** Tous les enfants famille (SQLite local) — âges sur les cartes souvenir. */
  familyChildren: Child[];
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
  const [familyChildren, setFamilyChildren] = useState<Child[]>(() => readFamilyChildrenFromLocal());
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
    // SQLite déjà rempli → pas de spinner plein écran en attendant le 1er load async.
    if (getAllLocalMemories().length > 0) return false;
    if (listLocalChildren().length > 0) return false;
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const autoRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryFlatListKeyByIdRef = useRef<Map<string, string>>(new Map());
  const loadDataSeqRef = useRef(0);
  const silentReloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMemoryPatchRef = useRef<Map<string, Memory>>(new Map());
  const flushMemoryPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const seq = ++loadDataSeqRef.current;
    try {
      /**
       * Local-first : peindre SQLite **avant** tout réseau.
       * Sinon le 1er ouverture du fil après reconnexion attend le pull cloud → roue longue.
       */
      setFamilyChildren(readFamilyChildrenFromLocal());
      const localMemoriesNow = getAllLocalMemories();
      if (localMemoriesNow.length > 0) {
        setMemories(prev =>
          mergeMemoriesListPreservingVisualRowRefs(prev, localMemoriesNow as Memory[]),
        );
        if (!silent) {
          setIsLoading(false);
        }
      } else if (!silent) {
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
       * Resync silencieux : ne pas rappeler `getChildren` si l’enfant affiché est déjà le bon
       * (évite latence après long séjour sur un autre onglet).
       */
      const skipChildRefetch =
        silent &&
        childRef.current !== null &&
        childRef.current.id === selectedChildId &&
        !childNeedsFaceBoundsBackfill(childRef.current);

      let activeChild: Child | null = null;

      if (skipChildRefetch) {
        activeChild = childRef.current;
      } else {
        /**
         * Local-first : peindre l’enfant depuis SQLite.
         * `await getChildren()` seulement si le local est vide (cold / autre appareil).
         */
        const localChildren = readFamilyChildrenFromLocal();
        activeChild =
          localChildren.find(c => c.id === selectedChildId) ?? localChildren[0] ?? null;

        if (activeChild) {
          if (activeChild.id !== selectedChildId) {
            await setSelectedChild(activeChild.id);
          }
          const cleaned = await ensureChildFaceBounds(activeChild);
          if (seq !== loadDataSeqRef.current) return;
          setChild(cleaned);
          activeChild = cleaned;
          refreshChildrenFromCloudInBackground();
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

          const cleaned = await ensureChildFaceBounds(activeChild);
          if (seq !== loadDataSeqRef.current) return;
          setChild(cleaned);
          activeChild = cleaned;
        }
      }

      if (activeChild && childNeedsFaceBoundsBackfill(activeChild)) {
        const cleaned = await ensureChildFaceBounds(activeChild);
        if (seq !== loadDataSeqRef.current) return;
        setChild(cleaned);
        activeChild = cleaned;
      }

      if (activeChild === null) {
        setChild(null);
        setMemories([]);
        setBooks([]);
        return;
      }

      const hadLocalPaint = localMemoriesNow.length > 0;
      const [memoriesData, loadedBooks] = await Promise.all([
        getFamilyMemories({ waitForRemote: !hadLocalPaint }),
        listBooks(),
      ]);
      if (seq !== loadDataSeqRef.current) return;
      setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, memoriesData));
      setBooks(loadedBooks);
      void primeFeedVideoPosterStableCache(memoriesData);
      if (!silent) {
        setIsLoading(false);
      }

      // Sync cloud en fond si on a déjà peint le local (évite de bloquer la roue).
      if (hadLocalPaint) {
        void (async () => {
          try {
            await pullFamilyMemoriesFromRemoteToLocal();
          } catch {
            /* hors ligne */
          }
          if (seq !== loadDataSeqRef.current) return;
          const fresh = getAllLocalMemories() as Memory[];
          setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, fresh));
          void primeFeedVideoPosterStableCache(fresh);
          InteractionManager.runAfterInteractions(() => {
            scheduleAfterOtaWindow(() => {
              void materializeCloudMediaForMemories(fresh, { max: 16, batchSize: 2 });
              void requestMissingMediaDerivatives(fresh);
            });
          });
        })();
      } else {
        InteractionManager.runAfterInteractions(() => {
          scheduleAfterOtaWindow(() => {
            void materializeCloudMediaForMemories(memoriesData, { max: 16, batchSize: 2 });
            void requestMissingMediaDerivatives(memoriesData);
          });
        });
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      if (seq === loadDataSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const scheduleSilentReload = useCallback(() => {
    if (silentReloadDebounceRef.current) {
      clearTimeout(silentReloadDebounceRef.current);
    }
    silentReloadDebounceRef.current = setTimeout(() => {
      silentReloadDebounceRef.current = null;
      void loadData({ silent: true });
    }, 500);
  }, [loadData]);

  useEffect(() => {
    const silentFromImport = consumeSilentInitialFilLoadAfterMediaImport();
    const hasHydration = feedChildHydrationSnapshot != null;
    const silent =
      pendingUploads.length > 0 || hasHydration || silentFromImport;
    const run = () => {
      void loadData({ silent });
    };

    if (hasHydration && feedMemoriesHydrationSnapshot.length > 0) {
      const task = InteractionManager.runAfterInteractions(run);
      return () => task.cancel();
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1er montage : silent si pending, réhydratation fil, ou retour import
  }, [loadData]);

  useEffect(() => {
    const subInvalidate = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void loadData({ silent: true });
    });
    const subUpdated = DeviceEventEmitter.addListener('petitmo:memories-updated', (payload: unknown) => {
      const memoryId =
        payload &&
        typeof payload === 'object' &&
        payload !== null &&
        'memoryId' in payload &&
        typeof (payload as { memoryId?: unknown }).memoryId === 'string'
          ? (payload as { memoryId: string }).memoryId.trim()
          : '';
      if (memoryId) {
        const row = getLocalMemoryById(memoryId);
        if (row) {
          pendingMemoryPatchRef.current.set(memoryId, row);
          if (flushMemoryPatchTimerRef.current) {
            clearTimeout(flushMemoryPatchTimerRef.current);
          }
          flushMemoryPatchTimerRef.current = setTimeout(() => {
            flushMemoryPatchTimerRef.current = null;
            const batch = new Map(pendingMemoryPatchRef.current);
            pendingMemoryPatchRef.current.clear();
            // Patch ciblé : on remplace uniquement les lignes concernées, sans re-tri ni
            // `JSON.stringify` de toute la liste (materialisation en rafale = sinon grosses saccades).
            setMemories(prev => {
              let changed = false;
              const next = prev.map(m => {
                const patched = batch.get(m.id);
                if (!patched || patched === m) return m;
                // Sync cloud : upsert SQLite OK, mais pas de re-render si l’affichage local est identique.
                if (filMemoryVisualEqual(m, patched)) return m;
                changed = true;
                return patched;
              });
              return changed ? next : prev;
            });
          }, 450);
          return;
        }
      }
      scheduleSilentReload();
    });
    const subChildProfile = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: ChildProfileUpdatedPayload) => {
        void (async () => {
          setFamilyChildren(readFamilyChildrenFromLocal());
          const id = payload?.childId?.trim();
          if (!id) {
            scheduleSilentReload();
            return;
          }
          try {
            const selectedId = childRef.current?.id;
            const fromLocal =
              (selectedId ? getLocalChild(selectedId) : null) ??
              getLocalChild(id) ??
              readFamilyChildrenFromLocal()[0] ??
              null;
            if (fromLocal) {
              const cleaned =
                fromLocal.id === id
                  ? (await refreshChildProfileFromLocal(id)) ??
                    (await ensureChildFaceBounds(
                      payload.child?.id === id ? payload.child : fromLocal,
                    ))
                  : await ensureChildFaceBounds(fromLocal);
              setChild(cleaned);
            } else {
              setChild(null);
            }
            refreshChildrenFromCloudInBackground();
            if (id !== selectedId) {
              scheduleSilentReload();
            }
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
          };
          rows = p.memories;
          pendingTempId = p.pendingTempId;
        } else {
          return;
        }
        if (rows.length === 0) return;
        // Toujours trier la vague par date d’événement — jamais l’ordre d’import.
        const ordered = [...rows].sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          if (tb !== ta) return tb - ta;
          const ia = new Date(a.inserted_at ?? a.created_at).getTime();
          const ib = new Date(b.inserted_at ?? b.created_at).getTime();
          return ib - ia;
        });
        if (pendingTempId && ordered.length === 1) {
          memoryFlatListKeyByIdRef.current.set(ordered[0].id, pendingTempId);
        }
        // Fusion + tri chronologique du fil entier (created_at) — ne pas prepend-only
        // sinon une photo ancienne importée après remonte au-dessus d’une plus récente.
        setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, ordered));
        void materializeCloudMediaForMemories(ordered, { max: 16, batchSize: 4 });
        void requestMissingMediaDerivatives(ordered);
      }
    );
    return () => {
      subInvalidate.remove();
      subUpdated.remove();
      subChildProfile.remove();
      subInserted.remove();
      if (silentReloadDebounceRef.current) {
        clearTimeout(silentReloadDebounceRef.current);
        silentReloadDebounceRef.current = null;
      }
      if (flushMemoryPatchTimerRef.current) {
        clearTimeout(flushMemoryPatchTimerRef.current);
        flushMemoryPatchTimerRef.current = null;
      }
      pendingMemoryPatchRef.current.clear();
    };
  }, [loadData, scheduleSilentReload]);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('dark');
      setFamilyChildren(readFamilyChildrenFromLocal());
      const childId = childRef.current?.id;
      if (childId) {
        void refreshChildProfileFromLocal(childId).then(refreshed => {
          if (refreshed && childRef.current?.id === refreshed.id) {
            setChild(refreshed);
          }
        });
      }
      /** Onglet remonté après longue absence : resync légère seulement si le fil est vide. */
      if (memoriesRef.current.length === 0 && feedMemoriesHydrationSnapshot.length > 0) {
        setMemories([...feedMemoriesHydrationSnapshot]);
        void primeFeedVideoPosterStableCache(feedMemoriesHydrationSnapshot);
        if (feedChildHydrationSnapshot) {
          void ensureChildFaceBounds(feedChildHydrationSnapshot).then(refreshed => {
            setChild(refreshed);
          });
        }
        setBooks([...feedBooksHydrationSnapshot]);
        setIsLoading(false);
      } else if (memoriesRef.current.length > 0) {
        // Réaligner l’ordre sur created_at (guérit un fil faussé par d’anciens prepends).
        const local = getAllLocalMemories() as Memory[];
        if (local.length > 0) {
          setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, local));
        }
      }
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

      setMemories(prev => mergeMemoriesListPreservingVisualRowRefs(prev, prev.map(m => {
          const u = fresh.find(f => f.id === m.id);
          return u ?? m;
        })));
      void materializeCloudMediaForMemories(fresh, { max: 16, batchSize: 4 });
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
    familyChildren,
    books,
    isLoading,
    isRefreshing,
    onRefresh,
    memoryFlatListKeyByIdRef,
  };
}

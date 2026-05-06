import { getLocalMemories, listLocalChildren } from '@/lib/localDb';
import {
  getOrSelectFirstChild,
  getChildren,
  peekSelectedChildIdLastKnown,
  setCaptureTabChildSnapshot,
} from '@/services/children';
import { getMemories } from '@/services/media';
import { listBooks, listBooksFromSqliteSync } from '@/services/books';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';

/**
 * Remplit le cache onglets **uniquement depuis SQLite**, sans auth ni réseau.
 * - Si l’ID sélectionné n’est pas encore lu depuis AsyncStorage, on prend le **premier** enfant local (ordre `created_at`).
 * - À enchaîner après `warmSelectedChildIdFromStorage()` pour cibler le bon profil dès que possible.
 */
export function hydrateTabScreensFromSqliteSync(): boolean {
  try {
    const localChildren = listLocalChildren();
    if (!localChildren.length) {
      setFeedHydrationSnapshots(null, [], []);
      setCaptureTabChildSnapshot(null);
      return false;
    }

    const stored = peekSelectedChildIdLastKnown();
    const activeChild =
      stored && localChildren.some(c => c.id === stored)
        ? localChildren.find(c => c.id === stored)!
        : localChildren[0];

    const memories = getLocalMemories(activeChild.id);
    const books = listBooksFromSqliteSync();
    setFeedHydrationSnapshots(activeChild, memories, books);
    setCaptureTabChildSnapshot(activeChild);
    return true;
  } catch (e) {
    console.warn('[hydrateTabScreensFromSqliteSync]', e);
    return false;
  }
}

let fullHydrateInFlight: Promise<void> | null = null;

/**
 * Hydratation « complète » : `getChildren` / `getMemories` (sync cloud en arrière-plan si besoin) + livres.
 * Appels concurrents partagent la même promesse.
 */
export function hydrateTabScreensFromLocal(): Promise<void> {
  if (fullHydrateInFlight) return fullHydrateInFlight;

  const p = (async (): Promise<void> => {
    try {
      const childId = await getOrSelectFirstChild();
      if (!childId) {
        setFeedHydrationSnapshots(null, [], []);
        setCaptureTabChildSnapshot(null);
        return;
      }

      const children = await getChildren();
      const activeChild = children.find(c => c.id === childId) ?? children[0] ?? null;

      if (!activeChild) {
        setFeedHydrationSnapshots(null, [], []);
        setCaptureTabChildSnapshot(null);
        return;
      }

      const [memories, books] = await Promise.all([
        getMemories(activeChild.id),
        listBooks(),
      ]);

      setFeedHydrationSnapshots(activeChild, memories, books);
      setCaptureTabChildSnapshot(activeChild);
    } catch (e) {
      console.warn('[hydrateTabScreensFromLocal]', e);
      hydrateTabScreensFromSqliteSync();
    }
  })();

  fullHydrateInFlight = p;
  void p.finally(() => {
    if (fullHydrateInFlight === p) fullHydrateInFlight = null;
  });
  return p;
}

import { getAllLocalMemories, listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
import {
  getOrSelectFirstChild,
  peekSelectedChildIdLastKnown,
  refreshChildrenFromCloudInBackground,
  getCaptureTabChildSnapshot,
  setCaptureTabChildSnapshot,
} from '@/services/children';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { getFamilyMemories } from '@/services/media';
import { pullFamilyMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync';
import { listBooks, listBooksFromSqliteSync, healAllBookCovers, healAllBookMemoryIdsIfWiped } from '@/services/books';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';

function scopedLocalChildren() {
  const uid = peekLastRealAuthUserId();
  if (uid) return listLocalChildrenForUser(uid);
  // Pas de compte produit connu : ignorer les profils déjà liés à un e-mail.
  return listLocalChildren().filter(c => !(c.user_id ?? '').trim());
}

/**
 * Remplit le cache onglets **uniquement depuis SQLite**, sans auth ni réseau.
 * - Si l’ID sélectionné n’est pas encore lu depuis AsyncStorage, on prend le **premier** enfant local (ordre `created_at`).
 * - À enchaîner après `warmSelectedChildIdFromStorage()` pour cibler le bon profil dès que possible.
 * - **Scopé au dernier compte produit** — jamais un enfant d’un autre e-mail.
 */
export function hydrateTabScreensFromSqliteSync(): boolean {
  try {
    const localChildren = scopedLocalChildren();
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

    const memories = getAllLocalMemories().filter(m => {
      const uid = peekLastRealAuthUserId();
      if (!uid) return !(m.user_id ?? '').trim();
      const o = (m.user_id ?? '').trim();
      return !o || o === uid;
    });
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
 * Hydratation onglets : **peindre SQLite d’abord**, puis pull cloud en fond.
 * Ne bloque plus l’UI sur `getChildren()` quand le local a déjà des profils.
 */
export function hydrateTabScreensFromLocal(): Promise<void> {
  if (fullHydrateInFlight) return fullHydrateInFlight;

  const p = (async (): Promise<void> => {
    try {
      const childId = await getOrSelectFirstChild();
      if (!childId) {
        setFeedHydrationSnapshots(null, [], []);
        setCaptureTabChildSnapshot(null);
        // Cold : tenter un pull cloud sans bloquer un second hydrate concurrent inutilement.
        refreshChildrenFromCloudInBackground();
        return;
      }

      const localChildren = scopedLocalChildren();
      const activeLocal =
        localChildren.find(c => c.id === childId) ?? localChildren[0] ?? null;

      if (!activeLocal) {
        setFeedHydrationSnapshots(null, [], []);
        setCaptureTabChildSnapshot(null);
        return;
      }

      // Peindre SQLite d’abord — jamais attendre le pull cloud ici.
      const [memories, booksRaw] = await Promise.all([
        getFamilyMemories({ waitForRemote: false }),
        listBooks(),
      ]);
      const books = await healAllBookCovers(await healAllBookMemoryIdsIfWiped(booksRaw));

      setFeedHydrationSnapshots(activeLocal, memories, books);
      setCaptureTabChildSnapshot(activeLocal);

      // Merge cloud → SQLite en silence. Ne pas toucher le snapshot Capturer ni
      // émettre d’event UI : un `updated_at` cloud ne doit jamais recharger le hero.
      void (async () => {
        try {
          await pullFamilyMemoriesFromRemoteToLocal().catch(() => {});
          refreshChildrenFromCloudInBackground();
          const mem2 = await getFamilyMemories({ waitForRemote: false });
          const booksRaw2 = await listBooks();
          const books2 = await healAllBookCovers(await healAllBookMemoryIdsIfWiped(booksRaw2));
          const stillLocal =
            scopedLocalChildren().find(c => c.id === childId) ?? activeLocal;
          setFeedHydrationSnapshots(stillLocal, mem2, books2);
          // Snapshot Capturer : garder l’enfant déjà affiché (égalité visuelle).
          const prevSnap = getCaptureTabChildSnapshot();
          if (
            !prevSnap ||
            prevSnap.id !== stillLocal.id ||
            (prevSnap.local_photo_path ?? '') !== (stillLocal.local_photo_path ?? '') ||
            (prevSnap.photo_url ?? '') !== (stillLocal.photo_url ?? '')
          ) {
            setCaptureTabChildSnapshot(stillLocal);
          }
        } catch (e) {
          console.warn('[hydrateTabScreensFromLocal] bg cloud merge', e);
        }
      })();
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

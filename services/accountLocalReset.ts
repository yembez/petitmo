import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Platform } from 'react-native';
import {
  deleteAsync,
  documentDirectory,
} from 'expo-file-system/legacy';
import {
  deleteLocalBook,
  deleteLocalChild,
  deleteLocalMemory,
  getAllLocalMemories,
  getAllLocalMemoriesIncludingArchived,
  listLocalBooks,
  listLocalChildren,
  upsertLocalChild,
  upsertLocalMemory,
} from '@/lib/localDb';
import { deleteLocalMediaFiles } from '@/lib/localCleanup';
import { supabase } from '@/lib/supabase';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';
import { clearSelectedChildAndCaptureSnapshot } from '@/services/children';

function normalizeAccountEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Hide My Email / relay ≠ même identité que gmail — pas de rekey silencieux. */
function isApplePrivateRelayEmail(email: string): boolean {
  return email.endsWith('@privaterelay.appleid.com');
}

/**
 * Même personne (e-mail normalisé identique, hors relay Apple) → rekey local
 * plutôt que purge account_switch.
 */
export function emailsMatchForSameAccount(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ea = normalizeAccountEmail(a);
  const eb = normalizeAccountEmail(b);
  if (!ea || !eb) return false;
  if (isApplePrivateRelayEmail(ea) || isApplePrivateRelayEmail(eb)) {
    return ea === eb;
  }
  return ea === eb;
}

/**
 * Enfant / souvenir affichable pour ce compte.
 * `user_id` vide = orphelin (claim). Un autre uid ne doit jamais être peint.
 */
export function entityVisibleForAccount(
  entityUserId: string | null | undefined,
  accountUserId: string | null | undefined,
): boolean {
  const owner = (entityUserId ?? '').trim();
  const uid = (accountUserId ?? '').trim();
  if (!uid) return !owner;
  return !owner || owner === uid;
}

/** uid courant connu et ligne rattachée à un autre compte. uid pas encore warm → false. */
export function isForeignToCurrentAccount(entityUserId: string | null | undefined): boolean {
  const uid = peekLastRealAuthUserId();
  if (!uid) return false;
  return !entityVisibleForAccount(entityUserId, uid);
}

/** Souvenirs SQLite du compte courant — jamais ceux d’un autre `user_id`. */
export function listMemoriesVisibleForAccount(
  accountUserId: string | null | undefined,
): ReturnType<typeof getAllLocalMemories> {
  return getAllLocalMemories().filter(m => entityVisibleForAccount(m.user_id, accountUserId));
}

/** Réattribue enfants + souvenirs `fromUserId` → `toUserId` (même compte, nouvel uid Auth). */
export function rekeyLocalWorkspaceUserId(fromUserId: string, toUserId: string): number {
  const from = fromUserId.trim();
  const to = toUserId.trim();
  if (!from || !to || from === to) return 0;
  let n = 0;
  for (const child of listLocalChildren()) {
    if ((child.user_id ?? '').trim() === from) {
      upsertLocalChild({ ...child, user_id: to });
      n += 1;
    }
  }
  for (const memory of getAllLocalMemoriesIncludingArchived()) {
    if ((memory.user_id ?? '').trim() === from) {
      upsertLocalMemory({ ...memory, user_id: to });
      n += 1;
    }
  }
  return n;
}

const LAST_REAL_AUTH_USER_ID_KEY = 'petitmo:lastRealAuthUserId';
const LAST_REAL_AUTH_EMAIL_KEY = 'petitmo:lastRealAuthEmail';

let lastRealAuthUserIdMemory: string | null | undefined;
let lastRealAuthEmailMemory: string | null | undefined;

export async function getLastRealAuthUserId(): Promise<string | null> {
  if (lastRealAuthUserIdMemory !== undefined) {
    return lastRealAuthUserIdMemory;
  }
  try {
    const v = (await AsyncStorage.getItem(LAST_REAL_AUTH_USER_ID_KEY))?.trim() || null;
    lastRealAuthUserIdMemory = v;
    return v;
  } catch {
    lastRealAuthUserIdMemory = null;
    return null;
  }
}

/** Lecture sync pour filtrer Capture / hydrate (après warm au boot). */
export function peekLastRealAuthUserId(): string | null {
  return lastRealAuthUserIdMemory ?? null;
}

export async function setLastRealAuthUserId(userId: string | null): Promise<void> {
  const uid = (userId ?? '').trim() || null;
  lastRealAuthUserIdMemory = uid;
  try {
    if (uid) {
      await AsyncStorage.setItem(LAST_REAL_AUTH_USER_ID_KEY, uid);
    } else {
      await AsyncStorage.removeItem(LAST_REAL_AUTH_USER_ID_KEY);
    }
  } catch (e) {
    console.warn('[accountLocalReset] setLastRealAuthUserId', e);
  }
}

/** E-mail du dernier compte produit sur cet appareil (survit à la déconnexion). */
export async function getLastRealAuthEmail(): Promise<string | null> {
  if (lastRealAuthEmailMemory !== undefined) {
    return lastRealAuthEmailMemory;
  }
  try {
    const v = (await AsyncStorage.getItem(LAST_REAL_AUTH_EMAIL_KEY))?.trim().toLowerCase() || null;
    lastRealAuthEmailMemory = v;
    return v;
  } catch {
    lastRealAuthEmailMemory = null;
    return null;
  }
}

export function peekLastRealAuthEmail(): string | null {
  return lastRealAuthEmailMemory ?? null;
}

export async function setLastRealAuthEmail(email: string | null): Promise<void> {
  const e = (email ?? '').trim().toLowerCase() || null;
  lastRealAuthEmailMemory = e;
  try {
    if (e) {
      await AsyncStorage.setItem(LAST_REAL_AUTH_EMAIL_KEY, e);
    } else {
      await AsyncStorage.removeItem(LAST_REAL_AUTH_EMAIL_KEY);
    }
  } catch (err) {
    console.warn('[accountLocalReset] setLastRealAuthEmail', err);
  }
}

/** Au boot : hydrate caches sync id + e-mail (Capturer / auth hors-ligne). */
export async function warmLastRealAuthIdentityFromStorage(): Promise<void> {
  await Promise.all([getLastRealAuthUserId(), getLastRealAuthEmail()]);
}

/** True si SQLite contient des lignes déjà rattachées à un autre compte. */
export function localWorkspaceConflictsWithUser(userId: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  for (const c of listLocalChildren()) {
    const o = (c.user_id ?? '').trim();
    if (o && o !== uid) return true;
  }
  for (const m of getAllLocalMemories()) {
    const o = (m.user_id ?? '').trim();
    if (o && o !== uid) return true;
  }
  return false;
}

/**
 * Purge totale de l’espace local (enfants, souvenirs, livres, sandbox, sélection).
 * À appeler au **changement de compte** — jamais pour partager un téléphone entre e-mails.
 */
export async function clearLocalAccountWorkspace(reason: string): Promise<void> {
  console.warn('[accountLocalReset] clearLocalAccountWorkspace', reason);

  /**
   * SQLite d’abord (rapide) — les deletes fichiers en fond.
   * Sinon finishAfterAuth (race 5s) route avec peek uid encore ancien pendant une purge médias longue.
   */
  const memories = getAllLocalMemoriesIncludingArchived();
  const mediaToDelete = [...memories];
  for (const memory of memories) {
    deleteLocalMemory(memory.id);
  }

  for (const book of listLocalBooks()) {
    deleteLocalBook(book.id);
  }

  const childPhotoPaths: string[] = [];
  for (const child of listLocalChildren()) {
    const lp = (child.local_photo_path ?? '').trim();
    if (lp) childPhotoPaths.push(lp);
    try {
      void AsyncStorage.removeItem(`@petitmo_child_original_photo_v1:${child.id}`);
    } catch {
      /* */
    }
    deleteLocalChild(child.id);
  }

  await clearSelectedChildAndCaptureSnapshot();
  setFeedHydrationSnapshots(null, [], []);
  try {
    const { setCachedPrintOrders } = await import('@/lib/printOrdersCache');
    await setCachedPrintOrders([]);
  } catch {
    /* */
  }
  DeviceEventEmitter.emit('petitmo:memories-invalidate');
  DeviceEventEmitter.emit('petitmo:books-updated');

  void (async () => {
    for (const memory of mediaToDelete) {
      try {
        await deleteLocalMediaFiles(memory);
      } catch {
        /* */
      }
    }
    for (const lp of childPhotoPaths) {
      try {
        await deleteAsync(lp, { idempotent: true });
      } catch {
        /* */
      }
    }
    if (Platform.OS !== 'web' && documentDirectory) {
      try {
        await deleteAsync(`${documentDirectory}petitmo_memories/`, { idempotent: true });
      } catch {
        /* */
      }
      try {
        await deleteAsync(`${documentDirectory}petitmo_children/`, { idempotent: true });
      } catch {
        /* */
      }
    }
  })();
}

/**
 * Avant sync d’un compte produit : si un autre compte a laissé des données sur cet appareil,
 * on les efface. Les orphelins (`user_id` vide) sont conservés pour claim.
 */
export async function prepareLocalWorkspaceForRealUser(
  userId: string,
  opts?: { sessionEmail?: string | null },
): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;

  const prev = await getLastRealAuthUserId();
  const prevEmail = await getLastRealAuthEmail();
  /** E-mail de la session qui arrive. Vide ≠ « même que le précédent ». */
  const sessionEmail = normalizeAccountEmail(opts?.sessionEmail);
  const switched = !!(prev && prev !== uid);
  const foreign = localWorkspaceConflictsWithUser(uid);
  const localChildrenBefore = listLocalChildren().length;

  /**
   * Même e-mail, nouvel uid Auth (ex. provider relié mal) → rekey, pas purge.
   * Apple Hide My Email ≠ gmail → pas de rekey (isolation).
   * Les deux e-mails doivent être connus et identiques. Sinon on purge.
   */
  if (switched && prev && emailsMatchForSameAccount(prevEmail, sessionEmail)) {
    const rekeyed = rekeyLocalWorkspaceUserId(prev, uid);
    console.warn('[accountLocalReset] rekey same-email', { prev, uid, rekeyed });
    await setLastRealAuthUserId(uid);
    if (sessionEmail) await setLastRealAuthEmail(sessionEmail);
    return;
  }

  /**
   * Bug « claim volant » uniquement : lignes **déjà taguées** cet uid + cloud vide.
   * Orphelins seuls → claim, jamais purge (sinon 1er login détruit le local).
   */
  let cloudEmptyStale = false;
  const taggedForUid = listLocalChildren().filter(c => (c.user_id ?? '').trim() === uid);
  if (!switched && !foreign && !prev && taggedForUid.length > 0) {
    try {
      const probe = supabase.from('children').select('id', { count: 'exact', head: true });
      const timed = await Promise.race([
        Promise.resolve(probe).then(r => r),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
      ]);
      if (timed && !('error' in timed && timed.error) && (timed.count ?? 0) === 0) {
        cloudEmptyStale = true;
      }
    } catch (e) {
      console.warn('[accountLocalReset] cloud empty check', e);
    }
  }

  if (switched || foreign || cloudEmptyStale) {
    const reason = switched
      ? `account_switch:${prev}->${uid}`
      : foreign
        ? `foreign_local_data->${uid}`
        : `cloud_empty_stale_local->${uid}`;

    /**
     * Origine « profil disparu » après Apple / autre provider :
     * nouvel `auth.users.id` ≠ dernier compte → purge isolation (volontaire produit).
     * Sans Sentry / notice, ça ressemble à un bug SQLite.
     */
    if (localChildrenBefore > 0) {
      try {
        const { captureAccountWorkspaceCleared } = await import('@/lib/sentry');
        captureAccountWorkspaceCleared({
          reason,
          prevUserId: prev,
          nextUserId: uid,
          localChildrenBefore,
        });
      } catch {
        /* */
      }
      try {
        const { setPendingAccountSwitchNotice } = await import('@/lib/accountSwitchNotice');
        setPendingAccountSwitchNotice({
          reason,
          prevUserId: prev,
          prevEmail,
          nextUserId: uid,
          localChildrenBefore,
        });
      } catch {
        /* */
      }
    }

    await clearLocalAccountWorkspace(reason);
  }

  await setLastRealAuthUserId(uid);
  if (sessionEmail) await setLastRealAuthEmail(sessionEmail);
}

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
  listLocalBooks,
  listLocalChildren,
  listLocalChildrenForUser,
} from '@/lib/localDb';
import { deleteLocalMediaFiles } from '@/lib/localCleanup';
import { supabase } from '@/lib/supabase';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';
import { clearSelectedChildAndCaptureSnapshot } from '@/services/children';

const LAST_REAL_AUTH_USER_ID_KEY = 'petitmo:lastRealAuthUserId';

let lastRealAuthUserIdMemory: string | null | undefined;

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

  const memories = getAllLocalMemories();
  for (const memory of memories) {
    try {
      await deleteLocalMediaFiles(memory);
    } catch {
      /* */
    }
    deleteLocalMemory(memory.id);
  }

  for (const book of listLocalBooks()) {
    deleteLocalBook(book.id);
  }

  for (const child of listLocalChildren()) {
    const lp = (child.local_photo_path ?? '').trim();
    if (lp) {
      try {
        await deleteAsync(lp, { idempotent: true });
      } catch {
        /* */
      }
    }
    try {
      await AsyncStorage.removeItem(`@petitmo_child_original_photo_v1:${child.id}`);
    } catch {
      /* */
    }
    deleteLocalChild(child.id);
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

  await clearSelectedChildAndCaptureSnapshot();
  setFeedHydrationSnapshots(null, [], []);
  DeviceEventEmitter.emit('petitmo:memories-invalidate');
}

/**
 * Avant sync d’un compte produit : si un autre compte a laissé des données sur cet appareil,
 * on les efface. Les orphelins (`user_id` vide) sont conservés pour claim.
 */
export async function prepareLocalWorkspaceForRealUser(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;

  const prev = await getLastRealAuthUserId();
  const switched = !!(prev && prev !== uid);
  const foreign = localWorkspaceConflictsWithUser(uid);

  /**
   * Récupération post-bug « claim volant » : premier tracking, cloud du compte vide,
   * mais SQLite déjà rempli avec ce `user_id` (données d’un autre e-mail réattribuées).
   */
  let cloudEmptyStale = false;
  if (!switched && !foreign && !prev && listLocalChildrenForUser(uid).length > 0) {
    try {
      const { count, error } = await supabase
        .from('children')
        .select('id', { count: 'exact', head: true });
      if (!error && (count ?? 0) === 0) {
        cloudEmptyStale = true;
      }
    } catch (e) {
      console.warn('[accountLocalReset] cloud empty check', e);
    }
  }

  if (switched || foreign || cloudEmptyStale) {
    await clearLocalAccountWorkspace(
      switched
        ? `account_switch:${prev}->${uid}`
        : foreign
          ? `foreign_local_data->${uid}`
          : `cloud_empty_stale_local->${uid}`,
    );
  }

  await setLastRealAuthUserId(uid);
}

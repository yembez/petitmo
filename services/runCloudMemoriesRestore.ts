/**
 * Pull famille cloud avec overlay doux si SQLite souvenirs encore vide.
 * Local-first : si le local a déjà des souvenirs → pull silencieux (ou skip).
 */
import { getAllLocalMemories, listLocalChildrenForUser } from '@/lib/localDb';
import { getCachedUserMode } from '@/lib/userMode';
import {
  beginCloudRestoreUi,
  CLOUD_RESTORE_MAX_MS,
  endCloudRestoreUi,
} from '@/lib/cloudRestoreUi';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { pullFamilyMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync';
import { formatChildGivenNamesList } from '@/utils/childDisplayName';
import type { Memory } from '@/types/local';

/** Tous les prénoms locaux du compte, libellé FR (« Léa et Tom »). */
function localChildrenGivenNamesLabel(): string | null {
  const uid = peekLastRealAuthUserId();
  const kids = uid ? listLocalChildrenForUser(uid) : [];
  const label = formatChildGivenNamesList(kids.map(k => k.name));
  return label.trim() ? label : null;
}

/**
 * Restaure les souvenirs cloud → SQLite.
 * Overlay soft seulement si `getAllLocalMemories().length === 0` au départ.
 */
export async function restoreFamilyMemoriesFromCloudWithSoftWait(): Promise<Memory[]> {
  const before = getAllLocalMemories();
  if ((await getCachedUserMode()) === 'local') {
    return before;
  }

  if (before.length > 0) {
    try {
      await pullFamilyMemoriesFromRemoteToLocal();
    } catch {
      /* hors ligne */
    }
    return getAllLocalMemories();
  }

  beginCloudRestoreUi({ childName: localChildrenGivenNamesLabel() });
  try {
    await Promise.race([
      pullFamilyMemoriesFromRemoteToLocal().catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, CLOUD_RESTORE_MAX_MS)),
    ]);
  } finally {
    endCloudRestoreUi();
  }
  return getAllLocalMemories();
}

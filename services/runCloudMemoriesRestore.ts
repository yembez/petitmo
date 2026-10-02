/**
 * Pull famille cloud → SQLite.
 *
 * Overlay soft **uniquement** si :
 * - l’appelant le demande (`softUi: true`, typiquement réinstall / login cloud),
 * - ET un probe rapide confirme qu’il y a au moins 1 souvenir distant.
 *
 * Fil vide (compte neuf) / cold start → toujours silencieux. Pas de flag « une fois par appareil ».
 */
import { supabase } from '@/lib/supabase';
import { getAllLocalMemories, listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
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
 * `true` = cloud a ≥1 souvenir ; `false` = cloud vide / pas d’enfants ;
 * `null` = indéterminé (hors ligne / erreur) → pas d’overlay.
 */
async function probeFamilyHasRemoteMemories(): Promise<boolean | null> {
  const children = listLocalChildren();
  if (children.length === 0) return false;
  try {
    const ids = children.map(c => c.id).filter(Boolean);
    if (ids.length === 0) return false;
    const { count, error } = await supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .in('child_id', ids)
      .limit(1);
    if (error) return null;
    return (count ?? 0) > 0;
  } catch {
    return null;
  }
}

async function pullEmptyLocalWithOptionalSoftUi(
  wantSoftUi: boolean,
  holdUi: boolean,
): Promise<Memory[]> {
  let useUi = false;
  if (wantSoftUi) {
    const hasRemote = await probeFamilyHasRemoteMemories();
    // Overlay seulement s’il y a vraiment quelque chose à ramener.
    useUi = hasRemote === true;
  }

  if (useUi) {
    // Immédiat : l’appelant (auth) attend encore sur le shell — pas de flash Capturer.
    beginCloudRestoreUi({
      childName: localChildrenGivenNamesLabel(),
      immediate: true,
    });
  }
  try {
    await Promise.race([
      pullFamilyMemoriesFromRemoteToLocal().catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, CLOUD_RESTORE_MAX_MS)),
    ]);
  } finally {
    // holdUi : fermeture après router.replace (évite trou auth/Capturer).
    if (useUi && !holdUi) endCloudRestoreUi();
  }
  return getAllLocalMemories();
}

/**
 * Restaure les souvenirs cloud → SQLite.
 * @param opts.softUi — demandé seulement depuis auth / OTP (réinstall). Le fil passe `false`.
 *   Même à `true`, l’overlay n’apparaît que si le cloud a des souvenirs.
 * @param opts.holdUi — laisser l’overlay ouvert (auth navigue vers tabs puis `endCloudRestoreUi`).
 */
export async function restoreFamilyMemoriesFromCloudWithSoftWait(opts?: {
  softUi?: boolean;
  holdUi?: boolean;
}): Promise<Memory[]> {
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

  return pullEmptyLocalWithOptionalSoftUi(opts?.softUi === true, opts?.holdUi === true);
}

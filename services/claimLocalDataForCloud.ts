import {
  getAllLocalMemories,
  listLocalChildren,
  upsertLocalChild,
  upsertLocalMemory,
} from '@/lib/localDb';
import { remapLegacyEntityIdsForCloudSync } from '@/services/cloudIdRemap';

function isOrphanUserId(userId: string | null | undefined): boolean {
  return !(userId ?? '').trim();
}

/**
 * Après login compte produit : rattache **uniquement les orphelins** (`user_id` vide)
 * au compte courant, et marque `local` → `pending` pour le flush.
 *
 * **Ne réattribue jamais** un enfant/souvenir déjà lié à un autre `user_id`
 * (isolation multi-compte sur le même téléphone).
 */
export async function claimLocalDataForCloudUser(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;

  await remapLegacyEntityIdsForCloudSync();

  for (const child of listLocalChildren()) {
    if (!isOrphanUserId(child.user_id)) continue;
    upsertLocalChild({ ...child, user_id: uid });
  }

  for (const memory of getAllLocalMemories()) {
    const orphan = isOrphanUserId(memory.user_id);
    const status = memory.sync_status;
    const needsPending = status === 'local' || status == null || status === undefined;
    if (!orphan && !needsPending) continue;
    if (!orphan && (memory.user_id ?? '').trim() !== uid) continue;

    upsertLocalMemory({
      ...memory,
      user_id: orphan ? uid : memory.user_id,
      sync_status: needsPending && ((memory.user_id ?? '').trim() === uid || orphan)
        ? 'pending'
        : memory.sync_status,
    });
  }
}

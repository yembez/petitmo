/**
 * Miroir local de l’archivage downgrade (local-first UX).
 * Le webhook serveur reste source de vérité cloud ; le client applique
 * la même règle dès que le tier UX passe free/paid.
 */
import { DeviceEventEmitter } from 'react-native';
import { FREE_TIER_LIMIT, invalidateMemoryLimitCache } from '@/lib/limits';
import {
  getAllLocalMemoriesIncludingArchived,
  upsertLocalMemory,
} from '@/lib/localDb';

export const ARCHIVE_REASON_DOWNGRADE = 'downgrade_free';

export function archiveLocalMemoriesOverFreeCap(keep = FREE_TIER_LIMIT): {
  kept: number;
  archived: number;
} {
  const all = getAllLocalMemoriesIncludingArchived();
  const active = all
    .filter(m => !m.archived_at)
    .sort((a, b) => {
      const ca = a.created_at || '';
      const cb = b.created_at || '';
      return cb.localeCompare(ca);
    });

  if (active.length <= keep) {
    return { kept: active.length, archived: 0 };
  }

  const now = new Date().toISOString();
  const toArchive = active.slice(keep);
  for (const m of toArchive) {
    upsertLocalMemory({
      ...m,
      archived_at: now,
      archive_reason: ARCHIVE_REASON_DOWNGRADE,
      updated_at: now,
    });
  }
  invalidateMemoryLimitCache();
  if (toArchive.length > 0) {
    // Changement visuel réel (items hors fil) — pas un flush sync-only.
    DeviceEventEmitter.emit('petitmo:memories-invalidate');
  }
  return { kept: keep, archived: toArchive.length };
}

export function restoreLocalDowngradeArchivedMemories(): { restored: number } {
  const all = getAllLocalMemoriesIncludingArchived();
  const archived = all.filter(
    m => m.archived_at && m.archive_reason === ARCHIVE_REASON_DOWNGRADE,
  );
  if (archived.length === 0) return { restored: 0 };

  const now = new Date().toISOString();
  for (const m of archived) {
    upsertLocalMemory({
      ...m,
      archived_at: null,
      archive_reason: null,
      updated_at: now,
    });
  }
  invalidateMemoryLimitCache();
  DeviceEventEmitter.emit('petitmo:memories-invalidate');
  return { restored: archived.length };
}

/** Appliquer après changement de tier UX (RC listener / login).
 * V1 : plus d’archivage à l’expiration — on restaure les archives downgrade
 * pour que tout reste visible ; le frein à l’ajout est `captureLocked`.
 */
export function applyLocalArchiveForTier(tier: 'free' | 'paid'): void {
  try {
    // Toujours restaurer les archives downgrade (migration douce V1 + réabonnement).
    restoreLocalDowngradeArchivedMemories();
  } catch (e) {
    console.warn('[memoryArchiveLocal]', tier, e);
  }
}

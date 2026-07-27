import { getLocalMemoriesPendingCloudSync } from '@/lib/localDb';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { supabase } from '@/lib/supabase';
import { getCachedUserMode } from '@/lib/userMode';
import { getUserTier } from '@/lib/userTier';
import { ensureLocalChildrenSyncedToSupabase } from '@/services/children';
import { remapLegacyEntityIdsForCloudSync } from '@/services/cloudIdRemap';
import { ensureMemoryUploadedForCloud } from '@/services/migration';
import { resumePetitmoPlusCloudCaptureOrMerge } from '@/services/media';

let flushInFlight: Promise<void> | null = null;

/**
 * Reprend les souvenirs encore « pending » côté cloud (upload interrompu, app fermée).
 * Ne tourne que pour un vrai compte authentifié (gratuit ou paid), jamais pour le device-user.
 * Appels concurrents partagent la même promesse.
 * **Silencieux UI** : upsert SQLite seulement — jamais `memories-invalidate` / flash fil.
 */
export function flushPendingCloudUploadsOnce(): Promise<void> {
  if (flushInFlight) return flushInFlight;

  const p = (async (): Promise<void> => {
    if ((await getCachedUserMode()) === 'local') return;

    const session = await ensureSupabaseSession();
    if (!session.ok) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    // Garde-fou : jamais flush sous device-user même si le cache mode serait incohérent.
    if ((user.email ?? '').toLowerCase().endsWith('@petitmo.local')) return;

    await remapLegacyEntityIdsForCloudSync();
    await ensureLocalChildrenSyncedToSupabase();

    const pending = getLocalMemoriesPendingCloudSync();
    const paid = (await getUserTier()) === 'paid';

    for (const m of pending) {
      if ((m.user_id ?? '').trim() && m.user_id !== user.id) continue;
      try {
        const handled = await resumePetitmoPlusCloudCaptureOrMerge(m, user.id, paid);
        if (!handled) {
          await ensureMemoryUploadedForCloud(m);
        }
      } catch (e) {
        console.warn('[pendingCloudFlush]', m.id, e);
      }
      await new Promise<void>(r => setTimeout(r, 120));
    }
  })();

  flushInFlight = p;
  void p.finally(() => {
    if (flushInFlight === p) flushInFlight = null;
  });
  return p;
}

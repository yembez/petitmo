import { DeviceEventEmitter } from 'react-native';
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
 * Mode local gratuit : no-op. Appels concurrents partagent la même promesse.
 */
export function flushPendingCloudUploadsOnce(): Promise<void> {
  if (flushInFlight) return flushInFlight;

  const p = (async (): Promise<void> => {
    if ((await getCachedUserMode()) === 'local') return;

    const session = await ensureSupabaseSession();
    if (!session.ok) return;

    await remapLegacyEntityIdsForCloudSync();
    await ensureLocalChildrenSyncedToSupabase();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

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

    DeviceEventEmitter.emit('petitmo:memories-invalidate');
  })();

  flushInFlight = p;
  void p.finally(() => {
    if (flushInFlight === p) flushInFlight = null;
  });
  return p;
}

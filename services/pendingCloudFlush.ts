import { getLocalMemoriesPendingCloudSync } from '@/lib/localDb';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { supabase } from '@/lib/supabase';
import { getCachedUserMode } from '@/lib/userMode';
import { resolveEffectiveUserTier } from '@/lib/userTier';
import { recordCaughtError, recordWarn } from '@/lib/diagnosticTrail';
import { ensureLocalChildrenSyncedToSupabase } from '@/services/children';
import { remapLegacyEntityIdsForCloudSync } from '@/services/cloudIdRemap';
import { ensureMemoryUploadedForCloud } from '@/services/migration';
import { resumePetitmoPlusCloudCaptureOrMerge } from '@/services/media';
import { isMediaImportBusy } from '@/services/mediaImportBusy';
import { InteractionManager } from 'react-native';

let flushInFlight: Promise<void> | null = null;
let deferredFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Reprend les souvenirs encore « pending » côté cloud (upload interrompu, app fermée).
 * Ne tourne que pour un vrai compte authentifié (gratuit ou paid), jamais pour le device-user.
 * Appels concurrents partagent la même promesse.
 * **Silencieux UI** : upsert SQLite seulement — jamais `memories-invalidate` / flash fil.
 * Skip si un import / capture est en cours (évite de ressentir le cloud pendant le paint).
 */
export function flushPendingCloudUploadsOnce(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  if (isMediaImportBusy()) return Promise.resolve();

  const p = (async (): Promise<void> => {
    if ((await getCachedUserMode()) === 'local') return;
    if (isMediaImportBusy()) return;

    const session = await ensureSupabaseSession();
    if (!session.ok) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    // Garde-fou : jamais flush sous device-user même si le cache mode serait incohérent.
    if ((user.email ?? '').toLowerCase().endsWith('@petitmo.local')) return;

    await remapLegacyEntityIdsForCloudSync();
    await ensureLocalChildrenSyncedToSupabase();

    if (isMediaImportBusy()) return;

    const pending = getLocalMemoriesPendingCloudSync();
    const paid = (await resolveEffectiveUserTier()) === 'paid';

    for (const m of pending) {
      if (isMediaImportBusy()) return;
      if ((m.user_id ?? '').trim() && m.user_id !== user.id) continue;
      try {
        const handled = await resumePetitmoPlusCloudCaptureOrMerge(m, user.id, paid);
        if (!handled) {
          await ensureMemoryUploadedForCloud(m);
        }
      } catch (e) {
        console.warn('[pendingCloudFlush]', m.id, e);
        recordCaughtError('sync.flush', e);
        recordWarn('sync.flush.item', m.type ?? 'unknown');
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

/**
 * Flush cloud après paint / interactions — boot & foreground.
 * Ne concurrence pas l’hydratation UI ni un import en cours.
 */
export function scheduleDeferredPendingCloudFlush(delayMs = 4500): void {
  if (deferredFlushTimer) clearTimeout(deferredFlushTimer);
  deferredFlushTimer = setTimeout(() => {
    deferredFlushTimer = null;
    InteractionManager.runAfterInteractions(() => {
      void flushPendingCloudUploadsOnce();
    });
  }, Math.max(0, delayMs));
}

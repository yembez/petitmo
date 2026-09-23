/**
 * Archivage / restore souvenirs pour le cycle de vie abo (sans grâce).
 * EXPIRATION → free + garder FREE_KEEP actifs ; RENEWAL → clear archives downgrade.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

/** Aligné `lib/limits.ts` FREE_TIER_LIMIT — dupliqué Edge (pas d’import app). */
export const FREE_TIER_ACTIVE_KEEP = 50;

export const ARCHIVE_REASON_DOWNGRADE = 'downgrade_free';

export async function archiveMemoriesOverFreeCap(
  admin: SupabaseClient,
  userId: string,
  keep = FREE_TIER_ACTIVE_KEEP,
): Promise<{ kept: number; archived: number }> {
  const { data: rows, error } = await admin
    .from('memories')
    .select('id, created_at')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[memoryArchive] select', userId, error.message);
    throw error;
  }

  const list = rows ?? [];
  if (list.length <= keep) {
    return { kept: list.length, archived: 0 };
  }

  const toArchive = list.slice(keep).map(r => r.id as string);
  const now = new Date().toISOString();
  const chunk = 200;
  let archived = 0;
  for (let i = 0; i < toArchive.length; i += chunk) {
    const ids = toArchive.slice(i, i + chunk);
    const { error: updErr } = await admin
      .from('memories')
      .update({ archived_at: now, archive_reason: ARCHIVE_REASON_DOWNGRADE, updated_at: now })
      .in('id', ids)
      .eq('user_id', userId);
    if (updErr) {
      console.error('[memoryArchive] update', updErr.message);
      throw updErr;
    }
    archived += ids.length;
  }
  return { kept: keep, archived };
}

export async function restoreDowngradeArchivedMemories(
  admin: SupabaseClient,
  userId: string,
): Promise<{ restored: number }> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('memories')
    .update({ archived_at: null, archive_reason: null, updated_at: now })
    .eq('user_id', userId)
    .eq('archive_reason', ARCHIVE_REASON_DOWNGRADE)
    .not('archived_at', 'is', null)
    .select('id');

  if (error) {
    console.error('[memoryArchive] restore', userId, error.message);
    throw error;
  }
  return { restored: data?.length ?? 0 };
}

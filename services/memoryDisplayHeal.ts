import { DeviceEventEmitter } from 'react-native';
import { getCachedUserMode } from '@/lib/userMode';
import { supabase } from '@/lib/supabase';
import { getAllLocalMemories, getLocalMemoryById, updateLocalMemoryFavorite, upsertLocalMemory } from '@/lib/localDb';
import type { Memory } from '@/types/local';
import { mergeServerMemoryRowWithExistingLocal } from '@/services/memoryRowMapping';
import { feedMemoriesHydrationSnapshot } from '@/services/tabScreensCache';
import { isDeviceLocalMediaUri } from '@/utils/memoryPhotos';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  isProbablyStalePetitmoSandboxPath,
} from '@/utils/localMediaReadable';

async function clearDeadSandboxPointer(
  memory: Memory,
  field: keyof Memory,
): Promise<boolean> {
  const raw = memory[field];
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const val = raw.trim();
  if (isCloudMediaReference(val)) return false;
  if (field === 'poster_url' || field === 'thumbnail_url') {
    if (!isDeviceLocalMediaUri(val)) return false;
  }
  if (!isProbablyStalePetitmoSandboxPath(val)) return false;
  if (await isLocalMediaUriReadable(val)) return false;
  upsertLocalMemory({ ...memory, [field]: null });
  return true;
}

async function clearDeadExtraPhotoPaths(memory: Memory): Promise<boolean> {
  const extras = memory.extra_photo_paths;
  if (!Array.isArray(extras) || extras.length === 0) return false;
  let changed = false;
  const next: (string | null)[] = [];
  for (const raw of extras) {
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (!val) {
      next.push(null);
      continue;
    }
    if (
      isCloudMediaReference(val) ||
      !isProbablyStalePetitmoSandboxPath(val) ||
      (await isLocalMediaUriReadable(val))
    ) {
      next.push(val);
      continue;
    }
    next.push(null);
    changed = true;
  }
  if (!changed) return false;
  const cleaned = next.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  upsertLocalMemory({
    ...memory,
    extra_photo_paths: cleaned.length > 0 ? cleaned : null,
  });
  return true;
}

/**
 * Efface les pointeurs sandbox morts, puis la materialisation cloud→sandbox reprend l’affichage local-first.
 */
export async function healDeadLocalMediaPointersForMemory(memory: Memory): Promise<Memory> {
  let current = getLocalMemoryById(memory.id) ?? memory;
  const fields: (keyof Memory)[] = [
    'local_thumb_path',
    'local_display_path',
    'local_print_path',
    'local_media_path',
    'local_original_path',
    'voice_cover_path',
  ];
  let changed = false;
  for (const field of fields) {
    if (await clearDeadSandboxPointer(current, field)) {
      changed = true;
      current = getLocalMemoryById(memory.id) ?? current;
    }
  }
  if (await clearDeadExtraPhotoPaths(current)) {
    changed = true;
    current = getLocalMemoryById(memory.id) ?? current;
  }
  /** Vidéo pré-Petitmo+ : ne pas effacer poster_url / thumbnail_url — materialisation remplace en une fois. */
  if (changed) {
    DeviceEventEmitter.emit('petitmo:memories-updated', {
      memoryId: memory.id,
      silent: true,
    });
  }
  return getLocalMemoryById(memory.id) ?? current;
}

export async function healDeadLocalMediaPointersForMemories(
  memories: readonly Memory[],
  options?: { max?: number },
): Promise<void> {
  const max = options?.max ?? 48;
  const slice = memories.slice(0, max);
  await Promise.all(slice.map(m => healDeadLocalMediaPointersForMemory(m)));
}

/** Pousse les favoris locaux vers Supabase si le cloud est en retard (post-migration). */
export async function reconcileLocalFavoritesToCloud(): Promise<void> {
  if ((await getCachedUserMode()) === 'local') return;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;

  const locals = getAllLocalMemories().filter(m => m.is_favorite);
  if (locals.length === 0) return;

  await Promise.all(
    locals.map(async m => {
      const { data, error } = await supabase
        .from('memories')
        .select('is_favorite, favorite_photo_urls')
        .eq('id', m.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return;
      if (data.is_favorite) return;
      const patch: { is_favorite: boolean; favorite_photo_urls?: string[] } = {
        is_favorite: true,
      };
      const favUrls = Array.isArray(m.favorite_photo_urls)
        ? m.favorite_photo_urls.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
      if (favUrls.length > 0) patch.favorite_photo_urls = favUrls;
      await supabase.from('memories').update(patch).eq('id', m.id).eq('user_id', user.id);
    }),
  );
}

/** Hydrate SQLite avec les favoris distants (restauration / autre appareil). */
export async function pullCloudFavoritesToLocal(): Promise<void> {
  if ((await getCachedUserMode()) === 'local') return;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;

  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_favorite', true);

  if (error || !data?.length) return;

  for (const row of data) {
    const existing = getLocalMemoryById(row.id);
    const merged: Memory = {
      ...mergeServerMemoryRowWithExistingLocal(row, existing),
      is_favorite: true,
      sync_status: 'synced',
    };
    upsertLocalMemory(merged);
  }
}

export async function reconcileFavoritesAfterCloudSync(): Promise<void> {
  await reconcileLocalFavoritesToCloud();
  await pullCloudFavoritesToLocal();
}

/**
 * Le fil peut encore afficher un cœur (état React) alors que SQLite a perdu `is_favorite`
 * après un pull cloud — on réaligne avant d’ouvrir Favoris.
 */
export function applyFeedHydrationFavoriteFlagsToLocal(): number {
  let patched = 0;
  for (const feedRow of feedMemoriesHydrationSnapshot) {
    if (!feedRow.is_favorite) continue;
    const local = getLocalMemoryById(feedRow.id);
    if (!local || local.is_favorite) continue;
    updateLocalMemoryFavorite(feedRow.id, true);
    patched += 1;
  }
  return patched;
}

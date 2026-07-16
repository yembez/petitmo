import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import {
  deleteLocalChild,
  deleteLocalMemory,
  getAllLocalMemories,
  listLocalBooks,
  listLocalChildren,
  upsertLocalBook,
  upsertLocalChild,
  upsertLocalMemory,
} from '@/lib/localDb';
import { getSelectedChild, setSelectedChild } from '@/services/children';
import { remapBookQrTokensOnCloudAfterIdRemap } from '@/services/bookQrPreview';
import { remapFeedLocalCacheForMemoryId } from '@/services/feedLocalPhotoCache';
import { isPetitmoUuid, newPetitmoEntityId } from '@/utils/petitmoEntityId';
import type { Memory } from '@/types/local';

export type LegacyIdRemapReport = {
  childrenRemapped: number;
  memoriesRemapped: number;
  booksPatched: number;
};

function replaceIdInPath(path: string | null | undefined, oldId: string, newId: string): string | null {
  if (!path || typeof path !== 'string') return path ?? null;
  return path.includes(oldId) ? path.split(oldId).join(newId) : path;
}

function remapMemoryPathsForId(memory: Memory, oldId: string, newId: string): Memory {
  return {
    ...memory,
    id: newId,
    public_media_token: memory.public_media_token ?? null,
    local_media_path: replaceIdInPath(memory.local_media_path, oldId, newId),
    local_original_path: replaceIdInPath(memory.local_original_path, oldId, newId),
    local_thumb_path: replaceIdInPath(memory.local_thumb_path, oldId, newId),
    local_display_path: replaceIdInPath(memory.local_display_path, oldId, newId),
    local_print_path: replaceIdInPath(memory.local_print_path, oldId, newId),
    voice_cover_path: replaceIdInPath(memory.voice_cover_path, oldId, newId),
  };
}

async function moveMemorySandboxDir(oldId: string, newId: string): Promise<void> {
  if (!documentDirectory || oldId === newId) return;
  const root = `${documentDirectory}petitmo_memories/`;
  const oldDir = `${root}${oldId}`;
  const newDir = `${root}${newId}`;
  try {
    const newInfo = await getInfoAsync(newDir);
    if (newInfo.exists) return;
    const oldInfo = await getInfoAsync(oldDir);
    if (!oldInfo.exists) return;
    await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
    await copyAsync({ from: oldDir, to: newDir });
    await deleteAsync(oldDir, { idempotent: true });
  } catch (e) {
    console.warn('[cloudIdRemap] moveMemorySandboxDir', oldId, newId, e);
  }
}

async function moveChildProfilePhoto(oldId: string, newId: string, localPhotoPath: string | null): Promise<string | null> {
  if (!localPhotoPath?.trim() || !documentDirectory) return localPhotoPath;
  if (!localPhotoPath.includes(oldId)) return localPhotoPath;
  const dest = localPhotoPath.split(oldId).join(newId);
  if (dest === localPhotoPath) return localPhotoPath;
  try {
    const info = await getInfoAsync(localPhotoPath);
    if (!info.exists) return dest;
    await makeDirectoryAsync(`${documentDirectory}petitmo_children/`, { intermediates: true }).catch(() => {});
    await copyAsync({ from: localPhotoPath, to: dest });
    await deleteAsync(localPhotoPath, { idempotent: true });
    return dest;
  } catch (e) {
    console.warn('[cloudIdRemap] moveChildProfilePhoto', oldId, newId, e);
    return localPhotoPath;
  }
}

function remapRecordKeys<T extends Record<string, unknown>>(
  rec: T | undefined,
  idMap: Map<string, string>,
): T | undefined {
  if (!rec) return undefined;
  let changed = false;
  const out = { ...rec } as T;
  for (const [oldId, newId] of idMap) {
    if (oldId in out) {
      (out as Record<string, unknown>)[newId] = out[oldId as keyof T];
      delete (out as Record<string, unknown>)[oldId];
      changed = true;
    }
  }
  return changed ? out : rec;
}

/**
 * Supabase exige des UUID pour `children.id` et `memories.id`.
 * Les profils créés en gratuit avec le repli `ch_*` / `loc_*` doivent être remappés avant la sync cloud.
 */
export async function remapLegacyEntityIdsForCloudSync(): Promise<LegacyIdRemapReport> {
  const report: LegacyIdRemapReport = {
    childrenRemapped: 0,
    memoriesRemapped: 0,
    booksPatched: 0,
  };

  const childIdMap = new Map<string, string>();

  for (const child of listLocalChildren()) {
    if (isPetitmoUuid(child.id)) continue;
    const newId = newPetitmoEntityId();
    childIdMap.set(child.id, newId);

    const localPhotoPath = await moveChildProfilePhoto(child.id, newId, child.local_photo_path ?? null);

    for (const memory of getAllLocalMemories()) {
      if (memory.child_id !== child.id) continue;
      upsertLocalMemory({ ...memory, child_id: newId });
    }

    upsertLocalChild({
      ...child,
      id: newId,
      local_photo_path: localPhotoPath,
    });
    deleteLocalChild(child.id);
    report.childrenRemapped += 1;

    const selected = await getSelectedChild();
    if (selected === child.id) {
      await setSelectedChild(newId);
    }
  }

  const memoryIdMap = new Map<string, string>();

  for (const memory of getAllLocalMemories()) {
    if (isPetitmoUuid(memory.id)) continue;
    const newId = newPetitmoEntityId();
    memoryIdMap.set(memory.id, newId);

    await moveMemorySandboxDir(memory.id, newId);
    await remapFeedLocalCacheForMemoryId(memory.id, newId);

    const updated = remapMemoryPathsForId(memory, memory.id, newId);
    upsertLocalMemory(updated);
    deleteLocalMemory(memory.id);
    report.memoriesRemapped += 1;
  }

  if (memoryIdMap.size === 0 && childIdMap.size === 0) {
    return report;
  }

  for (const book of listLocalBooks()) {
    const newMemoryIds = (book.memoryIds ?? []).map(id => memoryIdMap.get(id) ?? id);
    const newRotations = remapRecordKeys(book.rotations, memoryIdMap);
    const newPhotoCrops = remapRecordKeys(book.photoCrops, memoryIdMap);
    const newTextEdits = remapRecordKeys(book.textEdits, memoryIdMap);
    const newMemoryPhotoRefs = remapRecordKeys(book.memoryPhotoRefs, memoryIdMap);

    const memChanged = newMemoryIds.some((id, i) => id !== (book.memoryIds ?? [])[i]);
    const metaChanged =
      newRotations !== book.rotations ||
      newPhotoCrops !== book.photoCrops ||
      newTextEdits !== book.textEdits ||
      newMemoryPhotoRefs !== book.memoryPhotoRefs;

    if (!memChanged && !metaChanged) continue;

    upsertLocalBook({
      ...book,
      memoryIds: newMemoryIds,
      rotations: newRotations,
      photoCrops: newPhotoCrops,
      textEdits: newTextEdits,
      memoryPhotoRefs: newMemoryPhotoRefs,
    });
    report.booksPatched += 1;
  }

  if (__DEV__ && (report.childrenRemapped > 0 || report.memoriesRemapped > 0)) {
    console.log('[cloudIdRemap]', report);
  }

  if (memoryIdMap.size > 0) {
    await remapBookQrTokensOnCloudAfterIdRemap(memoryIdMap);
  }

  return report;
}

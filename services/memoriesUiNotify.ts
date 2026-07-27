import { DeviceEventEmitter } from 'react-native';
import { getLocalMemoryById } from '@/lib/localDb';
import type { Memory } from '@/types/local';
import { filMemoryVisualEqual } from '@/utils/feedHelpers';

/**
 * Après upsert SQLite post-sync : n’émet `petitmo:memories-updated` que si
 * l’affichage local a changé. Remplir `thumb_url` / `sync_status` ne doit
 * **jamais** faire tressauter le fil / Capturer.
 */
export function emitMemoriesUpdatedIfVisualChanged(
  memoryId: string,
  before: Memory | null | undefined,
): void {
  const id = memoryId.trim();
  if (!id) return;
  const after = getLocalMemoryById(id);
  if (!after) return;
  if (before && filMemoryVisualEqual(before, after)) return;
  DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
}

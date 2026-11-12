import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalMemoryById } from '@/lib/localDb';

const STORAGE_KEY = 'petitmo:pendingVideoPosterPrintIds';

const inMemory = new Set<string>();

async function persistSet(): Promise<void> {
  try {
    const ids = [...inMemory];
    if (ids.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* */
  }
}

async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const id of parsed) {
      if (typeof id === 'string' && id.trim()) inMemory.add(id.trim());
    }
  } catch {
    /* */
  }
}

/** Frame livre choisie localement mais pas encore en `poster_print_url` cloud. */
export function markPendingVideoPosterPrintCloud(memoryId: string): void {
  const id = memoryId.trim();
  if (!id) return;
  inMemory.add(id);
  void persistSet();
}

export function clearPendingVideoPosterPrintCloud(memoryId: string): void {
  const id = memoryId.trim();
  if (!id) return;
  if (!inMemory.delete(id)) return;
  void persistSet();
}

/**
 * Retry silencieux (boot / flush) — local-first : UI déjà OK via sandbox.
 */
export async function flushPendingVideoPosterPrints(): Promise<void> {
  await hydrate();
  if (inMemory.size === 0) return;

  const { persistVideoPosterToCloudForPdfExport } = await import('@/services/media');
  const { pickFirstReadableLocalMediaUri } = await import('@/utils/localMediaReadable');
  const { collectVideoPosterLocalUploadUriCandidates } = await import('@/utils/memoryPhotos');

  for (const id of [...inMemory]) {
    const row = getLocalMemoryById(id);
    if (!row || row.type !== 'video') {
      inMemory.delete(id);
      continue;
    }
    const local =
      (await pickFirstReadableLocalMediaUri(collectVideoPosterLocalUploadUriCandidates(row))) ||
      (row.local_poster_print_path ?? '').trim();
    if (!local || /^https?:\/\//i.test(local)) {
      // Déjà cloud ou fichier perdu — ne pas bloquer la file.
      inMemory.delete(id);
      continue;
    }
    try {
      const url = await persistVideoPosterToCloudForPdfExport(id, row.child_id, local, {
        forceUpload: true,
        asPrintPoster: true,
        retriggerProcessMemory: false,
      });
      if (url) inMemory.delete(id);
    } catch (e) {
      console.warn('[pendingVideoPosterPrint]', id, e);
    }
  }
  await persistSet();
}

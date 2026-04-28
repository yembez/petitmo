import { getLocalMemories } from '@/lib/localDb'
import type { Memory } from '@/types/local'
import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy'

export async function deleteLocalMediaFiles(memory: Memory): Promise<void> {
  const paths: Array<string | null> = [memory.local_media_path]

  for (const path of paths) {
    if (!path) continue
    try {
      const info = await getInfoAsync(path)
      if (info.exists) {
        await deleteAsync(path, { idempotent: true })
      }
    } catch {
      // Silencieux — fichier déjà supprimé ou inaccessible
    }
  }
}

export async function cleanOrphanedLocalFiles(childId: string): Promise<void> {
  const memories = getLocalMemories(childId)
  const knownPaths = new Set(
    memories
      .map(m => m.local_media_path)
      .filter((p): p is string => !!p)
  )

  const cacheDir = cacheDirectory
  if (!cacheDir) return

  try {
    const files = await readDirectoryAsync(cacheDir)
    for (const file of files) {
      const fullPath = `${cacheDir}${file}`
      if (!knownPaths.has(fullPath)) {
        await deleteAsync(fullPath, { idempotent: true })
      }
    }
  } catch {
    // Silencieux
  }
}


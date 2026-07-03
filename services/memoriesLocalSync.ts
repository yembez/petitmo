import { supabase } from '@/lib/supabase'
import { getCachedUserMode } from '@/lib/userMode'
import {
  getAllLocalMemories,
  getLocalMemories,
  getLocalMemoryById,
  listLocalChildren,
  upsertLocalMemories,
} from '@/lib/localDb'
import type { Memory } from '@/types/local'
import { mergeServerMemoryRowWithExistingLocal } from '@/services/memoryRowMapping'
import {
  healDeadLocalMediaPointersForMemories,
  reconcileFavoritesAfterCloudSync,
} from '@/services/memoryDisplayHeal'

/**
 * Télécharge les souvenirs de l’enfant depuis Supabase et les enregistre dans le SQLite local.
 * Utilisé par le fil (arrière-plan) et par les contrôles de limite gratuite (décompte **local** après sync).
 */
export async function pullMemoriesFromRemoteToLocal(childId: string): Promise<Memory[]> {
  if ((await getCachedUserMode()) === 'local') {
    return getLocalMemories(childId)
  }

  const localBefore = getLocalMemories(childId)

  try {
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false })

    if (error || !data) return localBefore

    /** Cloud vide mais souvenirs locaux présents (migration en cours) : ne pas masquer le fil. */
    if (data.length === 0 && localBefore.length > 0) {
      return localBefore
    }

    const withLocal: Memory[] = data.map(row => {
      const existing = getLocalMemoryById(row.id)
      return {
        ...mergeServerMemoryRowWithExistingLocal(row, existing),
        sync_status: 'synced' as const,
      }
    })
    upsertLocalMemories(withLocal, 'full')

    await healDeadLocalMediaPointersForMemories(withLocal, { max: 64 })
    await reconcileFavoritesAfterCloudSync()

    const remoteIds = new Set(withLocal.map(m => m.id))
    const localOnly = localBefore.filter(m => !remoteIds.has(m.id))
    return localOnly.length > 0 ? [...withLocal, ...localOnly] : withLocal
  } catch {
    return localBefore
  }
}

/** Aligne SQLite sur le cloud pour **tous** les enfants locaux, puis renvoie le fil famille. */
export async function pullFamilyMemoriesFromRemoteToLocal(): Promise<Memory[]> {
  if ((await getCachedUserMode()) === 'local') {
    return getAllLocalMemories()
  }

  const children = listLocalChildren()
  await Promise.all(children.map(c => pullMemoriesFromRemoteToLocal(c.id)))
  return getAllLocalMemories()
}

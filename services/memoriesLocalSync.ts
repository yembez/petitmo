import { supabase } from '@/lib/supabase'
import { getCachedUserMode } from '@/lib/userMode'
import { getLocalMemories, getLocalMemoryById, upsertLocalMemories } from '@/lib/localDb'
import type { Memory } from '@/types/local'
import { mergeServerMemoryRowWithExistingLocal } from '@/services/memoryRowMapping'

/**
 * Télécharge les souvenirs de l’enfant depuis Supabase et les enregistre dans le SQLite local.
 * Utilisé par le fil (arrière-plan) et par les contrôles de limite gratuite (décompte **local** après sync).
 */
export async function pullMemoriesFromRemoteToLocal(childId: string): Promise<Memory[]> {
  if ((await getCachedUserMode()) === 'local') {
    return getLocalMemories(childId)
  }

  try {
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false })

    if (error || !data) return getLocalMemories(childId)

    const withLocal: Memory[] = data.map(row => {
      const existing = getLocalMemoryById(row.id)
      return {
        ...mergeServerMemoryRowWithExistingLocal(row, existing),
        sync_status: 'synced' as const,
      }
    })
    upsertLocalMemories(withLocal, 'full')
    return withLocal
  } catch {
    return getLocalMemories(childId)
  }
}

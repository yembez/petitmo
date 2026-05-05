import { getUserTier } from '@/lib/userTier'
import { getCachedUserMode } from '@/lib/userMode'
import { getLocalMemories } from '@/lib/localDb'
import { pullMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync'

export const FREE_TIER_LIMIT = 20
export const FREE_TIER_VIDEO_LIMIT = 10
export const FREE_TIER_VIDEO_MAX_DURATION = 30 // secondes
export const FREE_TIER_VOICE_MAX_DURATION = 120 // secondes (création de souvenirs audio)
export const FREE_TIER_BOOK_VOICE_MAX_DURATION = 60 // secondes (livres : QR audio)
/** Max souvenirs audio avec QR dans un livre / PDF (plan gratuit). Aligné serveur `FREE_TIER_QR_AV_MAX_PER_BOOK`. */
export const FREE_TIER_BOOK_AUDIO_MAX_COUNT = 5

/**
 * Largeur max (px) côté client pour le dérivé photo « print » (`print_*`) et pour les covers vocales
 * envoyées au livre / PDF — même cible A5 que `stratifiedUpload` (photo).
 */
export const MEDIA_BOOK_PRINT_MAX_WIDTH = 1600

export type LimitCheck = {
  canCreate: boolean
  current: number
  limit: number
  isAtLimit: boolean
}

/**
 * Limite gratuite : décompte **uniquement** sur le SQLite local (`memories`).
 * Avant le décompte, on aligne le local sur Supabase (même principe que le fil au premier sync)
 * pour que « 20 souvenirs » corresponde à ce que l’utilisateur voit, sans utiliser un count distant.
 */
export async function checkMemoryLimit(childId: string): Promise<LimitCheck> {
  const tier = await getUserTier()

  if (tier === 'paid') {
    return {
      canCreate: true,
      current: 0,
      limit: Infinity,
      isAtLimit: false,
    }
  }

  try {
    if ((await getCachedUserMode()) === 'cloud') {
      await pullMemoriesFromRemoteToLocal(childId)
    }
  } catch {
    // hors ligne : on garde le décompte local actuel
  }

  const memories = getLocalMemories(childId)
  const current = memories.length

  console.log('[limits] checkMemoryLimit called', {
    childId,
    tier,
    localCount: memories.length,
    canCreate: current < FREE_TIER_LIMIT,
    FREE_TIER_LIMIT,
    firstFewIds: memories.slice(0, 3).map(m => m.id),
  })

  return {
    canCreate: current < FREE_TIER_LIMIT,
    current,
    limit: FREE_TIER_LIMIT,
    isAtLimit: current >= FREE_TIER_LIMIT,
  }
}

export async function checkVideoLimit(
  childId: string
): Promise<{
  canCreate: boolean
  current: number
  limit: number
  isAtLimit: boolean
}> {
  const tier = await getUserTier()

  if (tier === 'paid') {
    return {
      canCreate: true,
      current: 0,
      limit: Infinity,
      isAtLimit: false,
    }
  }

  try {
    if ((await getCachedUserMode()) === 'cloud') {
      await pullMemoriesFromRemoteToLocal(childId)
    }
  } catch {
    // hors ligne
  }

  const memories = getLocalMemories(childId)
  const videoCount = memories.filter(m => m.type === 'video').length

  return {
    canCreate: videoCount < FREE_TIER_VIDEO_LIMIT,
    current: videoCount,
    limit: FREE_TIER_VIDEO_LIMIT,
    isAtLimit: videoCount >= FREE_TIER_VIDEO_LIMIT,
  }
}

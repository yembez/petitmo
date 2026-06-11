import { getUserTier } from '@/lib/userTier'
import { getCachedUserMode } from '@/lib/userMode'
import { getAllLocalMemories } from '@/lib/localDb'
import { pullFamilyMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync'

/** TEST ONLY — prod : 50. Valeur réduite à 20 pour faciliter les tests en développement. Ne pas changer sans décision produit explicite. */
export const FREE_TIER_LIMIT = 20
/** TEST ONLY — prod : 5. */
export const FREE_TIER_VIDEO_LIMIT = 5
export const FREE_TIER_VIDEO_MAX_DURATION = 30 // secondes
export const FREE_TIER_VOICE_LIMIT = 5 // max souvenirs audio en gratuit
export const FREE_TIER_VOICE_MAX_DURATION = 60 // secondes (création de souvenirs audio)
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

const FAMILY_LIMIT_CACHE_KEY = '__family__'
let memoryLimitCache: { childId: string; at: number; result: LimitCheck } | null = null
const MEMORY_LIMIT_CACHE_MS = 400

/** À appeler après insertion locale d’un souvenir (le décompte a changé). */
export function invalidateMemoryLimitCache(_childId?: string): void {
  memoryLimitCache = null
}

/**
 * Limite gratuite : décompte **uniquement** sur le SQLite local (`memories`).
 * Avant le décompte, on aligne le local sur Supabase (même principe que le fil au premier sync)
 * pour que « 20 souvenirs » corresponde à ce que l’utilisateur voit, sans utiliser un count distant.
 */
export async function checkMemoryLimit(
  childId: string,
  opts?: { force?: boolean }
): Promise<LimitCheck> {
  const id = childId.trim()
  const now = Date.now()
  if (
    !opts?.force &&
    memoryLimitCache &&
    memoryLimitCache.childId === FAMILY_LIMIT_CACHE_KEY &&
    now - memoryLimitCache.at < MEMORY_LIMIT_CACHE_MS
  ) {
    return memoryLimitCache.result
  }

  const tier = await getUserTier()

  if (tier === 'paid') {
    const paid: LimitCheck = {
      canCreate: true,
      current: 0,
      limit: Infinity,
      isAtLimit: false,
    }
    memoryLimitCache = { childId: FAMILY_LIMIT_CACHE_KEY, at: now, result: paid }
    return paid
  }

  try {
    if ((await getCachedUserMode()) === 'cloud') {
      await pullFamilyMemoriesFromRemoteToLocal()
    }
  } catch {
    // hors ligne : on garde le décompte local actuel
  }

  const current = getAllLocalMemories().length

  const result: LimitCheck = {
    canCreate: current < FREE_TIER_LIMIT,
    current,
    limit: FREE_TIER_LIMIT,
    isAtLimit: current >= FREE_TIER_LIMIT,
  }
  memoryLimitCache = { childId: FAMILY_LIMIT_CACHE_KEY, at: now, result }
  return result
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
      await pullFamilyMemoriesFromRemoteToLocal()
    }
  } catch {
    // hors ligne
  }

  const videoCount = getAllLocalMemories().filter(m => m.type === 'video').length

  return {
    canCreate: videoCount < FREE_TIER_VIDEO_LIMIT,
    current: videoCount,
    limit: FREE_TIER_VIDEO_LIMIT,
    isAtLimit: videoCount >= FREE_TIER_VIDEO_LIMIT,
  }
}

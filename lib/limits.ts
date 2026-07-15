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
/** Max souvenirs audio avec QR dans un livre / PDF (plan gratuit). */
export const FREE_TIER_BOOK_AUDIO_MAX_COUNT = 5
/** Max souvenirs vidéo dans un livre (plan gratuit). QR cloud après paiement commande/export — spec free-tier-book-qr-av.md */
export const FREE_TIER_BOOK_VIDEO_MAX_COUNT = 5
/** Pages audio+vidéo avec QR par livre (gratuit) = audio max + vidéo max. Aligné `server/src/constants/spec.ts`. */
export const FREE_TIER_BOOK_QR_AV_MAX_PER_BOOK =
  FREE_TIER_BOOK_AUDIO_MAX_COUNT + FREE_TIER_BOOK_VIDEO_MAX_COUNT

/**
 * Largeur max (px) du dérivé **print** livre — local, upload guest PDF, et cloud.
 * 3200 px → ≈ 370–430 DPI sur cadre photo pleine page Gelato (186×210 mm), marge de recadrage incluse.
 */
export const MEDIA_BOOK_PRINT_MAX_WIDTH = 3200

/** Alias historique — même cible que `MEDIA_BOOK_PRINT_MAX_WIDTH`. */
export const MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH = MEDIA_BOOK_PRINT_MAX_WIDTH

/**
 * JPEG upload guest PDF (pages intérieures) : 3200 px + qualité un peu plus basse
 * pour limiter le poids vs l’ancien 1600@0.82.
 */
export const MEDIA_BOOK_PDF_JPEG_QUALITY = 0.78

/** Couverture : un peu plus nette (une seule image, impact poids faible). */
export const MEDIA_BOOK_PDF_COVER_JPEG_QUALITY = 0.85

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

export async function checkVoiceLimit(
  childId: string
): Promise<{
  canCreate: boolean
  current: number
  limit: number
  isAtLimit: boolean
}> {
  void childId
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

  const voiceCount = getAllLocalMemories().filter(m => m.type === 'voice').length

  return {
    canCreate: voiceCount < FREE_TIER_VOICE_LIMIT,
    current: voiceCount,
    limit: FREE_TIER_VOICE_LIMIT,
    isAtLimit: voiceCount >= FREE_TIER_VOICE_LIMIT,
  }
}

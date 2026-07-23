import { getUserTier } from '@/lib/userTier'
import { getCachedUserMode } from '@/lib/userMode'
import { getAllLocalMemories } from '@/lib/localDb'
import { pullFamilyMemoriesFromRemoteToLocal } from '@/services/memoriesLocalSync'

/** Prod : 50. Valeur de test éventuelle à documenter ici si on baisse temporairement. */
export const FREE_TIER_LIMIT = 50
/** TEST ONLY — prod : 5. */
export const FREE_TIER_VIDEO_LIMIT = 5
export const FREE_TIER_VIDEO_MAX_DURATION = 20 // secondes (fil gratuit)
export const FREE_TIER_VOICE_LIMIT = 5 // max souvenirs audio en gratuit
export const FREE_TIER_VOICE_MAX_DURATION = 60 // secondes (création de souvenirs audio)
export const FREE_TIER_BOOK_VOICE_MAX_DURATION = 60 // secondes (livres : QR audio)
/**
 * @deprecated V1 : plus de plafond composition A/V par livre.
 * Facturation QR au checkout (2 inclus + 0,70 €) — `lib/pricingV1.ts`.
 */
export const FREE_TIER_BOOK_AUDIO_MAX_COUNT = Number.MAX_SAFE_INTEGER
/** @deprecated V1 — voir FREE_TIER_BOOK_AUDIO_MAX_COUNT. */
export const FREE_TIER_BOOK_VIDEO_MAX_COUNT = Number.MAX_SAFE_INTEGER
/** @deprecated V1 — plus de plafond serveur 5+5. */
export const FREE_TIER_BOOK_QR_AV_MAX_PER_BOOK = Number.MAX_SAFE_INTEGER

/**
 * Largeur max (px) du dérivé **print** livre — local, upload guest PDF, et cloud.
 * 3200 px → ≈ 370–430 DPI sur cadre photo pleine page Gelato (186×210 mm), marge de recadrage incluse.
 */
export const MEDIA_BOOK_PRINT_MAX_WIDTH = 3200

/** Alias historique — même cible que `MEDIA_BOOK_PRINT_MAX_WIDTH`. */
export const MEDIA_BOOK_LOCAL_PRINT_MAX_WIDTH = MEDIA_BOOK_PRINT_MAX_WIDTH

/**
 * JPEG poster vidéo **fil** (`poster.jpg`) — compression un peu plus légère que le print
 * (poids fil). La résolution suit la frame native.
 */
export const VIDEO_POSTER_FEED_JPEG_QUALITY = 0.9

/**
 * JPEG poster vidéo **livre** (`poster_print.jpg`) — extraction frame max, puis
 * resize largeur 3200 px (comme `print.jpg` photos). Sans upscale, une frame 1080p
 * sur le cadre 186 mm ≈ 147 DPI (bloquant).
 */
export const VIDEO_POSTER_PRINT_JPEG_QUALITY = 1

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

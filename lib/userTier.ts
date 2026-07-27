import AsyncStorage from '@react-native-async-storage/async-storage'
import { invalidateUserModeCache } from '@/lib/userMode'

export type UserTier = 'free' | 'paid'

const USER_TIER_KEY = 'petitmo:userTier'

let tierMemory: UserTier | null = null

export async function setUserTier(tier: UserTier): Promise<void> {
  tierMemory = tier
  await AsyncStorage.setItem(USER_TIER_KEY, tier)
  invalidateUserModeCache()
}

export async function getUserTier(): Promise<UserTier> {
  try {
    const raw = await AsyncStorage.getItem(USER_TIER_KEY)
    const tier: UserTier = raw === 'paid' ? 'paid' : 'free'
    tierMemory = tier
    return tier
  } catch {
    tierMemory = 'free'
    return 'free'
  }
}

/** Lecture sync pour UI (après warm getUserTier / setUserTier). */
export function peekUserTier(): UserTier {
  return tierMemory ?? 'free'
}

/** TEMPORAIRE — tests : supprime le tier stocké (redevient `free` via getUserTier). Retirer l’appel en prod. */
export async function resetUserTierForTesting(): Promise<void> {
  tierMemory = null
  await AsyncStorage.removeItem(USER_TIER_KEY)
}


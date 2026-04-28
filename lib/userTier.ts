import AsyncStorage from '@react-native-async-storage/async-storage'
import { invalidateUserModeCache } from '@/lib/userMode'

export type UserTier = 'free' | 'paid'

const USER_TIER_KEY = 'petitmo:userTier'

export async function setUserTier(tier: UserTier): Promise<void> {
  await AsyncStorage.setItem(USER_TIER_KEY, tier)
  invalidateUserModeCache()
}

export async function getUserTier(): Promise<UserTier> {
  try {
    const raw = await AsyncStorage.getItem(USER_TIER_KEY)
    return raw === 'paid' ? 'paid' : 'free'
  } catch {
    return 'free'
  }
}

/** TEMPORAIRE — tests : supprime le tier stocké (redevient `free` via getUserTier). Retirer l’appel en prod. */
export async function resetUserTierForTesting(): Promise<void> {
  await AsyncStorage.removeItem(USER_TIER_KEY)
}


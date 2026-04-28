import AsyncStorage from '@react-native-async-storage/async-storage'
import { getUserTier } from '@/lib/userTier'

const INSTALL_KEY = 'petitmo_installed_at'
const LAST_NUDGE_KEY = 'petitmo_last_nudge'

export async function recordInstallDate(): Promise<void> {
  const existing = await AsyncStorage.getItem(INSTALL_KEY)
  if (!existing) {
    await AsyncStorage.setItem(INSTALL_KEY, new Date().toISOString())
  }
}

export async function getTimingNudge(): Promise<'DAY_30' | 'DAY_60' | 'DAY_90' | null> {
  const tier = await getUserTier()
  if (tier === 'paid') return null

  const installStr = await AsyncStorage.getItem(INSTALL_KEY)
  if (!installStr) return null

  const lastNudgeStr = await AsyncStorage.getItem(LAST_NUDGE_KEY)
  const lastNudge = lastNudgeStr ? new Date(lastNudgeStr) : null

  // Ne pas afficher plus d'une fois par semaine
  if (lastNudge) {
    const daysSinceNudge = (Date.now() - lastNudge.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceNudge < 7) return null
  }

  const installDate = new Date(installStr)
  const daysSinceInstall = (Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24)

  if (daysSinceInstall >= 90) return 'DAY_90'
  if (daysSinceInstall >= 60) return 'DAY_60'
  if (daysSinceInstall >= 30) return 'DAY_30'
  return null
}

export async function markNudgeSeen(): Promise<void> {
  await AsyncStorage.setItem(LAST_NUDGE_KEY, new Date().toISOString())
}


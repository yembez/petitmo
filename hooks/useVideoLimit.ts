import { useState, useCallback } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import {
  checkVideoLimit,
  FREE_TIER_VIDEO_MAX_DURATION,
  PAID_TIER_VIDEO_MAX_DURATION,
} from '@/lib/limits'
import { getUserTier } from '@/lib/userTier'

export function useVideoLimit(childId: string | null) {
  const [videoLimit, setVideoLimit] = useState({
    canCreate: true,
    current: 0,
    limit: 10,
    isAtLimit: false,
  })
  const [maxDuration, setMaxDuration] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!childId) return
    const [result, tier] = await Promise.all([
      checkVideoLimit(childId),
      getUserTier(),
    ])
    setVideoLimit(result)
    setMaxDuration(
      tier === 'free' ? FREE_TIER_VIDEO_MAX_DURATION : PAID_TIER_VIDEO_MAX_DURATION,
    )
  }, [childId])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { videoLimit, maxDuration, refresh }
}


import { useState, useCallback } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { checkMemoryLimit, type LimitCheck } from '@/lib/limits'

export function useMemoryLimit(childId: string | null) {
  const [limit, setLimit] = useState<LimitCheck>({
    canCreate: true,
    current: 0,
    limit: 50,
    isAtLimit: false,
  })

  const refresh = useCallback(async () => {
    if (!childId) return
    const result = await checkMemoryLimit(childId)
    setLimit(result)
  }, [childId])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { limit, refresh }
}


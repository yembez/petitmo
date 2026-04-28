import { useState, useCallback } from 'react'
import { upgradeToFullCloud, type MigrationProgress } from '@/services/migration'

export function useMigrationProgress() {
  const [progress, setProgress] = useState<MigrationProgress>({
    total: 0,
    done: 0,
    current: null,
    status: 'idle',
  })

  const startMigration = useCallback(async () => {
    await upgradeToFullCloud(setProgress)
  }, [])

  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return {
    progress,
    progressPercent,
    startMigration,
    isRunning: progress.status === 'running',
    isDone: progress.status === 'done',
  }
}


import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { Memory } from '@/utils/feedHelpers';

export function useFilLayout(args: {
  memories: Memory[];
}): {
  postHeights: number[];
  setPostHeights: Dispatch<SetStateAction<number[]>>;
} {
  const [postHeights, setPostHeights] = useState<number[]>([]);

  const memoryIdsKey = useMemo(() => args.memories.map(m => m.id).join('|'), [args.memories]);

  useEffect(() => {
    const n = memoryIdsKey ? memoryIdsKey.split('|').length : 0;
    setPostHeights(prev => {
      if (n === 0) return [];
      if (n > prev.length) {
        const added = n - prev.length;
        return [...Array(added).fill(0), ...prev].slice(0, n);
      }
      if (n < prev.length) {
        return prev.slice(0, n);
      }
      return prev;
    });
  }, [memoryIdsKey]);

  return {
    postHeights,
    setPostHeights,
  };
}

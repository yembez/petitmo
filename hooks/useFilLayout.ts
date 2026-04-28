import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useFeedSnap } from '@/hooks/useFeedSnap';
import type { Memory } from '@/utils/feedHelpers';

export function useFilLayout(args: {
  memories: Memory[];
  insetsTop: number;
  insetsBottom: number;
}): {
  postHeights: number[];
  setPostHeights: Dispatch<SetStateAction<number[]>>;
  feedViewportHeight: number;
  onFeedViewportLayout: (e: LayoutChangeEvent) => void;
  snapOffsets: number[] | undefined;
  headerSnapOffsetsIos: number[] | undefined;
} {
  const [postHeights, setPostHeights] = useState<number[]>([]);
  const [feedViewportHeight, setFeedViewportHeight] = useState(0);

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

  const onFeedViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    setFeedViewportHeight(prev => (Math.abs(h - prev) > 1 ? h : prev));
  }, []);

  const { snapOffsets, headerSnapOffsetsIos } = useFeedSnap({
    memories: args.memories,
    postHeights,
    feedViewportHeight,
    insets: { top: args.insetsTop, bottom: args.insetsBottom },
  });

  return {
    postHeights,
    setPostHeights,
    feedViewportHeight,
    onFeedViewportLayout,
    snapOffsets,
    headerSnapOffsetsIos,
  };
}

import { useRef } from 'react';
import type { ViewToken } from 'react-native';

export type ViewabilityConfigLike = {
  itemVisiblePercentThreshold?: number;
  minimumViewTime?: number;
  waitForInteraction?: boolean;
};

type ViewabilityInfo = {
  viewableItems: ViewToken[];
  changed: ViewToken[];
};

/**
 * FlatList / FlashList exigent `viewabilityConfigCallbackPairs` pour que
 * `onViewableItemsChanged` soit appelé de façon fiable (RN récents).
 */
export function useStableViewabilityPairs(
  viewabilityConfig: ViewabilityConfigLike,
  onViewableItemsChanged: (info: ViewabilityInfo) => void,
) {
  const handlerRef = useRef(onViewableItemsChanged);
  handlerRef.current = onViewableItemsChanged;

  const pairsRef = useRef([
    {
      viewabilityConfig,
      onViewableItemsChanged: (info: ViewabilityInfo) => {
        handlerRef.current(info);
      },
    },
  ]);

  return pairsRef.current;
}

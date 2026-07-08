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

type ViewabilityPairSpec = {
  viewabilityConfig: ViewabilityConfigLike;
  onViewableItemsChanged: (info: ViewabilityInfo) => void;
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

/** Plusieurs configs viewability (ex. seuil présence 1 % + autoplay 25 %). */
export function useStableViewabilityPairsMulti(specs: ViewabilityPairSpec[]) {
  const handlersRef = useRef(specs.map(s => s.onViewableItemsChanged));
  handlersRef.current = specs.map(s => s.onViewableItemsChanged);

  const pairsRef = useRef(
    specs.map((spec, index) => ({
      viewabilityConfig: spec.viewabilityConfig,
      onViewableItemsChanged: (info: ViewabilityInfo) => {
        handlersRef.current[index]?.(info);
      },
    })),
  );

  return pairsRef.current;
}

import { useMemo } from 'react';
import { Platform, Dimensions } from 'react-native';
import { verticalScale, scale } from '@/utils/responsive';
import type { Memory } from '@/utils/feedHelpers';
import { DAY_SEPARATOR_BLOCK_H } from '@/components/feed/feedStyles';

/** Le snap du feed peut donner un magnétisme désagréable (surtout iOS) → désactivé. */
const ENABLE_FEED_SNAP = false;
/** Snap (iOS) uniquement sur le début de chaque post (zone date). */
const ENABLE_HEADER_NATIVE_SNAP_IOS = true;
/** Petit espace au-dessus de l’en-tête quand le snap se déclenche */
const SNAP_MAGNET_ABOVE_HEADER = verticalScale(8);
/** Post plus haut que le fil visible : on ajoute un 2ᵉ point de snap en bas pour voir les actions */
const SNAP_LONG_POST_EXTRA = scale(48);
/** Évite deux offsets quasi identiques (arrondi) */
const SNAP_MIN_GAP = scale(20);

export type FeedSnapInsets = { top: number; bottom: number };

export function useFeedSnap(args: {
  memories: Memory[];
  postHeights: number[];
  feedViewportHeight: number;
  insets: FeedSnapInsets;
}): { snapOffsets: number[] | undefined; headerSnapOffsetsIos: number[] | undefined } {
  const { memories, postHeights, feedViewportHeight, insets } = args;

  const memoryIdsKey = useMemo(() => memories.map(m => m.id).join('|'), [memories]);

  const snapOffsets = useMemo(() => {
    if (!ENABLE_FEED_SNAP) return undefined;
    if (memories.length === 0) return undefined;
    const FALLBACK_H = verticalScale(280);
    const windowH = Dimensions.get('window').height;
    const viewportGuess = Math.max(
      verticalScale(260),
      windowH - insets.top - insets.bottom - verticalScale(96)
    );
    const viewport =
      feedViewportHeight > 96 ? feedViewportHeight : viewportGuess;

    const offsets = new Set<number>();
    offsets.add(0);

    let acc = 0;
    for (let i = 0; i < memories.length; i++) {
      const insetBeforeContent = DAY_SEPARATOR_BLOCK_H;
      const headerSnap = Math.round(
        Math.max(0, acc + insetBeforeContent - SNAP_MAGNET_ABOVE_HEADER)
      );
      offsets.add(headerSnap);

      const h = postHeights[i] > 8 ? postHeights[i] : FALLBACK_H;
      const startOfPost = acc;

      if (h > viewport + SNAP_LONG_POST_EXTRA) {
        const bottomSnap = Math.round(startOfPost + h - viewport);
        if (bottomSnap > headerSnap + SNAP_MIN_GAP) {
          offsets.add(Math.max(0, bottomSnap));
        }
      }

      acc += h;
    }

    return Array.from(offsets).sort((a, b) => a - b);
  }, [memoryIdsKey, memories, postHeights, feedViewportHeight, insets.top, insets.bottom]);

  const headerSnapOffsetsIos = useMemo(() => {
    if (!ENABLE_HEADER_NATIVE_SNAP_IOS) return undefined;
    if (Platform.OS !== 'ios') return undefined;
    if (memories.length === 0) return undefined;
    if (postHeights.length !== memories.length) return undefined;
    if (postHeights.some(h => h <= 0)) return undefined;

    const windowH = Dimensions.get('window').height;
    const viewportGuess = Math.max(
      verticalScale(260),
      windowH - insets.top - insets.bottom - verticalScale(96)
    );
    const viewport = feedViewportHeight > 96 ? feedViewportHeight : viewportGuess;

    const offsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < memories.length; i++) {
      const headerSnap = Math.round(Math.max(0, acc - SNAP_MAGNET_ABOVE_HEADER));
      offsets.push(headerSnap);

      const h = postHeights[i];
      if (h > viewport + SNAP_LONG_POST_EXTRA) {
        const bottomSnap = Math.round(Math.max(0, acc + h - viewport));
        if (bottomSnap > headerSnap + SNAP_MIN_GAP) offsets.push(bottomSnap);
      }

      acc += h;
    }

    const uniq = Array.from(new Set(offsets)).sort((a, b) => a - b);
    const filtered: number[] = [];
    for (const off of uniq) {
      const last = filtered[filtered.length - 1];
      if (last === undefined || off - last >= SNAP_MIN_GAP) filtered.push(off);
    }
    return filtered.length > 1 ? filtered : undefined;
  }, [memories.length, postHeights, feedViewportHeight, insets.top, insets.bottom]);

  return { snapOffsets, headerSnapOffsetsIos };
}

export { ENABLE_FEED_SNAP };

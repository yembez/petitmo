import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

type Props = {
  children: React.ReactNode;
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
  /** Bloque le scroll parent (ex. FlatList paging) pendant un scroll interne. */
  onInnerScrollLock?: () => void;
  onInnerScrollUnlock?: () => void;
};

/**
 * Zone de texte à hauteur plafonnée avec défilement vertical interne.
 * ScrollView RNGH + viewport borné : requis pour le nested scroll (fil / viewer).
 */
export function ScrollableTextBlock({
  children,
  maxHeight,
  style,
  contentContainerStyle,
  showsVerticalScrollIndicator = true,
  onInnerScrollLock,
  onInnerScrollUnlock,
}: Props) {
  const scrollableRef = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(maxHeight);

  const handleContentSizeChange = useCallback(
    (_w: number, contentHeight: number) => {
      const needsScroll = contentHeight > maxHeight + 1;
      scrollableRef.current = needsScroll;
      const nextViewport = needsScroll
        ? maxHeight
        : Math.min(maxHeight, Math.max(1, Math.ceil(contentHeight)));
      setViewportHeight(prev => (prev === nextViewport ? prev : nextViewport));
    },
    [maxHeight],
  );

  const handleScrollBegin = useCallback(() => {
    if (scrollableRef.current) onInnerScrollLock?.();
  }, [onInnerScrollLock]);

  const handleScrollEnd = useCallback(() => {
    if (scrollableRef.current) onInnerScrollUnlock?.();
  }, [onInnerScrollUnlock]);

  return (
    <View style={[styles.host, { maxHeight }, style]}>
      <ScrollView
        style={[styles.scroll, { height: viewportHeight }]}
        contentContainerStyle={contentContainerStyle}
        nestedScrollEnabled
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={handleScrollBegin}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'hidden',
  },
  scroll: {
    flexGrow: 0,
  },
});

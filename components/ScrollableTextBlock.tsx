import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

type Props = {
  children: React.ReactNode;
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
  /** Tap (sans scroll) — ex. ouvrir la vue immersive depuis un souvenir texte. */
  onPress?: () => void;
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
  onPress,
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

  const content = onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir en plein écran"
    >
      {children}
    </Pressable>
  ) : (
    children
  );

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
        {content}
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

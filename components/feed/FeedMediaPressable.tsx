import { forwardRef, type ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Press média fil — **sans** scale/opacity animés.
 * Tout transform sur l’hôte immersif fausse la mesure shared-element
 * et provoque saccades / flash au retour.
 */
const FeedMediaPressable = forwardRef<View, Props>(function FeedMediaPressable(
  { children, style, ...pressableProps },
  ref,
) {
  return (
    <Pressable ref={ref} collapsable={false} {...pressableProps} style={style}>
      {children}
    </Pressable>
  );
});

export default FeedMediaPressable;

import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  FIXED_TAB_BAR_SLOTS,
  normalizeMainTabRoute,
  type MainTabRoute,
} from '@/constants/contextualTabBar';
import { THEME } from '@/constants/theme';
import CaptureTabPlusIcon from '@/components/CaptureTabPlusIcon';
import {
  TAB_BAR_BACKGROUND,
  TAB_BAR_BORDER_WIDTH,
  TAB_BAR_CONTAINER_BORDER,
  TAB_BAR_PADDING_TOP,
  getTabBarTotalHeight,
  tabBarContentPaddingBottom,
  tabBarFloatBottomPosition,
} from '@/constants/tabBarLayout';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { hapticSelection } from '@/lib/haptics';
import { scale, verticalScale } from '@/utils/responsive';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import {
  peekFavorisAddToBookSession,
  subscribeFavorisAddToBookSession,
} from '@/services/favorisBookAddFlow';

const TAB_ICON_SIZE = scale(24);
const TAB_ICON_ROW_H = scale(28);
/** Disque Capturer hors écran : un peu plus grand que la ligne d’icônes. */
const TAB_CAPTURE_PLUS_DISC = scale(34);
/** Contour du disque Capturer (teinte unie = onglets inactifs). */
const TAB_CAPTURE_RING_WIDTH = scale(2);
/**
 * Le disque dépasse la ligne d’icônes : sans ce léger basculement, le « + »
 * et « Capturer » paraissent trop hauts par rapport aux autres onglets.
 */
const TAB_CAPTURE_NUDGE_Y = verticalScale(2);
const TAB_LABEL_LINE_H = scale(12);
const TAB_ICON_LABEL_GAP = verticalScale(1);

/** Zoom actif type Marmo — scale progressif icône + label. */
const TAB_ACTIVE_SCALE = 1.12;
const TAB_SPRING = { damping: 18, stiffness: 220, mass: 0.75 } as const;

const TAB_META: Record<
  MainTabRoute,
  { titleKey: 'tabs.capture' | 'tabs.journal' | 'tabs.favorites' | 'tabs.books'; Icon: LucideIcon }
> = {
  index: { titleKey: 'tabs.capture', Icon: Plus },
  fil: { titleKey: 'tabs.journal', Icon: List },
  favoris: { titleKey: 'tabs.favorites', Icon: Heart },
  livres: { titleKey: 'tabs.books', Icon: BookOpenText },
};

type SlotLayout = { x: number; y: number; width: number; height: number };
type ContentSize = { width: number; height: number };

type Props = BottomTabBarProps & {
  tabLabelFontRegular?: string;
  tabLabelFontMedium?: string;
};

function TabBarGlyph({
  Icon,
  focused,
  color,
  captureHighlight = false,
}: {
  Icon: LucideIcon;
  focused: boolean;
  color: string;
  /** Disque + « + » hors écran Capturer (même teinte que les onglets inactifs). */
  captureHighlight?: boolean;
}) {
  if (captureHighlight) {
    return (
      <View
        style={[styles.iconWrap, styles.iconWrapCaptureHighlight]}
        accessibilityElementsHidden
      >
        <CaptureTabPlusIcon
          size={TAB_CAPTURE_PLUS_DISC}
          plusSize={TAB_ICON_SIZE}
          ringWidth={TAB_CAPTURE_RING_WIDTH}
          plusStrokeWidth={focused ? 2.25 : 2}
          color={THEME.tabBarInactiveTint}
        />
      </View>
    );
  }

  return (
    <View style={styles.iconWrap}>
      <Icon size={TAB_ICON_SIZE} color={color} fill="none" strokeWidth={focused ? 2.4 : 2} />
    </View>
  );
}

function PetitmoTabBarButton({
  children,
  onSlotLayout,
  ...props
}: ComponentProps<typeof PlatformPressable> & {
  onSlotLayout?: (layout: SlotLayout) => void;
}) {
  const { style, 'aria-selected': isActive, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { backgroundColor: _navBg, ...navStyle } = flatStyle;

  return (
    <View
      style={styles.tabBarButtonSlot}
      onLayout={e => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onSlotLayout?.({ x, y, width, height });
      }}
    >
      <PlatformPressable
        {...rest}
        aria-selected={isActive}
        style={[styles.tabBarPressableBase, navStyle]}
      >
        {children}
      </PlatformPressable>
    </View>
  );
}

function TabBarItemContent({
  focused,
  tint,
  label,
  Icon,
  captureHighlight,
  tabLabelFontRegular,
  tabLabelFontMedium,
  onContentLayout,
}: {
  focused: boolean;
  tint: string;
  label: string;
  Icon: LucideIcon;
  captureHighlight: boolean;
  tabLabelFontRegular?: string;
  tabLabelFontMedium?: string;
  onContentLayout: (size: ContentSize) => void;
}) {
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, TAB_SPRING);
  }, [focused, progress]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * (TAB_ACTIVE_SCALE - 1) }],
  }));

  return (
    <View
      style={styles.tabItemFrame}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        onContentLayout({ width, height });
      }}
    >
      <Animated.View style={[styles.tabItemZoom, zoomStyle]}>
        <TabBarGlyph
          Icon={Icon}
          focused={focused}
          color={tint}
          captureHighlight={captureHighlight}
        />
        <Text
          style={[
            styles.tabLabel,
            loadedFontStyle(tabLabelFontRegular) ?? { fontWeight: '400' },
            focused
              ? [styles.tabLabelActive, loadedFontStyle(tabLabelFontMedium) ?? { fontWeight: '500' }]
              : null,
            { color: tint },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

function resolveActiveSlotIndex(state: BottomTabBarProps['state']): number {
  const activeName = normalizeMainTabRoute(state.routes[state.index]?.name);
  const slot = FIXED_TAB_BAR_SLOTS.indexOf(activeName);
  return slot >= 0 ? slot : 0;
}

export default function PetitmoContextTabBar({
  state,
  descriptors,
  navigation,
  insets,
  tabLabelFontRegular,
  tabLabelFontMedium,
}: Props) {
  const { t } = useAppTranslation('common');
  const activeRoute = normalizeMainTabRoute(state.routes[state.index]?.name);
  const activeSlotIndex = resolveActiveSlotIndex(state);
  const favorisAddToBookSessionId = useSyncExternalStore(
    subscribeFavorisAddToBookSession,
    peekFavorisAddToBookSession,
    peekFavorisAddToBookSession,
  );
  const hideTabBarForBookAddFlow =
    activeRoute === 'favoris' && favorisAddToBookSessionId != null;

  const slotLayouts = useRef<(SlotLayout | null)[]>([null, null, null, null]);
  const contentSizes = useRef<(ContentSize | null)[]>([null, null, null, null]);
  const pillReady = useSharedValue(0);
  const pillX = useSharedValue(0);
  const pillY = useSharedValue(0);
  const pillW = useSharedValue(0);
  const pillH = useSharedValue(0);
  const lastPillSlot = useRef<number | null>(null);

  const movePillToSlot = useCallback(
    (slotIndex: number, animated: boolean) => {
      const slot = slotLayouts.current[slotIndex];
      const content = contentSizes.current[slotIndex];
      if (!slot || !content) return;

      const x = slot.x + (slot.width - content.width) / 2;
      const y = slot.y + (slot.height - content.height) / 2;
      const { width, height } = content;

      if (!animated || pillReady.value === 0) {
        pillX.value = x;
        pillY.value = y;
        pillW.value = width;
        pillH.value = height;
        pillReady.value = 1;
      } else {
        pillX.value = withSpring(x, TAB_SPRING);
        pillY.value = withSpring(y, TAB_SPRING);
        pillW.value = withSpring(width, TAB_SPRING);
        pillH.value = withSpring(height, TAB_SPRING);
      }
      lastPillSlot.current = slotIndex;
    },
    [pillH, pillReady, pillW, pillX, pillY],
  );

  const syncPill = useCallback(() => {
    movePillToSlot(activeSlotIndex, lastPillSlot.current != null);
  }, [activeSlotIndex, movePillToSlot]);

  useEffect(() => {
    syncPill();
  }, [syncPill]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillReady.value,
    transform: [{ translateX: pillX.value }, { translateY: pillY.value }],
    width: pillW.value,
    height: pillH.value,
  }));

  if (hideTabBarForBookAddFlow) {
    return null;
  }

  const tabBarBottom = tabBarFloatBottomPosition(insets.bottom);
  const tabBarPaddingBottom = tabBarContentPaddingBottom(insets.bottom);
  const tabBarTotalHeight = getTabBarTotalHeight(insets.bottom);

  return (
    <View
      style={[
        styles.tabBarShell,
        {
          bottom: tabBarBottom,
          height: tabBarTotalHeight,
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingBottom: tabBarPaddingBottom,
        },
      ]}
    >
      <View style={styles.tabBarRow}>
        <Animated.View pointerEvents="none" style={[styles.tabActivePill, pillStyle]} />
        {FIXED_TAB_BAR_SLOTS.map((routeName, slotIndex) => {
          const routeIndex = state.routes.findIndex(r => r.name === routeName);
          if (routeIndex < 0) return null;

          const route = state.routes[routeIndex];
          const { options } = descriptors[route.key];
          const isFocused = state.index === routeIndex;
          const meta = TAB_META[routeName];
          const tint = isFocused ? THEME.tabBarActiveTint : THEME.tabBarInactiveTint;
          const label = t(meta.titleKey);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              hapticSelection();
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          const isCaptureTab = routeName === 'index';
          const showCapturePlusHighlight = isCaptureTab && activeRoute !== 'index';

          return (
            <PetitmoTabBarButton
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={onLongPress}
              style={showCapturePlusHighlight ? styles.captureTabNudgeDown : undefined}
              onSlotLayout={layout => {
                slotLayouts.current[slotIndex] = layout;
                syncPill();
              }}
            >
              <TabBarItemContent
                focused={isFocused}
                tint={tint}
                label={label}
                Icon={meta.Icon}
                captureHighlight={showCapturePlusHighlight}
                tabLabelFontRegular={tabLabelFontRegular}
                tabLabelFontMedium={tabLabelFontMedium}
                onContentLayout={size => {
                  contentSizes.current[slotIndex] = size;
                  syncPill();
                }}
              />
            </PetitmoTabBarButton>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: TAB_BAR_BACKGROUND,
    borderTopWidth: TAB_BAR_BORDER_WIDTH,
    borderTopColor: TAB_BAR_CONTAINER_BORDER,
    zIndex: 20,
  },
  tabBarRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  tabBarButtonSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tabBarPressableBase: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  captureTabNudgeDown: {
    transform: [{ translateY: TAB_CAPTURE_NUDGE_Y }],
  },
  tabItemFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(7),
    minWidth: scale(64),
  },
  tabActivePill: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: scale(16),
    backgroundColor: THEME.tabBarActivePill,
    zIndex: 0,
  },
  tabItemZoom: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    height: TAB_ICON_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapCaptureHighlight: {
    height: TAB_CAPTURE_PLUS_DISC,
  },
  tabLabel: {
    marginTop: TAB_ICON_LABEL_GAP,
    marginBottom: 0,
    fontSize: scale(10),
    lineHeight: TAB_LABEL_LINE_H,
    letterSpacing: 0.05,
    textAlign: 'center',
    opacity: 0.72,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  tabLabelActive: {
    fontSize: scale(11),
    lineHeight: scale(13),
    opacity: 1,
    letterSpacing: 0.02,
  },
});

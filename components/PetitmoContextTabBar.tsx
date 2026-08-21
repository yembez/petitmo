import type { ComponentProps } from 'react';
import { useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import {
  FIXED_TAB_BAR_SLOTS,
  normalizeMainTabRoute,
  type MainTabRoute,
} from '@/constants/contextualTabBar';
import { THEME } from '@/constants/theme';
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
const TAB_LABEL_LINE_H = scale(12);
const TAB_ICON_LABEL_GAP = verticalScale(3);

const TAB_META: Record<
  MainTabRoute,
  { titleKey: 'tabs.capture' | 'tabs.journal' | 'tabs.favorites' | 'tabs.books'; Icon: LucideIcon }
> = {
  index: { titleKey: 'tabs.capture', Icon: Plus },
  fil: { titleKey: 'tabs.journal', Icon: List },
  favoris: { titleKey: 'tabs.favorites', Icon: Heart },
  livres: { titleKey: 'tabs.books', Icon: BookOpenText },
};

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
  /** Rond orange charte autour du « + » hors écran Capturer. */
  captureHighlight?: boolean;
}) {
  if (captureHighlight) {
    return (
      <View style={[styles.iconWrap, styles.iconWrapCaptureHighlight]}>
        <View style={styles.capturePlusDisc} accessibilityElementsHidden>
          <Plus
            size={TAB_ICON_SIZE}
            color="#FFFFFF"
            fill="none"
            strokeWidth={focused ? 2.25 : 2}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.iconWrap}>
      <Icon size={TAB_ICON_SIZE} color={color} fill="none" strokeWidth={focused ? 2.25 : 2} />
    </View>
  );
}

function PetitmoTabBarButton({ children, ...props }: ComponentProps<typeof PlatformPressable>) {
  const { style, 'aria-selected': isActive, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { backgroundColor: _navBg, ...navStyle } = flatStyle;

  return (
    <View style={styles.tabBarButtonSlot}>
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
  const favorisAddToBookSessionId = useSyncExternalStore(
    subscribeFavorisAddToBookSession,
    peekFavorisAddToBookSession,
    peekFavorisAddToBookSession,
  );
  const hideTabBarForBookAddFlow =
    activeRoute === 'favoris' && favorisAddToBookSessionId != null;

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
        {FIXED_TAB_BAR_SLOTS.map(routeName => {
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
            >
              <TabBarGlyph
                Icon={meta.Icon}
                focused={isFocused}
                color={tint}
                captureHighlight={showCapturePlusHighlight}
              />
              <Text
                style={[
                  styles.tabLabel,
                  loadedFontStyle(tabLabelFontRegular),
                  isFocused ? loadedFontStyle(tabLabelFontMedium) : null,
                  { color: tint },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
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
  },
  tabBarButtonSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarPressableBase: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconWrap: {
    height: TAB_ICON_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapCaptureHighlight: {
    height: TAB_CAPTURE_PLUS_DISC,
  },
  capturePlusDisc: {
    width: TAB_CAPTURE_PLUS_DISC,
    height: TAB_CAPTURE_PLUS_DISC,
    borderRadius: TAB_CAPTURE_PLUS_DISC / 2,
    backgroundColor: '#3C3C43',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    marginTop: TAB_ICON_LABEL_GAP,
    marginBottom: 0,
    fontSize: scale(10),
    lineHeight: TAB_LABEL_LINE_H,
    letterSpacing: 0.05,
    textAlign: 'center',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
});

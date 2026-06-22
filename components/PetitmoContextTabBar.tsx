import type { ComponentProps } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import { CAPTURE_SCREEN_ACCENT } from '@/constants/captureScreenPalette';
import {
  contextualTabBarRoutes,
  normalizeMainTabRoute,
  type MainTabRoute,
} from '@/constants/contextualTabBar';
import { THEME } from '@/constants/theme';
import { APP_ICON_PX } from '@/constants/iconSizes';
import {
  TAB_BAR_PADDING_TOP,
  getTabBarTotalHeight,
  tabBarContentPaddingBottom,
  tabBarFloatBottomPosition,
} from '@/constants/tabBarLayout';
import TabBarBackgroundShape from '@/components/TabBarBackgroundShape';
import { scale, verticalScale } from '@/utils/responsive';
import {
  peekFavorisAddToBookSession,
  subscribeFavorisAddToBookSession,
} from '@/services/favorisBookAddFlow';

const TAB_ICON_SIZE = APP_ICON_PX;
const TAB_ICON_SIZE_FOCUSED = scale(22);
/** Hauteur commune des icônes latérales (ligne basse du bandeau). */
const TAB_ICON_ROW_H = scale(26);
/** CTA « + » — disque plus grand, ancré dans la vague centrale. */
const CAPTURE_TAB_DISC_SIZE = scale(50);
const CAPTURE_TAB_DISC_ICON_SIZE = scale(23);
/** Vague SVG : montée douce, bords latéraux du bandeau restent droits. */
const CAPTURE_TAB_WAVE_RISE = verticalScale(10);
const CAPTURE_TAB_WAVE_WIDTH = scale(78);
/** Enfoncement dans le bandeau (~⅔ du disque dedans, ⅓ au-dessus du bord plat). */
const CAPTURE_DISC_SINK = verticalScale(15);
const TAB_LABEL_LINE_H = scale(11);
const TAB_ICON_LABEL_GAP = verticalScale(1);

const TAB_META: Record<
  MainTabRoute,
  { title: string; Icon: LucideIcon; fillWhenFocused: boolean }
> = {
  livres: { title: 'Livres', Icon: BookOpenText, fillWhenFocused: false },
  index: { title: 'Capturer', Icon: Plus, fillWhenFocused: false },
  favoris: { title: 'Favoris', Icon: Heart, fillWhenFocused: false },
  fil: { title: 'Journal', Icon: List, fillWhenFocused: false },
};

type Props = BottomTabBarProps & {
  tabLabelFontRegular?: string;
  tabLabelFontMedium?: string;
};

function TabBarGlyph({
  Icon,
  focused,
  fillWhenFocused = true,
  color,
}: {
  Icon: LucideIcon;
  focused: boolean;
  fillWhenFocused?: boolean;
  color: string;
}) {
  const size = focused ? TAB_ICON_SIZE_FOCUSED : TAB_ICON_SIZE;
  return (
    <View style={styles.iconWrap}>
      <Icon
        size={size}
        color={color}
        fill={focused && fillWhenFocused ? color : 'none'}
        strokeWidth={focused ? 2.35 : 2.15}
      />
    </View>
  );
}

function CaptureTabIcon({ focused, color }: { focused: boolean; color: string }) {
  const accent = CAPTURE_SCREEN_ACCENT;
  if (focused) {
    return <TabBarGlyph Icon={Plus} focused color={accent} />;
  }

  return (
    <View style={styles.captureIconWrap}>
      <View
        style={[
          styles.captureTabDisc,
          {
            width: CAPTURE_TAB_DISC_SIZE,
            height: CAPTURE_TAB_DISC_SIZE,
            borderRadius: CAPTURE_TAB_DISC_SIZE / 2,
            marginBottom: -CAPTURE_DISC_SINK,
          },
        ]}
      >
        <Plus
          size={CAPTURE_TAB_DISC_ICON_SIZE}
          color={THEME.captureScreenCtaForeground}
          strokeWidth={2.35}
        />
      </View>
    </View>
  );
}

/** Réserve la hauteur libellé sous le « + » (alignement avec les voisins). */
function CaptureLabelSpacer() {
  return <View style={styles.captureLabelSpacer} />;
}

function PetitmoTabBarButton({
  children,
  captureOverflow = false,
  ...props
}: ComponentProps<typeof PlatformPressable> & { captureOverflow?: boolean }) {
  const { style, 'aria-selected': isActive, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { backgroundColor: _navBg, ...navStyle } = flatStyle;

  return (
    <View
      style={[
        styles.tabBarButtonSlot,
        captureOverflow ? styles.tabBarButtonSlotCapture : null,
      ]}
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

export default function PetitmoContextTabBar({
  state,
  descriptors,
  navigation,
  insets,
  tabLabelFontRegular,
  tabLabelFontMedium,
}: Props) {
  const activeRoute = normalizeMainTabRoute(state.routes[state.index]?.name);
  const visibleRoutes = contextualTabBarRoutes(activeRoute);
  const showCaptureAppendage =
    visibleRoutes.includes('index') && activeRoute !== 'index';
  const favorisAddToBookSessionId = useSyncExternalStore(
    subscribeFavorisAddToBookSession,
    peekFavorisAddToBookSession,
    peekFavorisAddToBookSession,
  );
  const hideTabBarForBookAddFlow =
    activeRoute === 'favoris' && favorisAddToBookSessionId != null;
  const tabBarBottom = tabBarFloatBottomPosition(insets.bottom);
  const tabBarPaddingBottom = tabBarContentPaddingBottom(insets.bottom);
  const tabBarTotalHeight = getTabBarTotalHeight(insets.bottom);
  const [barWidth, setBarWidth] = useState(0);

  if (hideTabBarForBookAddFlow) {
    return null;
  }

  return (
    <View
      onLayout={event => setBarWidth(event.nativeEvent.layout.width)}
      style={[
        styles.tabBarShell,
        {
          bottom: tabBarBottom,
          height: tabBarTotalHeight,
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingBottom: tabBarPaddingBottom,
          overflow: 'visible',
        },
      ]}
    >
      <TabBarBackgroundShape
        width={barWidth}
        height={tabBarTotalHeight}
        showCenterWave={showCaptureAppendage}
        waveWidth={CAPTURE_TAB_WAVE_WIDTH}
        waveRise={showCaptureAppendage ? CAPTURE_TAB_WAVE_RISE : 0}
      />
      <View style={styles.tabBarRow}>
        {visibleRoutes.map(routeName => {
          const routeIndex = state.routes.findIndex(r => r.name === routeName);
          if (routeIndex < 0) return null;

          const route = state.routes[routeIndex];
          const { options } = descriptors[route.key];
          const isFocused = state.index === routeIndex;
          const meta = TAB_META[routeName];
          const tint = isFocused ? CAPTURE_SCREEN_ACCENT : THEME.tabBarInactiveTint;
          const isCapture = routeName === 'index';
          const showLabel = !isCapture;

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

          return (
            <PetitmoTabBarButton
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? meta.title}
              onPress={onPress}
              onLongPress={onLongPress}
              captureOverflow={isCapture && !isFocused}
            >
              {isCapture ? (
                <CaptureTabIcon focused={isFocused} color={tint} />
              ) : (
                <TabBarGlyph
                  Icon={meta.Icon}
                  focused={isFocused}
                  fillWhenFocused={meta.fillWhenFocused}
                  color={tint}
                />
              )}
              {showLabel ? (
                <Text
                  style={[
                    styles.tabLabel,
                    tabLabelFontRegular ? { fontFamily: tabLabelFontRegular } : null,
                    isFocused && tabLabelFontMedium ? { fontFamily: tabLabelFontMedium } : null,
                    { color: tint },
                  ]}
                  numberOfLines={1}
                >
                  {options.title ?? meta.title}
                </Text>
              ) : (
                <CaptureLabelSpacer />
              )}
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
    backgroundColor: 'transparent',
    zIndex: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#3C3126',
        shadowOffset: { width: 0, height: -1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  tabBarRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    zIndex: 2,
  },
  tabBarButtonSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tabBarButtonSlotCapture: {
    overflow: 'visible',
    zIndex: 3,
  },
  tabBarPressableBase: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  iconWrap: {
    height: TAB_ICON_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Bas du disque = bas de la ligne icônes ; le cercle déborde vers le haut. */
  captureIconWrap: {
    height: TAB_ICON_ROW_H,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
    zIndex: 4,
  },
  captureTabDisc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CAPTURE_SCREEN_ACCENT,
    ...Platform.select({
      ios: {
        shadowColor: '#3C3126',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 3,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  captureLabelSpacer: {
    height: TAB_LABEL_LINE_H,
  },
  tabLabel: {
    marginTop: TAB_ICON_LABEL_GAP,
    marginBottom: 0,
    fontSize: scale(10),
    lineHeight: TAB_LABEL_LINE_H,
    letterSpacing: 0.15,
    textAlign: 'center',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
});

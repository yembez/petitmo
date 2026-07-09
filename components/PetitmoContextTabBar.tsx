import type { ComponentProps } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform, Animated, Easing } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, ChevronDown, ChevronUp, Heart, List, Plus, Settings } from 'lucide-react-native';
import { CAPTURE_SCREEN_ACCENT } from '@/constants/captureScreenPalette';
import {
  FIXED_TAB_BAR_SLOTS,
  normalizeMainTabRoute,
  type MainTabRoute,
} from '@/constants/contextualTabBar';
import { THEME } from '@/constants/theme';
import {
  TAB_BAR_PADDING_TOP,
  getTabBarTotalHeight,
  tabBarContentPaddingBottom,
  tabBarFloatBottomPosition,
} from '@/constants/tabBarLayout';
import TabBarBackgroundShape, {
  captureTabNotchRadius,
} from '@/components/TabBarBackgroundShape';
import { scale, verticalScale } from '@/utils/responsive';
import {
  peekFavorisAddToBookSession,
  subscribeFavorisAddToBookSession,
} from '@/services/favorisBookAddFlow';
import {
  getCaptureTabBarRevealed,
  resetCaptureTabBarReveal,
  subscribeCaptureTabBarReveal,
  toggleCaptureTabBarRevealed,
} from '@/lib/captureTabBarRevealStore';

const CAPTURE_TAB_BAR_SLIDE_MS = 280;

const TAB_ICON_SIZE = scale(24);
const TAB_ICON_SIZE_FOCUSED = scale(24);
/** Hauteur commune des icônes latérales — centrées verticalement dans le bandeau. */
const TAB_ICON_ROW_H = scale(28);
/** CTA « + » — disque centré sur la ligne des icônes (même axe que Journal / Favoris / Livres). */
const CAPTURE_TAB_DISC_SIZE = scale(48);
const CAPTURE_TAB_DISC_ICON_SIZE = scale(22);
/** Marge horizontale entre le disque et la courbe de l’encoche. */
const CAPTURE_TAB_NOTCH_GAP = scale(34);
/** Profondeur du fond de l’encoche (< rayon horizontal → bas remonté). */
const CAPTURE_TAB_NOTCH_DEPTH = verticalScale(40);

function captureTabNotchR(): number {
  return captureTabNotchRadius(CAPTURE_TAB_DISC_SIZE / 2, CAPTURE_TAB_NOTCH_GAP);
}
const TAB_LABEL_LINE_H = scale(12);
const TAB_ICON_LABEL_GAP = verticalScale(3);

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
        strokeWidth={focused ? 2.25 : 2}
      />
    </View>
  );
}

function CaptureTabDisc() {
  return (
    <View style={styles.captureTabIconSlot}>
      <View
        style={[
          styles.captureTabDisc,
          {
            width: CAPTURE_TAB_DISC_SIZE,
            height: CAPTURE_TAB_DISC_SIZE,
            borderRadius: CAPTURE_TAB_DISC_SIZE / 2,
          },
        ]}
      >
        <Plus
          size={CAPTURE_TAB_DISC_ICON_SIZE}
          color="#0A0A0A"
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
  const router = useRouter();
  const activeRoute = normalizeMainTabRoute(state.routes[state.index]?.name);
  const isCaptureTabActive = activeRoute === 'index';
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
  const captureTabBarRevealed = useSyncExternalStore(
    subscribeCaptureTabBarReveal,
    getCaptureTabBarRevealed,
    () => false,
  );
  const tabBarSlideY = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    if (!isCaptureTabActive) {
      resetCaptureTabBarReveal();
      tabBarSlideY.setValue(0);
      return;
    }
    tabBarSlideY.setValue(tabBarTotalHeight);
  }, [isCaptureTabActive, tabBarSlideY, tabBarTotalHeight]);

  useEffect(() => {
    if (!isCaptureTabActive) return;
    Animated.timing(tabBarSlideY, {
      toValue: captureTabBarRevealed ? 0 : tabBarTotalHeight,
      duration: CAPTURE_TAB_BAR_SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [captureTabBarRevealed, isCaptureTabActive, tabBarSlideY, tabBarTotalHeight]);

  if (hideTabBarForBookAddFlow) {
    return null;
  }

  const captureTabBarHidden = isCaptureTabActive && !captureTabBarRevealed;
  const peekHandleBottom = tabBarBottom + verticalScale(32);

  return (
    <>
      {isCaptureTabActive ? (
        <View
          pointerEvents="box-none"
          style={[styles.captureTabBarPeekHost, { bottom: peekHandleBottom }]}
        >
          <PlatformPressable
            accessibilityRole="button"
            accessibilityLabel={
              captureTabBarRevealed ? 'Masquer la navigation' : 'Afficher la navigation'
            }
            onPress={toggleCaptureTabBarRevealed}
            style={styles.captureTabBarPeekButton}
          >
            {captureTabBarRevealed ? (
              <ChevronDown size={scale(20)} color={THEME.tabBarInactiveTint} strokeWidth={2.25} />
            ) : (
              <ChevronUp size={scale(20)} color={THEME.tabBarInactiveTint} strokeWidth={2.25} />
            )}
          </PlatformPressable>
        </View>
      ) : null}
      <Animated.View
        pointerEvents={captureTabBarHidden ? 'none' : 'auto'}
        onLayout={event => setBarWidth(event.nativeEvent.layout.width)}
        style={[
          styles.tabBarShell,
          {
            bottom: tabBarBottom,
            height: tabBarTotalHeight,
            paddingTop: TAB_BAR_PADDING_TOP,
            paddingBottom: tabBarPaddingBottom,
            overflow: 'visible',
            transform: [
              {
                translateY: isCaptureTabActive ? tabBarSlideY : 0,
              },
            ],
          },
        ]}
      >
      <TabBarBackgroundShape
        width={barWidth}
        height={tabBarTotalHeight}
        showCenterDip
        notchRadius={captureTabNotchR()}
        notchDepth={CAPTURE_TAB_NOTCH_DEPTH}
      />
      <View style={styles.tabBarRow}>
        {FIXED_TAB_BAR_SLOTS.map(slot => {
          if (slot.kind === 'settings') {
            const tint = THEME.tabBarInactiveTint;
            return (
              <PetitmoTabBarButton
                key="settings"
                accessibilityRole="button"
                accessibilityLabel="Paramètres"
                onPress={() => router.push('/parent-space')}
              >
                <TabBarGlyph Icon={Settings} focused={false} fillWhenFocused={false} color={tint} />
                <Text
                  style={[
                    styles.tabLabel,
                    tabLabelFontRegular ? { fontFamily: tabLabelFontRegular } : null,
                    { color: tint },
                  ]}
                  numberOfLines={1}
                >
                  Paramètres
                </Text>
              </PetitmoTabBarButton>
            );
          }

          const routeName = slot.route;
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
                isCaptureTabActive ? (
                  <CaptureLabelSpacer />
                ) : (
                  <CaptureTabDisc />
                )
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
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  captureTabBarPeekHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 25,
  },
  captureTabBarPeekButton: {
    width: scale(48),
    height: scale(30),
    borderRadius: scale(15),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 49, 38, 0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#3C3126',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
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
    alignItems: 'center',
    zIndex: 2,
  },
  tabBarButtonSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarButtonSlotCapture: {
    overflow: 'visible',
    zIndex: 3,
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
  captureTabIconSlot: {
    height: TAB_ICON_ROW_H,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  captureTabDisc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.tabBarBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
    ...Platform.select({
      ios: {
        shadowColor: '#3C3126',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.14,
        shadowRadius: scale(8),
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
    letterSpacing: 0.05,
    textAlign: 'center',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
});

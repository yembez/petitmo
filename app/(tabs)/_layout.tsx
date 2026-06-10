import type { ComponentProps } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Tabs } from 'expo-router';
import { TabTransitionProvider, useTabTransition } from '@/contexts/TabTransitionContext';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import { PlatformPressable } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { APP_ICON_PX } from '@/constants/iconSizes';
import {
  TAB_BAR_BACKGROUND,
  TAB_BAR_BORDER_WIDTH,
  TAB_BAR_CONTAINER_BORDER,
  TAB_BAR_CORNER_RADIUS,
  TAB_BAR_FLOAT_SIDE_INSET,
  TAB_BAR_PADDING_BOTTOM_GAP,
  TAB_BAR_PADDING_TOP,
  getTabBarTotalHeight,
  tabBarContentPaddingBottom,
  tabBarFloatBottomPosition,
  tabBarSafeFillHeight,
} from '@/constants/tabBarLayout';

const TAB_ICON_SIZE = APP_ICON_PX;
const TAB_ICON_SIZE_FOCUSED = scale(22);

function TabBarBackgroundFill() {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: TAB_BAR_BACKGROUND,
          borderRadius: TAB_BAR_CORNER_RADIUS,
          borderWidth: TAB_BAR_BORDER_WIDTH,
          borderColor: TAB_BAR_CONTAINER_BORDER,
          overflow: 'hidden',
        },
      ]}
    />
  );
}

/** Bouton onglet : pas de pastille — actif = orange CTA via `tabBarActiveTintColor`. */
function PetitmoTabBarButton(props: ComponentProps<typeof PlatformPressable>) {
  const { style, 'aria-selected': isActive, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { backgroundColor: _navBg, ...navStyle } = flatStyle;

  return (
    <View style={styles.tabBarButtonSlot}>
      <PlatformPressable
        {...rest}
        aria-selected={isActive}
        style={[styles.tabBarPressableBase, navStyle]}
      />
    </View>
  );
}

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
        strokeWidth={focused ? 2.35 : 2}
      />
    </View>
  );
}

export default function TabLayout() {
  return (
    <TabTransitionProvider>
      <TabLayoutInner />
    </TabTransitionProvider>
  );
}

function TabLayoutInner() {
  const { setTabIndex } = useTabTransition();
  const insets = useSafeAreaInsets();
  const safeFillHeight = tabBarSafeFillHeight(insets.bottom);
  const tabBarTotalHeight = getTabBarTotalHeight(insets.bottom);
  const tabBarBottom = tabBarFloatBottomPosition(insets.bottom);
  const tabBarPaddingBottom = tabBarContentPaddingBottom(insets.bottom);
  const [tabFontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const tabLabelFontRegular = tabFontsLoaded ? 'DMSans_400Regular' : undefined;
  const tabLabelFontMedium = tabFontsLoaded ? 'DMSans_500Medium' : undefined;

  return (
    <Tabs
      screenListeners={{
        state: e => {
          const index = e.data.state?.index;
          if (typeof index === 'number') setTabIndex(index);
        },
      }}
      screenOptions={{
        headerShown: false,
        /** Garder Fil / Favoris montés : évite remontage + rechargement images après long séjour sur Capturer. */
        lazy: false,
        detachInactiveScreens: false,
        /**
         * `freezeOnBlur` gèle Reanimated + expo-av sur les onglets inactifs au 1er montage ;
         * au retour sur Fil / Favoris, zoom diaporama et autoplay vidéo ne repartaient plus.
         */
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: '#FFFFFF' },
        tabBarActiveTintColor: THEME.tabBarActiveTint,
        tabBarInactiveTintColor: THEME.tabBarInactiveTint,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarBackground: () => <TabBarBackgroundFill />,
        tabBarButton: props => <PetitmoTabBarButton {...props} />,
        tabBarStyle: {
          position: 'absolute',
          left: TAB_BAR_FLOAT_SIDE_INSET,
          right: TAB_BAR_FLOAT_SIDE_INSET,
          bottom: tabBarBottom,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: 0,
          borderLeftWidth: 0,
          borderColor: 'transparent',
          borderTopLeftRadius: TAB_BAR_CORNER_RADIUS,
          borderTopRightRadius: TAB_BAR_CORNER_RADIUS,
          borderBottomLeftRadius: TAB_BAR_CORNER_RADIUS,
          borderBottomRightRadius: TAB_BAR_CORNER_RADIUS,
          height: tabBarTotalHeight,
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingBottom: tabBarPaddingBottom,
          paddingHorizontal: scale(4),
          ...Platform.select({
            ios: {
              shadowColor: '#3C3126',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
            },
            android: {
              elevation: 6,
            },
            default: {},
          }),
        },
        tabBarItemStyle: {
          flex: 1,
          minWidth: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        tabBarLabel: ({ focused, children, color }) => (
          <Text
            style={[
              styles.tabLabel,
              tabLabelFontRegular ? { fontFamily: tabLabelFontRegular } : null,
              focused && tabLabelFontMedium ? { fontFamily: tabLabelFontMedium } : null,
              { color: color ?? (focused ? THEME.tabBarActiveTint : THEME.tabBarInactiveTint) },
            ]}
            numberOfLines={1}
          >
            {children}
          </Text>
        ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Capturer',
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              Icon={Plus}
              focused={focused}
              color={color ?? THEME.tabBarInactiveTint}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="fil"
        options={{
          title: 'Journal',
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              Icon={List}
              focused={focused}
              fillWhenFocused={false}
              color={color ?? THEME.tabBarInactiveTint}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="favoris"
        options={{
          title: 'Favoris',
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              Icon={Heart}
              focused={focused}
              fillWhenFocused={false}
              color={color ?? THEME.tabBarInactiveTint}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="livres"
        options={{
          title: 'Livres',
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              Icon={BookOpenText}
              focused={focused}
              fillWhenFocused={false}
              color={color ?? THEME.tabBarInactiveTint}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarButtonSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarPressableBase: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: verticalScale(2),
    paddingBottom: verticalScale(2),
    backgroundColor: 'transparent',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(0.5),
  },
  tabLabel: {
    marginTop: 0,
    marginBottom: verticalScale(1),
    fontSize: scale(10),
    lineHeight: scale(11),
    letterSpacing: 0.15,
    textAlign: 'center',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
});

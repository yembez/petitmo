import type { ComponentProps } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Tabs } from 'expo-router';
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
  TAB_BAR_FLOAT_BOTTOM_OFFSET,
  TAB_BAR_FLOAT_SIDE_INSET,
  TAB_BAR_PADDING_BOTTOM_GAP,
  TAB_BAR_PADDING_TOP,
  TAB_ACTIVE_INNER_RADIUS,
  TAB_ACTIVE_PILL_WIDTH,
  getTabBarOuterHeight,
} from '@/constants/tabBarLayout';

const TAB_ICON_SIZE = APP_ICON_PX;
const TAB_ICON_SIZE_FOCUSED = scale(24);

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
        },
      ]}
    />
  );
}

/**
 * Pastille active : largeur fixe (`TAB_ACTIVE_PILL_WIDTH`), le fond ne suit plus la largeur du libellé.
 */
function PetitmoTabBarButton(props: ComponentProps<typeof PlatformPressable>) {
  const { style, 'aria-selected': isActive, ...rest } = props;
  const focused = isActive === true;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { backgroundColor: _navBg, ...navStyle } = flatStyle;

  return (
    <View style={styles.tabBarButtonSlot}>
      <PlatformPressable
        {...rest}
        aria-selected={isActive}
        style={[
          styles.tabBarPressableBase,
          navStyle,
          focused ? styles.tabBarPressableActive : styles.tabBarPressableInactive,
        ]}
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
  const insets = useSafeAreaInsets();
  const tabBarPaddingBottom = TAB_BAR_PADDING_BOTTOM_GAP + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
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
          bottom: TAB_BAR_FLOAT_BOTTOM_OFFSET,
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
          overflow: 'hidden',
          height: getTabBarOuterHeight(insets.bottom),
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingBottom: tabBarPaddingBottom,
          paddingHorizontal: scale(4),
          ...Platform.select({
            ios: {
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
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
              focused && styles.tabLabelFocused,
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
            <TabBarGlyph Icon={Plus} focused={focused} color={color ?? THEME.tabBarInactiveTint} />
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
          sceneStyle: { backgroundColor: THEME.bgScreen },
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
    paddingVertical: verticalScale(4),
  },
  tabBarPressableActive: {
    width: TAB_ACTIVE_PILL_WIDTH,
    backgroundColor: THEME.tabBarActivePill,
    borderRadius: TAB_ACTIVE_INNER_RADIUS,
    overflow: 'hidden',
  },
  tabBarPressableInactive: {
    backgroundColor: 'transparent',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  tabLabel: {
    marginTop: verticalScale(2),
    fontSize: scale(10),
    fontWeight: '600',
    letterSpacing: 0.08,
    textAlign: 'center',
  },
  tabLabelFocused: {
    fontSize: scale(10),
    fontWeight: '700',
  },
});

import { View, Text, StyleSheet, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { APP_ICON_PX } from '@/constants/iconSizes';
import {
  TAB_BAR_BACKGROUND,
  TAB_BAR_BORDER_COLOR,
  TAB_BAR_BORDER_WIDTH,
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_CORNER_RADIUS,
  TAB_BAR_FLOAT_SIDE_INSET,
} from '@/constants/tabBarLayout';

const TAB_ICON_SIZE = APP_ICON_PX;
const TAB_ICON_SIZE_FOCUSED = scale(25);

const INK = '#0A0A0A';

/** Recouvrement léger de la pastille sur l’anneau noir : évite un frange clair (anti-alias) au joint haut. */
const TAB_BAR_INNER_OVERLAP = StyleSheet.hairlineWidth;

function TabBarBackgroundFill() {
  const inset = TAB_BAR_BORDER_WIDTH;
  const o = TAB_BAR_INNER_OVERLAP;
  const innerRadius = Math.max(0, TAB_BAR_CORNER_RADIUS - inset + o);
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: TAB_BAR_BORDER_COLOR,
          borderRadius: TAB_BAR_CORNER_RADIUS,
        },
      ]}
    >
      <View
        style={{
          position: 'absolute',
          top: Math.max(0, inset - o),
          left: Math.max(0, inset - o),
          right: Math.max(0, inset - o),
          bottom: Math.max(0, inset - o),
          borderRadius: innerRadius,
          backgroundColor: TAB_BAR_BACKGROUND,
        }}
      />
    </View>
  );
}

function TabBarGlyph({
  Icon,
  focused,
  fillWhenFocused = true,
}: {
  Icon: LucideIcon;
  focused: boolean;
  fillWhenFocused?: boolean;
}) {
  const size = focused ? TAB_ICON_SIZE_FOCUSED : TAB_ICON_SIZE;
  return (
    <View style={styles.iconWrap}>
      <View style={styles.iconBg}>
        <Icon
          size={size}
          color={INK}
          fill={focused && fillWhenFocused ? INK : 'none'}
          strokeWidth={focused ? 2.45 : 2}
        />
      </View>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = verticalScale(6) + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        /** Laisse voir la scène dans les marges latérales sous la tab bar flottante. */
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: INK,
        tabBarInactiveTintColor: INK,
        /** Liseré : anneau noir + pastille (recouvrement hairline sur l’anneau pour éviter frange claire). */
        tabBarBackground: () => <TabBarBackgroundFill />,
        tabBarStyle: {
          position: 'absolute',
          left: TAB_BAR_FLOAT_SIDE_INSET,
          right: TAB_BAR_FLOAT_SIDE_INSET,
          bottom: 0,
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
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: bottomPad,
          paddingTop: verticalScale(4),
          paddingHorizontal: scale(8),
          ...Platform.select({
            ios: {
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.14,
              shadowRadius: 12,
            },
            android: {
              elevation: 12,
            },
            default: {},
          }),
        },
        tabBarItemStyle: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          minWidth: 0,
        },
        tabBarLabel: ({ focused, children }) => (
          <Text
            style={[styles.tabLabel, focused && styles.tabLabelFocused]}
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
          tabBarIcon: ({ focused }) => <TabBarGlyph Icon={Plus} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="fil"
        options={{
          title: 'Journal',
          tabBarIcon: ({ focused }) => (
            <TabBarGlyph Icon={List} focused={focused} fillWhenFocused={false} />
          ),
        }}
      />
      <Tabs.Screen
        name="favoris"
        options={{
          title: 'Favoris',
          tabBarIcon: ({ focused }) => (
            <TabBarGlyph Icon={Heart} focused={focused} fillWhenFocused={false} />
          ),
        }}
      />
      <Tabs.Screen
        name="livres"
        options={{
          title: 'Livres',
          sceneStyle: { backgroundColor: THEME.bgScreen },
          tabBarIcon: ({ focused }) => (
            <TabBarGlyph Icon={BookOpenText} focused={focused} fillWhenFocused={false} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(1),
  },
  iconBg: {
    width: scale(36),
    height: scale(36),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tabLabel: {
    marginTop: verticalScale(1),
    fontSize: scale(10),
    fontWeight: '600',
    letterSpacing: 0.12,
    textAlign: 'center',
    color: INK,
  },
  tabLabelFocused: {
    fontSize: scale(11),
    fontWeight: '800',
  },
});

import { View, Text, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpenText, Heart, List, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { APP_ICON_PX } from '@/constants/iconSizes';

const TAB_ICON_SIZE = APP_ICON_PX;
const TAB_ICON_SIZE_FOCUSED = scale(25);

const INK = '#0A0A0A';

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

/** Hauteur utile des icônes + labels (hors safe area / home indicator) */
const TAB_BAR_CONTENT_HEIGHT = verticalScale(52);

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = verticalScale(6) + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: INK,
        tabBarInactiveTintColor: INK,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: 'rgba(0,0,0,0.28)',
          elevation: 0,
          shadowOpacity: 0,
          shadowOffset: { width: 0, height: 0 },
          shadowRadius: 0,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: bottomPad,
          paddingTop: verticalScale(4),
          paddingHorizontal: scale(8),
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
          sceneStyle: { backgroundColor: '#FBFAF7' },
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

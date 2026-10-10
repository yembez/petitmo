import { type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { MENU_BG } from '@/components/parentSpace/menuUi';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';

export default function ParentSubpageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dm600 } = useDmSansFamilyFlowFonts();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => safeRouterBack(router, '/parent-space')}
          style={styles.headerButton}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <ChevronLeft size={ICON_SIZES.lg} color={THEME.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, dm600 ? { fontFamily: dm600 } : null]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + verticalScale(32) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MENU_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: MENU_BG,
  },
  headerButton: {
    width: scale(44),
    height: scale(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.sm,
  },
});

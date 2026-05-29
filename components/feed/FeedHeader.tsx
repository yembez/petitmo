import { memo } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Menu } from 'lucide-react-native';
import { calculateAge } from '@/utils/date';
import { scale, verticalScale } from '@/utils/responsive';
import type { Child } from '@/utils/feedHelpers';
import { styles } from '@/components/feed/feedStyles';
import { THEME } from '@/constants/theme';
import { childDisplayGivenName } from '@/utils/childDisplayName';
import { ChildAvatar } from '@/components/ChildAvatar';

export type FeedHeaderProps = {
  child: Child | null;
  paddingTop: number;
  /** Ouvre l’espace parent (même entrée que le menu burger sur l’onglet Capturer). */
  onMenuPress: () => void;
};

/** Aligné sur `styles.headerRow` + `styles.headerContent` (avatar agrandi + paddingBottom + bordure). */
const HEADER_INNER_RESERVE_H =
  verticalScale(68) + verticalScale(10) + StyleSheet.hairlineWidth;

export const FeedHeader = memo(function FeedHeader({ child, paddingTop, onMenuPress }: FeedHeaderProps) {
  if (!child) {
    return (
      <View
        pointerEvents="none"
        style={{
          paddingTop,
          minHeight: paddingTop + HEADER_INNER_RESERVE_H,
          backgroundColor: THEME.familyFlowScreenBg,
        }}
      />
    );
  }

  const givenName = childDisplayGivenName(child.name) || child.name.trim();
  const agePresent = child.birthdate ? calculateAge(child.birthdate) : '';

  const inner = (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <ChildAvatar
          key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
          child={child}
          size={scale(68)}
        />
        <View style={styles.headerNameBlock}>
          <Text style={styles.headerTitleLine} numberOfLines={1}>
            <Text style={styles.headerChildName}>{givenName}</Text>
            {!!agePresent && (
              <>
                <Text style={styles.headerDot}>{' · '}</Text>
                <Text style={styles.headerChildAge}>{agePresent}</Text>
              </>
            )}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.headerAddBtn}
        onPress={onMenuPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Menu size={scale(20)} color={THEME.textPrimary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );

  return Platform.OS === 'ios' ? (
    <BlurView intensity={14} tint="light" style={styles.headerBlur}>
      <View style={[styles.headerContent, { paddingTop }]}>{inner}</View>
    </BlurView>
  ) : (
    <View style={[styles.headerContent, styles.headerAndroid, { paddingTop }]}>
      {inner}
    </View>
  );
});

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
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';

export type FeedHeaderProps = {
  familyChildren: Child[];
  paddingTop: number;
  /** Ouvre l’espace parent (même entrée que le menu burger sur l’onglet Capturer). */
  onMenuPress: () => void;
};

/** Aligné sur `styles.headerRow` + `styles.headerContent` (avatar agrandi + paddingBottom + bordure). */
const HEADER_INNER_RESERVE_H =
  verticalScale(68) + verticalScale(10) + StyleSheet.hairlineWidth;

const HEADER_AVATAR_PX = scale(68);
const AVATAR_STACK_OVERLAP = scale(22);

function familyHeaderTitle(children: Child[]): string {
  const names = sortChildrenByBirthdateAsc(children)
    .map(c => childDisplayGivenName(c.name))
    .filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

function FeedHeaderAvatarStack({ familyChildren }: { familyChildren: Child[] }) {
  if (familyChildren.length === 1) {
    const child = familyChildren[0];
    return (
      <View style={styles.headerAvatarRing}>
        <ChildAvatar
          key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
          child={child}
          size={HEADER_AVATAR_PX}
        />
      </View>
    );
  }

  return (
    <View style={styles.headerAvatarRing}>
      <View style={headerAvatarStackStyles.row}>
        {familyChildren.map((child, index) => (
          <View
            key={child.id}
            style={[
              headerAvatarStackStyles.slot,
              index > 0 && { marginLeft: -AVATAR_STACK_OVERLAP },
              { zIndex: familyChildren.length - index },
            ]}
          >
            <View style={headerAvatarStackStyles.avatarBorder}>
              <ChildAvatar child={child} size={HEADER_AVATAR_PX} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export const FeedHeader = memo(function FeedHeader({
  familyChildren,
  paddingTop,
  onMenuPress,
}: FeedHeaderProps) {
  const sorted = sortChildrenByBirthdateAsc(familyChildren);

  if (sorted.length === 0) {
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

  const isSolo = sorted.length === 1;
  const soloChild = isSolo ? sorted[0] : null;
  const givenName = soloChild ? childDisplayGivenName(soloChild.name) || soloChild.name.trim() : '';
  const agePresent = soloChild?.birthdate ? calculateAge(soloChild.birthdate) : '';
  const familyTitle = isSolo ? givenName : familyHeaderTitle(sorted);

  const inner = (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <FeedHeaderAvatarStack familyChildren={sorted} />
        <View style={styles.headerNameBlock}>
          <Text style={styles.headerTitleLine} numberOfLines={2}>
            <Text style={styles.headerChildName}>{familyTitle}</Text>
            {isSolo && !!agePresent && (
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

const headerAvatarStackStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot: {
    backgroundColor: THEME.familyFlowScreenBg,
    borderRadius: HEADER_AVATAR_PX / 2 + 2,
  },
  avatarBorder: {
    borderRadius: HEADER_AVATAR_PX / 2 + 1,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: THEME.familyFlowScreenBg,
    overflow: 'hidden',
  },
});

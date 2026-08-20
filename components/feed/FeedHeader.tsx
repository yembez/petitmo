import { memo } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { calculateAge } from '@/utils/date';
import { scale } from '@/utils/responsive';
import type { Child } from '@/utils/feedHelpers';
import { styles } from '@/components/feed/feedStyles';
import { THEME } from '@/constants/theme';
import { childDisplayGivenName } from '@/utils/childDisplayName';
import { ChildAvatar } from '@/components/ChildAvatar';
import SettingsHeaderButton from '@/components/SettingsHeaderButton';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';

export type FeedHeaderProps = {
  familyChildren: Child[];
  paddingTop: number;
  /** Ouvre l’éditeur de profil de l’enfant dont l’avatar est tapé. */
  onPressChild: (child: Child) => void;
};

const HEADER_AVATAR_PX = scale(68);
const AVATAR_STACK_OVERLAP = scale(22);

function familyHeaderTitle(children: Child[]): string {
  const names = sortChildrenByBirthdateAsc(children)
    .map(c => childDisplayGivenName(c.name))
    .filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return '';
}

function FeedHeaderAvatarStack({
  familyChildren,
  onPressChild,
}: {
  familyChildren: Child[];
  onPressChild: (child: Child) => void;
}) {
  if (familyChildren.length === 1) {
    const child = familyChildren[0];
    const givenName = childDisplayGivenName(child.name) || child.name.trim() || 'Enfant';
    return (
      <TouchableOpacity
        style={styles.headerAvatarRing}
        onPress={() => onPressChild(child)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Modifier le profil de ${givenName}`}
      >
        <ChildAvatar
          key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
          child={child}
          size={HEADER_AVATAR_PX}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.headerAvatarRing}>
      <View style={headerAvatarStackStyles.row}>
        {familyChildren.map((child, index) => {
          const givenName = childDisplayGivenName(child.name) || child.name.trim() || 'Enfant';
          return (
            <TouchableOpacity
              key={child.id}
              style={[
                headerAvatarStackStyles.slot,
                index > 0 && { marginLeft: -AVATAR_STACK_OVERLAP },
                { zIndex: familyChildren.length - index },
              ]}
              onPress={() => onPressChild(child)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Modifier le profil de ${givenName}`}
            >
              <View style={headerAvatarStackStyles.avatarBorder}>
                <ChildAvatar child={child} size={HEADER_AVATAR_PX} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export const FeedHeader = memo(function FeedHeader({
  familyChildren,
  paddingTop,
  onPressChild,
}: FeedHeaderProps) {
  const sorted = sortChildrenByBirthdateAsc(familyChildren);

  if (sorted.length === 0) {
    return (
      <View style={[styles.headerContent, styles.headerAndroid, { paddingTop }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft} />
          <View style={styles.headerRight}>
            <SettingsHeaderButton />
          </View>
        </View>
      </View>
    );
  }

  const isSolo = sorted.length === 1;
  const showHeaderNames = sorted.length <= 2;
  const soloChild = isSolo ? sorted[0] : null;
  const givenName = soloChild ? childDisplayGivenName(soloChild.name) || soloChild.name.trim() : '';
  const agePresent = soloChild?.birthdate ? calculateAge(soloChild.birthdate) : '';
  const familyTitle = isSolo ? givenName : familyHeaderTitle(sorted);

  const inner = (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <FeedHeaderAvatarStack familyChildren={sorted} onPressChild={onPressChild} />
        {showHeaderNames && (
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
        )}
      </View>
      <View style={styles.headerRight}>
        <SettingsHeaderButton />
      </View>
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

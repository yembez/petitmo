import { memo } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet, Alert } from 'react-native';
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
import {
  isFeedFlashDebugEnabled,
  setFeedFlashDebugEnabled,
} from '@/lib/feedFlashDebug';

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
        onPress={() => onPressChild(child)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Modifier le profil de ${givenName}`}
      >
        <View style={headerAvatarStackStyles.avatarBorder}>
          <ChildAvatar
            key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
            child={child}
            size={HEADER_AVATAR_PX}
          />
        </View>
      </TouchableOpacity>
    );
  }

  /**
   * Plusieurs enfants : un seul ovale (capsule) autour du groupe,
   * pas un anneau corail par avatar.
   */
  return (
    <View style={headerAvatarStackStyles.groupRing}>
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
              <ChildAvatar
                key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
                child={child}
                size={HEADER_AVATAR_PX}
              />
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
          <TouchableOpacity
            style={styles.headerNameBlock}
            activeOpacity={1}
            delayLongPress={1200}
            onLongPress={() => {
              const next = !isFeedFlashDebugEnabled();
              void setFeedFlashDebugEnabled(next).then(() => {
                Alert.alert(
                  'Debug fil / flash',
                  next
                    ? 'Activé. Repro (import multi / scroll rapide / blanc) → à chaque blanc « J’ai vu le flash » → Exporter → colle le dump dans Cursor.'
                    : 'Désactivé.',
                );
              });
            }}
            accessibilityRole="text"
            accessibilityLabel={familyTitle}
          >
            <Text style={styles.headerTitleLine} numberOfLines={2}>
              <Text style={styles.headerChildName}>{familyTitle}</Text>
              {isSolo && !!agePresent && (
                <>
                  <Text style={styles.headerDot}>{' · '}</Text>
                  <Text style={styles.headerChildAge}>{agePresent}</Text>
                </>
              )}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.headerRight}>
        <SettingsHeaderButton />
      </View>
    </View>
  );

  return Platform.OS === 'ios' ? (
    <BlurView
      intensity={44}
      tint="systemThinMaterialLight"
      style={styles.headerBlur}
    >
      <View style={[styles.headerContent, { paddingTop }]}>{inner}</View>
    </BlurView>
  ) : (
    <View style={[styles.headerContent, styles.headerAndroid, { paddingTop }]}>
      {inner}
    </View>
  );
});

const GROUP_RING_PAD = 2;
const GROUP_RING_BORDER = 2;

const headerAvatarStackStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Capsule autour de toute la pile (multi). */
  groupRing: {
    padding: GROUP_RING_PAD,
    borderWidth: GROUP_RING_BORDER,
    borderColor: THEME.brandPrimary,
    borderRadius: (HEADER_AVATAR_PX + 2 * GROUP_RING_PAD) / 2 + GROUP_RING_BORDER,
    overflow: 'hidden',
  },
  slot: {
    backgroundColor: THEME.familyFlowScreenBg,
    borderRadius: HEADER_AVATAR_PX / 2,
    overflow: 'hidden',
  },
  /** Solo : cercle corail autour de l’unique avatar. */
  avatarBorder: {
    borderRadius: HEADER_AVATAR_PX / 2 + 1,
    borderWidth: 2,
    borderColor: THEME.brandPrimary,
    overflow: 'hidden',
  },
});

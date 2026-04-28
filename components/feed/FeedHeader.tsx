import { memo } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Plus } from 'lucide-react-native';
import { calculateAge } from '@/utils/date';
import { scale, verticalScale } from '@/utils/responsive';
import type { Child } from '@/utils/feedHelpers';
import {
  CAN_USE_AVATAR_BW_FILTER,
  HEADER_AVATAR_PX,
  HEADER_AVATAR_CM_STYLE,
  styles,
} from '@/components/feed/feedStyles';
import { ColorMatrix, grayscale } from 'react-native-color-matrix-image-filters';

export type FeedHeaderProps = {
  child: Child | null;
  paddingTop: number;
  onAddPress: () => void;
};

/** Aligné sur `styles.headerRow` + `styles.headerContent` (minHeight + paddingBottom + bordure) pour éviter un saut de layout quand `child` arrive après `router.replace` (import). */
const HEADER_INNER_RESERVE_H =
  verticalScale(40) + verticalScale(8) + StyleSheet.hairlineWidth;

export const FeedHeader = memo(function FeedHeader({ child, paddingTop, onAddPress }: FeedHeaderProps) {
  if (!child) {
    return (
      <View
        pointerEvents="none"
        style={{
          paddingTop,
          minHeight: paddingTop + HEADER_INNER_RESERVE_H,
          backgroundColor: '#F0F2F5',
        }}
      />
    );
  }

  const photoUri = child.photo_url?.trim() ?? '';
  const firstName = child.name.trim().split(/\s+/)[0] || child.name;
  const agePresent = child.birthdate ? calculateAge(child.birthdate) : '';

  const inner = (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        {photoUri ? (
          <View style={styles.headerAvatarImg}>
            {CAN_USE_AVATAR_BW_FILTER ? (
              <ColorMatrix matrix={grayscale()} style={HEADER_AVATAR_CM_STYLE}>
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: HEADER_AVATAR_PX, height: HEADER_AVATAR_PX }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={child.id}
                />
              </ColorMatrix>
            ) : (
              <Image
                source={{ uri: photoUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={child.id}
              />
            )}
          </View>
        ) : (
          <View style={styles.headerAvatarPlaceholder}>
            <Text style={styles.headerAvatarLetter}>{firstName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.headerNameBlock}>
          <Text style={styles.headerTitleLine} numberOfLines={1}>
            <Text style={styles.headerChildName}>{firstName}</Text>
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
        onPress={onAddPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Ouvrir la capture"
      >
        <Plus size={scale(22)} color="#3A3A3C" strokeWidth={2} />
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

import { type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';

export const MENU_BG = '#F2F2F7';
export const MENU_CARD = '#FFFFFF';
export const MENU_HEADER = '#6D6D72';
export const MENU_SEPARATOR = '#C6C6C8';
export const MENU_CHEVRON = '#C7C7CC';

export function menuIcon(Icon: LucideIcon): ReactNode {
  return <Icon size={ICON_SIZES.md} color={THEME.textPrimary} strokeWidth={1.85} />;
}

export function manageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

export async function openUrl(url: string): Promise<void> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) return;
  await Linking.openURL(url);
}

export function MenuGroup({
  title,
  children,
  titleFontFamily,
}: {
  title?: string;
  children: ReactNode;
  titleFontFamily?: string;
}) {
  return (
    <View style={styles.menuGroup}>
      {title ? (
        <Text
          style={[styles.menuGroupTitle, titleFontFamily ? { fontFamily: titleFontFamily } : null]}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : null}
      <View style={styles.menuCard}>{children}</View>
    </View>
  );
}

export function MenuRow({
  label,
  detail,
  value,
  icon,
  onPress,
  onLongPress,
  bordered,
  labelFontFamily,
  labelAccent,
  destructive,
  showChevron = true,
  disabled,
  trailing,
  valueRefreshing,
  refreshingAccessibilityLabel,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  value?: string;
  icon?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  bordered?: boolean;
  labelFontFamily?: string;
  labelAccent?: boolean;
  destructive?: boolean;
  showChevron?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  valueRefreshing?: boolean;
  refreshingAccessibilityLabel?: string;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      <View style={styles.rowIconSlot}>{icon ?? <View style={styles.rowIconPlaceholder} />}</View>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            labelAccent && styles.rowLabelAccent,
            destructive && styles.rowLabelDestructive,
            labelFontFamily ? { fontFamily: labelFontFamily } : null,
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={styles.rowTrailing}>{trailing}</View>
      ) : valueRefreshing ? (
        <View style={styles.statusRefreshWrap}>
          {value ? (
            <Text style={styles.rowValue} numberOfLines={2}>
              {value}
            </Text>
          ) : null}
          <ActivityIndicator
            color={THEME.brandPrimary}
            size="small"
            style={styles.statusSpinner}
            accessibilityLabel={refreshingAccessibilityLabel}
          />
        </View>
      ) : value ? (
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : showChevron && onPress ? (
        <ChevronRight size={ICON_SIZES.md} color={MENU_CHEVRON} strokeWidth={2} />
      ) : (
        <View style={styles.rowValuePlaceholder} />
      )}
    </>
  );

  const wrap = (node: ReactNode) => (
    <View style={styles.rowWrap}>
      {bordered ? <View style={styles.rowDivider} /> : null}
      {node}
    </View>
  );

  if (onPress) {
    return wrap(
      <TouchableOpacity
        style={styles.row}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={onLongPress ? 700 : undefined}
        activeOpacity={0.65}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        {content}
      </TouchableOpacity>,
    );
  }

  return wrap(
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? [label, detail, value].filter(Boolean).join(', ')}
    >
      {content}
    </View>,
  );
}

const styles = StyleSheet.create({
  menuGroup: {
    marginBottom: verticalScale(22),
  },
  menuGroupTitle: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: MENU_HEADER,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: SPACING.lg,
    marginBottom: verticalScale(8),
  },
  menuCard: {
    backgroundColor: MENU_CARD,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: MENU_SEPARATOR,
    overflow: 'hidden',
  },
  rowWrap: {
    backgroundColor: MENU_CARD,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: MENU_SEPARATOR,
    marginLeft: scale(52),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    paddingRight: SPACING.md,
    paddingVertical: verticalScale(14),
    minHeight: scale(52),
    backgroundColor: MENU_CARD,
  },
  rowIconSlot: {
    width: scale(36),
    marginRight: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconPlaceholder: {
    width: scale(22),
    height: scale(22),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    fontWeight: '500',
  },
  rowDetail: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginTop: 2,
  },
  rowLabelAccent: {
    color: THEME.brandPrimary,
    fontWeight: '700',
  },
  rowLabelDestructive: {
    color: '#C62828',
    fontWeight: '600',
  },
  rowValue: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '42%',
    textAlign: 'right',
  },
  rowTrailing: {
    marginLeft: SPACING.sm,
  },
  statusRefreshWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '50%',
  },
  statusSpinner: {
    marginLeft: 8,
  },
  rowValuePlaceholder: {
    width: scale(10),
  },
});

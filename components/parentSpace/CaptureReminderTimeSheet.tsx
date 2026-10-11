import { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  CAPTURE_REMINDER_TIME_SLOTS,
  snapCaptureReminderTimeToSlot,
} from '@/lib/notificationPrefs';
import { MENU_BG, MENU_CARD, MENU_SEPARATOR } from '@/components/parentSpace/menuUi';

type Props = {
  visible: boolean;
  selectedTime: string;
  onSelect: (time: string) => void;
  onClose: () => void;
};

export default function CaptureReminderTimeSheet({
  visible,
  selectedTime,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const listRef = useRef<FlatList<string>>(null);
  const selected = useMemo(
    () => snapCaptureReminderTimeToSlot(selectedTime),
    [selectedTime],
  );
  const selectedIndex = useMemo(
    () => Math.max(0, CAPTURE_REMINDER_TIME_SLOTS.indexOf(selected)),
    [selected],
  );

  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index: selectedIndex,
          animated: false,
          viewPosition: 0.35,
        });
      } catch {
        /* index hors écran au 1er layout */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [visible, selectedIndex]);

  const renderItem = ({ item }: ListRenderItemInfo<string>) => {
    const isSelected = item === selected;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={item}
      >
        <Text
          style={[
            styles.rowLabel,
            isSelected && styles.rowLabelSelected,
            (isSelected ? dm600 : dm500) ? { fontFamily: isSelected ? dm600 : dm500 } : null,
          ]}
        >
          {item}
        </Text>
        {isSelected ? (
          <Check size={ICON_SIZES.md} color={THEME.brandPrimary} strokeWidth={2.4} />
        ) : (
          <View style={styles.checkPlaceholder} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, verticalScale(12)) }]}>
          <View style={styles.handle} />
          <Text style={[styles.title, dm600 ? { fontFamily: dm600 } : null]}>
            {t('parent.application.captureReminderTimeTitle')}
          </Text>
          <Text style={[styles.subtitle, dm500 ? { fontFamily: dm500 } : null]}>
            {t('parent.application.captureReminderTimeSheetHint')}
          </Text>
          <FlatList
            ref={listRef}
            data={CAPTURE_REMINDER_TIME_SLOTS as string[]}
            keyExtractor={(item) => item}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            onScrollToIndexFailed={({ index }) => {
              listRef.current?.scrollToOffset({
                offset: Math.max(0, index * ROW_HEIGHT - verticalScale(80)),
                animated: false,
              });
            }}
          />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <Text style={[styles.cancelText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const ROW_HEIGHT = verticalScale(52);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: MENU_BG,
    borderTopLeftRadius: scale(16),
    borderTopRightRadius: scale(16),
    maxHeight: '72%',
    paddingTop: verticalScale(10),
  },
  handle: {
    alignSelf: 'center',
    width: scale(36),
    height: scale(4),
    borderRadius: scale(2),
    backgroundColor: MENU_SEPARATOR,
    marginBottom: verticalScale(12),
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
    color: THEME.textMuted,
    textAlign: 'center',
    marginTop: verticalScale(4),
    marginBottom: verticalScale(12),
    paddingHorizontal: SPACING.lg,
  },
  list: {
    backgroundColor: MENU_CARD,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: MENU_SEPARATOR,
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: verticalScale(4),
  },
  row: {
    height: ROW_HEIGHT,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: MENU_CARD,
  },
  rowLabel: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '500',
    color: THEME.textPrimary,
  },
  rowLabelSelected: {
    color: THEME.brandPrimary,
    fontWeight: '700',
  },
  checkPlaceholder: {
    width: ICON_SIZES.md,
    height: ICON_SIZES.md,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: MENU_SEPARATOR,
    marginLeft: SPACING.lg,
  },
  cancelBtn: {
    marginTop: verticalScale(10),
    marginHorizontal: SPACING.md,
    backgroundColor: MENU_CARD,
    borderRadius: scale(12),
    minHeight: scale(48),
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
});

/**
 * Édition manuelle de la date d’événement d’un souvenir (Low Friction : pas d’Alert).
 * Colonnes jour / mois / année — pas de module natif DateTimePicker (OTA-safe).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, ICON_SIZES, SPACING } from '@/constants/sizes';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

type Props = {
  visible: boolean;
  initialIso: string;
  onClose: () => void;
  onSave: (iso: string) => void;
};

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function partsFromIso(iso: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const t = Date.parse(iso);
  const base = Number.isFinite(t) ? new Date(t) : new Date();
  return {
    y: base.getFullYear(),
    m: base.getMonth() + 1,
    d: base.getDate(),
    h: base.getHours(),
    mi: base.getMinutes(),
    s: base.getSeconds(),
  };
}

export default function EditMemoryDateModal({ visible, initialIso, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const initial = useMemo(() => partsFromIso(initialIso), [initialIso]);
  const [year, setYear] = useState(initial.y);
  const [month, setMonth] = useState(initial.m);
  const [day, setDay] = useState(initial.d);

  useEffect(() => {
    if (!visible) return;
    const p = partsFromIso(initialIso);
    setYear(p.y);
    setMonth(p.m);
    setDay(p.d);
  }, [visible, initialIso]);

  const maxDay = daysInMonth(year, month);
  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [day, maxDay]);

  const years = useMemo(() => {
    const nowY = new Date().getFullYear();
    const out: number[] = [];
    for (let y = nowY; y >= 2000; y--) out.push(y);
    return out;
  }, []);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay],
  );

  const commit = () => {
    const p = partsFromIso(initialIso);
    const local = new Date(year, month - 1, day, p.h, p.mi, p.s);
    if (Number.isNaN(local.getTime())) return;
    onSave(local.toISOString());
    onClose();
  };

  const renderCol = <T extends number>(
    data: T[],
    selected: T,
    onSelect: (v: T) => void,
    format: (v: T) => string,
  ) => (
    <FlatList
      data={data}
      keyExtractor={v => String(v)}
      style={styles.col}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }: ListRenderItemInfo<T>) => {
        const selectedRow = item === selected;
        return (
          <Pressable
            onPress={() => onSelect(item)}
            style={[styles.row, selectedRow && styles.rowSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedRow }}
          >
            <Text
              style={[
                styles.rowText,
                { fontFamily: selectedRow ? dm600 : dm500 },
                selectedRow && styles.rowTextSelected,
              ]}
            >
              {format(item)}
            </Text>
          </Pressable>
        );
      }}
    />
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('cancel')} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { fontFamily: dm700 }]}>
              {t('fil.editDate.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('cancel')}>
              <X size={ICON_SIZES.sm} color={THEME.textMuted} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={styles.cols}>
            {renderCol(days, day, setDay, v => String(v).padStart(2, '0'))}
            {renderCol(months, month, setMonth, v => String(v).padStart(2, '0'))}
            {renderCol(years, year, setYear, v => String(v))}
          </View>
          <PetitmoPrimaryPressable onPress={commit} style={styles.saveBtn}>
            <Text style={petitmoCtaStyles.primaryText}>{t('fil.editDate.save')}</Text>
          </PetitmoPrimaryPressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: THEME.bg,
    borderTopLeftRadius: scale(18),
    borderTopRightRadius: scale(18),
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
  },
  cols: {
    flexDirection: 'row',
    height: verticalScale(220),
    gap: scale(8),
  },
  col: {
    flex: 1,
  },
  row: {
    paddingVertical: verticalScale(10),
    alignItems: 'center',
    borderRadius: scale(10),
  },
  rowSelected: {
    backgroundColor: 'rgba(81,84,94,0.1)',
  },
  rowText: {
    fontSize: FONT_SIZES.md,
    color: THEME.textMuted,
  },
  rowTextSelected: {
    color: THEME.textPrimary,
  },
  saveBtn: {
    marginTop: SPACING.md,
    alignSelf: 'stretch',
  },
});

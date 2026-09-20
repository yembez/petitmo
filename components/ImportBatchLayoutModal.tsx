import { View, Text, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { emptyStateStyles } from '@/constants/emptyStateStyles';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import MotionPressable from '@/components/MotionPressable';

const ICON_INK = THEME.textPrimary;
const CELL = scale(11);
const GAP = scale(4);
const STROKE = 1.5;

type ImportBatchLayoutModalProps = {
  visible: boolean;
  count: number;
  onChooseSinglePost: () => void;
  onChooseSeparatePosts: () => void;
  onDismiss: () => void;
};

/** 4 carrés outline en grille 2×2 — « toutes dans un seul post ». */
function IconFourSquares() {
  return (
    <View style={styles.glyphGrid} accessibilityElementsHidden>
      <View style={styles.glyphCell} />
      <View style={styles.glyphCell} />
      <View style={styles.glyphCell} />
      <View style={styles.glyphCell} />
    </View>
  );
}

/** 2 carrés outline empilés — « une photo par post ». */
function IconTwoSquaresStacked() {
  return (
    <View style={styles.glyphStack} accessibilityElementsHidden>
      <View style={[styles.glyphCell, styles.glyphCellWide]} />
      <View style={[styles.glyphCell, styles.glyphCellWide]} />
    </View>
  );
}

export default function ImportBatchLayoutModal({
  visible,
  count,
  onChooseSinglePost,
  onChooseSeparatePosts,
  onDismiss,
}: ImportBatchLayoutModalProps) {
  const { t } = useAppTranslation('common');
  const insets = useSafeAreaInsets();
  const n = Math.max(2, count);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top + verticalScale(24),
            paddingBottom: Math.max(insets.bottom, verticalScale(16)),
          },
        ]}
      >
        <View style={[emptyStateStyles.container, styles.body]}>
          <Text style={emptyStateStyles.title}>{t('import.batchLayout.title')}</Text>
          <Text style={[emptyStateStyles.subtitle, styles.descriptionGap]}>
            {t('import.batchLayout.subtitle', { count: n })}
          </Text>

          <MotionPressable
            style={styles.choiceBlock}
            onPress={onChooseSinglePost}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('import.batchLayout.singleA11y')}
          >
            <View style={emptyStateStyles.iconDisc}>
              <IconFourSquares />
            </View>
            <Text style={styles.choiceTitle}>{t('import.batchLayout.singleTitle')}</Text>
            <Text style={emptyStateStyles.subtitle}>{t('import.batchLayout.singleSub')}</Text>
          </MotionPressable>

          <MotionPressable
            style={styles.choiceBlock}
            onPress={onChooseSeparatePosts}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('import.batchLayout.separateA11y')}
          >
            <View style={emptyStateStyles.iconDisc}>
              <IconTwoSquaresStacked />
            </View>
            <Text style={styles.choiceTitle}>{t('import.batchLayout.separateTitle')}</Text>
            <Text style={emptyStateStyles.subtitle}>
              {t('import.batchLayout.separateSub', { count: n })}
            </Text>
          </MotionPressable>

          <MotionPressable
            style={styles.cancelBtn}
            onPress={onDismiss}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </MotionPressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /** Même fond écran que Fil / empty Favoris — pas de carte ni blur. */
  screen: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  descriptionGap: {
    marginBottom: verticalScale(28),
  },
  choiceBlock: {
    alignItems: 'center',
    marginBottom: verticalScale(28),
    maxWidth: scale(320),
  },
  choiceTitle: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(6),
    marginTop: verticalScale(-6),
  },
  glyphGrid: {
    width: CELL * 2 + GAP,
    height: CELL * 2 + GAP,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  glyphStack: {
    gap: GAP,
    alignItems: 'center',
  },
  glyphCell: {
    width: CELL,
    height: CELL,
    borderWidth: STROKE,
    borderColor: ICON_INK,
    backgroundColor: 'transparent',
  },
  glyphCellWide: {
    width: CELL * 2 + GAP,
  },
  cancelBtn: {
    marginTop: verticalScale(8),
    paddingVertical: verticalScale(12),
    alignItems: 'center',
  },
  cancelText: {
    fontSize: scale(16),
    lineHeight: scale(23),
    color: THEME.textMuted,
    textAlign: 'center',
  },
});

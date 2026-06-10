import { View, Text, StyleSheet, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Layers, LayoutGrid } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ImportBatchLayoutModalProps = {
  visible: boolean;
  count: number;
  onChooseSinglePost: () => void;
  onChooseSeparatePosts: () => void;
  onDismiss: () => void;
};

export default function ImportBatchLayoutModal({
  visible,
  count,
  onChooseSinglePost,
  onChooseSeparatePosts,
  onDismiss,
}: ImportBatchLayoutModalProps) {
  const n = Math.max(2, count);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <BlurView intensity={40} style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss} />

        <View style={styles.modalContainer} pointerEvents="box-none">
          <View style={styles.modal}>
            <Text style={styles.title}>Comment les afficher ?</Text>
            <Text style={styles.description}>
              Tu as sélectionné {n} photos. Tu peux les regrouper dans un seul souvenir ou créer un post par
              photo.
            </Text>

            <TouchableOpacity
              style={styles.choiceRow}
              onPress={onChooseSinglePost}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Un seul post avec toutes les photos"
            >
              <View style={[styles.iconWrap, { backgroundColor: '#E8F0E8' }]}>
                <Layers size={ICON_SIZES.lg} color={THEME.accent} strokeWidth={2} />
              </View>
              <View style={styles.choiceTexts}>
                <Text style={styles.choiceTitle}>Un seul post</Text>
                <Text style={styles.choiceSub}>Toutes les photos dans le même souvenir (comme avant)</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.choiceRow}
              onPress={onChooseSeparatePosts}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Un post par photo"
            >
              <View style={[styles.iconWrap, { backgroundColor: '#E5F1F7' }]}>
                <LayoutGrid size={ICON_SIZES.lg} color="#5E7C88" strokeWidth={2} />
              </View>
              <View style={styles.choiceTexts}>
                <Text style={styles.choiceTitle}>Un post par photo</Text>
                <Text style={styles.choiceSub}>{n} souvenirs séparés dans le fil</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss} activeOpacity={0.8}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    width: SCREEN_WIDTH,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  modal: {
    width: '100%',
    maxWidth: scale(400),
    backgroundColor: THEME.bg,
    borderRadius: scale(20),
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: verticalScale(8) },
    shadowOpacity: 0.12,
    shadowRadius: scale(24),
    elevation: 8,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: '#3F4A5A',
    textAlign: 'center',
    marginBottom: verticalScale(10),
  },
  description: {
    fontSize: FONT_SIZES.base,
    color: '#8791A1',
    textAlign: 'center',
    lineHeight: verticalScale(22),
    marginBottom: verticalScale(20),
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F8FA',
    borderRadius: scale(16),
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.md,
  },
  iconWrap: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTexts: {
    flex: 1,
  },
  choiceTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: '#3F4A5A',
    marginBottom: verticalScale(4),
  },
  choiceSub: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
    lineHeight: verticalScale(18),
  },
  cancelBtn: {
    marginTop: verticalScale(4),
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: FONT_SIZES.md,
    color: '#8791A1',
    fontWeight: '500',
  },
});

import { View, Text, StyleSheet, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Camera, Mic, ImageIcon, MapPin } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { emptyStateStyles } from '@/constants/emptyStateStyles';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type PermissionType = 'camera' | 'microphone' | 'photos' | 'location';

interface PermissionModalProps {
  visible: boolean;
  type: PermissionType;
  onRequestPermission: () => void;
  onCancel: () => void;
}

const permissionConfig = {
  camera: {
    icon: Camera,
    title: 'Accès à la caméra',
    description:
      "Petit Cœur a juste besoin de ta permission une fois pour te permettre de capturer vos photos et vidéos.",
    iconColor: THEME.textPrimary,
  },
  microphone: {
    icon: Mic,
    title: 'Accès au micro',
    description:
      "Petit Cœur a juste besoin de ta permission une fois pour te permettre d'enregistrer les sons précieux.",
    iconColor: THEME.textPrimary,
  },
  photos: {
    icon: ImageIcon,
    title: 'Accès à la photothèque',
    description:
      "Petit Cœur a juste besoin de ta permission une fois pour te permettre d'importer vos photos et vidéos existants.",
    iconColor: THEME.textPrimary,
  },
  location: {
    icon: MapPin,
    title: 'Le lieu de vos souvenirs',
    description:
      'Pour te rappeler où vous étiez — à la maison, en balade, en voyage.',
    iconColor: THEME.brandPrimary,
  },
};

export default function PermissionModal({ visible, type, onRequestPermission, onCancel }: PermissionModalProps) {
  const config = permissionConfig[type];
  const Icon = config.icon;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <BlurView intensity={40} style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onCancel}
        />

        <View style={styles.modalContainer}>
          <View style={styles.modal}>
            <View style={emptyStateStyles.iconDisc}>
              <Icon size={ICON_SIZES.xl} color={config.iconColor} strokeWidth={2} />
            </View>

            <Text style={[emptyStateStyles.title, styles.titleGap]}>{config.title}</Text>

            <Text style={[emptyStateStyles.subtitle, styles.descriptionGap]}>
              {config.description}
            </Text>

            <View style={styles.buttons}>
              <PetitmoPrimaryPressable
                style={[petitmoCtaStyles.primaryFullWidth, styles.authorizeButton]}
                onPress={onRequestPermission}
                activeOpacity={0.9}
              >
                <Text style={[petitmoCtaStyles.primaryText, styles.authorizeButtonText]}>
                  Autoriser
                </Text>
              </PetitmoPrimaryPressable>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Plus tard</Text>
              </TouchableOpacity>
            </View>
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
    width: SCREEN_WIDTH - scale(48),
    maxWidth: scale(400),
  },
  modal: {
    backgroundColor: THEME.bg,
    borderRadius: scale(24),
    padding: SPACING.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(8) },
    shadowOpacity: 0.2,
    shadowRadius: scale(24),
    elevation: 8,
  },
  /** emptyStateStyles.title a déjà marginBottom — on resserre un peu pour la modale. */
  titleGap: {
    marginBottom: verticalScale(10),
  },
  descriptionGap: {
    marginBottom: SPACING.xl,
  },
  buttons: {
    width: '100%',
    gap: SPACING.sm,
  },
  authorizeButton: {
    paddingVertical: verticalScale(14),
  },
  authorizeButtonText: {
    fontSize: FONT_SIZES.base,
  },
  cancelButton: {
    width: '100%',
    paddingVertical: verticalScale(12),
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: scale(16),
    fontWeight: '500',
    color: THEME.textSecondary,
  },
});

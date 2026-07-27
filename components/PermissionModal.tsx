import { View, Text, StyleSheet, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Camera, Mic, ImageIcon, Lock } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type PermissionType = 'camera' | 'microphone' | 'photos';

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
    description: "L'app Petitmo a juste besoin de ta permission une fois pour te permettre de capturer vos photos et vidéos.",
    color: '#E5F1F7',
    iconColor: '#5E7C88',
  },
  microphone: {
    icon: Mic,
    title: 'Accès au micro',
    description: "L'app Petitmo a juste besoin de ta permission une fois pour te permettre d'enregistrer les sons précieux.",
    color: '#E8F2F6',
    iconColor: THEME.accent,
  },
  photos: {
    icon: ImageIcon,
    title: 'Accès à la photothèque',
    description: "L'app Petitmo a juste besoin de ta permission une fois pour te permettre d'importer vos photos et vidéos existantes.",
    color: '#F3EAF3',
    iconColor: '#B8A8C8',
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
            <View style={[styles.iconContainer, { backgroundColor: config.color }]}>
              <Icon size={ICON_SIZES.xl} color={config.iconColor} strokeWidth={2} />
            </View>

            <Text style={styles.title}>{config.title}</Text>

            <Text style={styles.description}>{config.description}</Text>

            <View style={styles.privacyBadge}>
              <Lock size={scale(16)} color="#88a5b0" strokeWidth={2} />
              <Text style={styles.privacyText}>
                Rassure-toi, tout reste totalement privé et sécurisé
              </Text>
            </View>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={[petitmoCtaStyles.primary, petitmoCtaStyles.primaryFullWidth, styles.authorizeButton]}
                onPress={onRequestPermission}
                activeOpacity={0.9}
              >
                <Text style={[petitmoCtaStyles.primaryText, styles.authorizeButtonText]}>Autoriser</Text>
              </TouchableOpacity>

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
  iconContainer: {
    width: scale(80),
    height: scale(80),
    borderRadius: scale(40),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: '#5E7C88',
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  description: {
    fontSize: FONT_SIZES.base,
    color: '#88a5b0',
    textAlign: 'center',
    lineHeight: scale(22),
    marginBottom: SPACING.lg,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: '#F5F7F9',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: scale(100),
    marginBottom: SPACING.xl,
  },
  privacyText: {
    fontSize: scale(12),
    color: '#88a5b0',
    fontWeight: '500',
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
    fontSize: FONT_SIZES.base,
    fontWeight: '500',
    color: '#B8B2A8',
  },
});

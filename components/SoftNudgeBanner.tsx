/**
 * Bannière soft Fil / Capturer — texte + CTA + X pastille hors container.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';

type Props = {
  bottom: number;
  body: string;
  cta: string;
  onPress: () => void;
  onClose: () => void;
  closeA11y: string;
};

export default function SoftNudgeBanner({
  bottom,
  body,
  cta,
  onPress,
  onClose,
  closeA11y,
}: Props) {
  return (
    <View style={[styles.shell, { bottom }]} pointerEvents="box-none">
      <TouchableOpacity style={styles.banner} activeOpacity={0.9} onPress={onPress}>
        <Text style={styles.text} numberOfLines={2}>
          {body}
        </Text>
        <Text style={styles.cta}>{cta}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.close}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={closeA11y}
        onPress={onClose}
      >
        <X size={scale(12)} color="#1C1C1E" strokeWidth={2.6} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 40,
  },
  banner: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    flex: 1,
  },
  cta: {
    color: THEME.brandCtaOrange,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
  /** Pastille hors container, coin haut-droit — n’empiète pas sur le texte. */
  close: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
});

import { TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ellipsis } from 'lucide-react-native';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';

const DEFAULT_SIZE = scale(40);
const ICON_SIZE = scale(20);

type Props = {
  size?: number;
};

/** Trois points circulaires — ouvre l’espace parent (Paramètres). */
export default function SettingsHeaderButton({ size = DEFAULT_SIZE }: Props) {
  const router = useRouter();
  const { t } = useAppTranslation('common');

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={t('tabs.settings')}
      onPress={() => router.push('/parent-space')}
      activeOpacity={0.72}
      hitSlop={8}
      style={[
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Ellipsis size={ICON_SIZE} color={THEME.textPrimary} strokeWidth={2.15} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 49, 38, 0.08)',
  },
});

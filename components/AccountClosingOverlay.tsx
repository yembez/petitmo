/**
 * Overlay global déconnexion / suppression (racine) — ne disparaît pas
 * avec le unmount d’Espace parent.
 */
import { useEffect, useState } from 'react';
import { DeviceEventEmitter, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ACCOUNT_CLOSING_UI_EVENT,
  peekAccountClosingUi,
  type AccountClosingUiState,
} from '@/lib/accountClosingUi';
import { FeedLoadingDots } from '@/components/FeedLoadingDots';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';

export default function AccountClosingOverlay() {
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { dm500 } = useDmSansFamilyFlowFonts();
  const [ui, setUi] = useState<AccountClosingUiState>(() => peekAccountClosingUi());

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      ACCOUNT_CLOSING_UI_EVENT,
      (next: AccountClosingUiState) => setUi(next),
    );
    setUi(peekAccountClosingUi());
    return () => sub.remove();
  }, []);

  if (!ui.visible) return null;

  const label =
    ui.mode === 'delete'
      ? t('parent.account.deletingAccount')
      : t('parent.account.signingOut');

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
      pointerEvents="auto"
      accessibilityViewIsModal
      accessibilityLabel={label}
    >
      <FeedLoadingDots color={THEME.textPrimary} accessibilityElementsHidden />
      <Text style={[styles.label, dm500 ? { fontFamily: dm500 } : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.bgScreen,
    gap: verticalScale(16),
    paddingHorizontal: SPACING.lg,
  },
  label: {
    fontSize: scale(FONT_SIZES.md),
    fontWeight: '500',
    color: THEME.textSecondary,
    textAlign: 'center',
  },
});

/**
 * Overlay restore cloud — visible après délai court si SQLite était vide.
 * Ne remplace pas le splash marque ; fond doux charte + message soft.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CLOUD_RESTORE_UI_EVENT,
  peekCloudRestoreUi,
  type CloudRestoreUiState,
} from '@/lib/cloudRestoreUi';
import { BRAND_SPLASH_GRADIENT } from '@/constants/captureScreenPalette';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';

export default function CloudRestoreOverlay() {
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const [ui, setUi] = useState<CloudRestoreUiState>(() => peekCloudRestoreUi());

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      CLOUD_RESTORE_UI_EVENT,
      (next: CloudRestoreUiState) => {
        setUi(next);
      },
    );
    setUi(peekCloudRestoreUi());
    return () => sub.remove();
  }, []);

  if (!ui.visible) return null;

  const name = ui.childName?.trim();
  const title = name
    ? t('restore.bodyWithName', { name })
    : t('restore.bodyGeneric');

  return (
    <View style={styles.root} pointerEvents="auto" accessibilityViewIsModal>
      <LinearGradient
        colors={[...BRAND_SPLASH_GRADIENT]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + verticalScale(48),
            paddingBottom: insets.bottom + verticalScale(32),
          },
        ]}
      >
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={[styles.title, { fontFamily: dm600 }]}>{title}</Text>
        <Text style={[styles.hint, { fontFamily: dm500 }]}>{t('restore.hint')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    gap: verticalScale(16),
  },
  title: {
    marginTop: verticalScale(8),
    color: '#FFFFFF',
    fontSize: scale(FONT_SIZES.lg),
    lineHeight: scale(FONT_SIZES.lg * 1.35),
    textAlign: 'center',
    maxWidth: scale(320),
  },
  hint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: scale(FONT_SIZES.sm),
    lineHeight: scale(FONT_SIZES.sm * 1.4),
    textAlign: 'center',
    maxWidth: scale(280),
  },
});

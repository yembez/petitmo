/**
 * Étape post-auth (avant create-child) : photothèque + notifications.
 * Règle d’or V2 : compte + local-first — pas de sync ici.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Images } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, ICON_SIZES, SPACING } from '@/constants/sizes';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  getNotificationsGranted,
  getPhotoLibraryGranted,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
  requestPhotoLibraryAccess,
} from '@/lib/onboardingPermissions';
import {
  hasSeenOnboardingPermissions,
  markOnboardingPermissionsSeen,
} from '@/lib/onboardingPermissionsSeen';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { replaceAfterOnboardingPermissions } from '@/utils/onboardingPermissionsRoute';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';

export default function OnboardingPermissionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photosOn, setPhotosOn] = useState(false);
  const [notifsOn, setNotifsOn] = useState(false);
  const [notifsAvailable, setNotifsAvailable] = useState(true);

  useEffect(() => {
    void (async () => {
      const uid = peekLastRealAuthUserId();
      if (await hasSeenOnboardingPermissions(uid)) {
        replaceAfterOnboardingPermissions(router);
        return;
      }
      const [photos, notifs, notifsOk] = await Promise.all([
        getPhotoLibraryGranted(),
        getNotificationsGranted(),
        isNotificationsModuleAvailable(),
      ]);
      setPhotosOn(photos);
      setNotifsOn(notifs);
      setNotifsAvailable(notifsOk);
      setReady(true);
    })();
  }, [router]);

  const finish = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
      hydrateTabScreensFromSqliteSync();
      replaceAfterOnboardingPermissions(router);
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  const onTogglePhotos = useCallback(async (next: boolean) => {
    if (next) {
      const granted = await requestPhotoLibraryAccess();
      setPhotosOn(granted);
      if (!granted) {
        Alert.alert(t('permissions.deniedTitle'), t('permissions.photosDeniedBody'), [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('permissions.openSettings'),
            onPress: () => void Linking.openSettings(),
          },
        ]);
      }
      return;
    }
    if (await getPhotoLibraryGranted()) {
      Alert.alert(t('permissions.revokeTitle'), t('permissions.revokeBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('permissions.openSettings'),
          onPress: () => void Linking.openSettings(),
        },
      ]);
      setPhotosOn(true);
    } else {
      setPhotosOn(false);
    }
  }, [t]);

  const onToggleNotifs = useCallback(async (next: boolean) => {
    if (!notifsAvailable) {
      setNotifsOn(false);
      Alert.alert(t('permissions.deniedTitle'), t('permissions.notifsUnavailableBody'));
      return;
    }
    if (next) {
      const granted = await requestNotificationsAccess();
      setNotifsOn(granted);
      if (!granted) {
        Alert.alert(t('permissions.deniedTitle'), t('permissions.notifsDeniedBody'), [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('permissions.openSettings'),
            onPress: () => void Linking.openSettings(),
          },
        ]);
      }
      return;
    }
    if (await getNotificationsGranted()) {
      Alert.alert(t('permissions.revokeTitle'), t('permissions.revokeBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('permissions.openSettings'),
          onPress: () => void Linking.openSettings(),
        },
      ]);
      setNotifsOn(true);
    } else {
      setNotifsOn(false);
    }
  }, [notifsAvailable, t]);

  if (!fontsLoaded || !ready) {
    return (
      <View style={[styles.shell, styles.center]}>
        <ActivityIndicator color={THEME.brandCtaOrange} size="large" />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.shell,
        {
          paddingTop: insets.top + verticalScale(16),
          paddingBottom: Math.max(insets.bottom, verticalScale(16)),
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, dm700 && { fontFamily: dm700 }]}>
          {t('permissions.title')}
        </Text>
        <Text style={[styles.subtitle, dm500 && { fontFamily: dm500 }]}>
          {t('permissions.subtitle')}
        </Text>

        <View style={styles.rows}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Images size={ICON_SIZES.lg} color={THEME.brandCtaOrange} strokeWidth={2} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, dm600 && { fontFamily: dm600 }]}>
                {t('permissions.photosTitle')}
              </Text>
              <Text style={[styles.rowBody, dm500 && { fontFamily: dm500 }]}>
                {t('permissions.photosBody')}
              </Text>
            </View>
            <Switch
              value={photosOn}
              onValueChange={v => void onTogglePhotos(v)}
              trackColor={{ false: '#E5E5EA', true: 'rgba(253, 119, 100, 0.45)' }}
              thumbColor={photosOn ? THEME.brandCtaOrange : '#FFFFFF'}
              ios_backgroundColor="#E5E5EA"
              accessibilityLabel={t('permissions.photosTitle')}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Bell size={ICON_SIZES.lg} color={THEME.brandPrimary} strokeWidth={2} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, dm600 && { fontFamily: dm600 }]}>
                {t('permissions.notifsTitle')}
              </Text>
              <Text style={[styles.rowBody, dm500 && { fontFamily: dm500 }]}>
                {t('permissions.notifsBody')}
              </Text>
            </View>
            <Switch
              value={notifsOn}
              onValueChange={v => void onToggleNotifs(v)}
              trackColor={{ false: '#E5E5EA', true: 'rgba(252, 87, 87, 0.4)' }}
              thumbColor={notifsOn ? THEME.brandPrimary : '#FFFFFF'}
              ios_backgroundColor="#E5E5EA"
              accessibilityLabel={t('permissions.notifsTitle')}
            />
          </View>
        </View>

        <Text style={[styles.hint, dm500 && { fontFamily: dm500 }]}>
          {t('permissions.hint')}
        </Text>
      </View>

      <View style={styles.footer}>
        <PetitmoPrimaryPressable
          style={petitmoCtaStyles.primaryFullWidth}
          disabled={busy}
          onPress={() => void finish()}
          activeOpacity={0.9}
        >
          {busy ? (
            <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={[petitmoCtaStyles.primaryText, dm600 && { fontFamily: dm600 }]}>
              {t('permissions.continueCta')}
            </Text>
          )}
        </PetitmoPrimaryPressable>

        <TouchableOpacity
          onPress={() => void finish()}
          disabled={busy}
          style={styles.skipBtn}
          hitSlop={8}
        >
          <Text style={[styles.skipText, dm500 && { fontFamily: dm500 }]}>
            {t('permissions.skip')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
    paddingHorizontal: scale(24),
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: {
    flex: 1,
    paddingTop: verticalScale(24),
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: verticalScale(10),
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: THEME.textMuted,
    lineHeight: scale(22),
    marginBottom: verticalScale(32),
  },
  rows: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(16),
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(6),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: verticalScale(14),
    gap: scale(12),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginLeft: scale(52),
  },
  iconWrap: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(12),
    backgroundColor: 'rgba(253, 119, 100, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    paddingRight: scale(4),
  },
  rowTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: THEME.textPrimary,
    marginBottom: verticalScale(2),
  },
  rowBody: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    lineHeight: scale(18),
  },
  hint: {
    marginTop: verticalScale(20),
    textAlign: 'center',
    fontSize: FONT_SIZES.sm,
    color: THEME.textSecondary,
  },
  footer: {
    paddingTop: verticalScale(8),
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: verticalScale(14),
  },
  skipText: {
    fontSize: FONT_SIZES.base,
    color: THEME.textMuted,
    fontWeight: '500',
  },
});

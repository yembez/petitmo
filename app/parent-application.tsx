import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Share,
} from 'react-native';
import { usePathname } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, Cloud, Image as ImageIcon, RefreshCw, Share2 } from 'lucide-react-native';
import ParentSubpageShell from '@/components/parentSpace/ParentSubpageShell';
import { MenuGroup, MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { THEME } from '@/constants/theme';
import {
  collectBugReportContext,
  formatAppVersionLabel,
} from '@/lib/bugReportContext';
import { captureSentrySmokeTest, isSentryEnabled } from '@/lib/sentry';
import { applyAvailableOtaUpdate } from '@/services/applyOtaUpdate';
import {
  peekCachedExpoPushToken,
  registerPushTokenInBackground,
} from '@/services/registerPushToken';
import {
  getNotificationsGranted,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
  requestPhotoLibraryAccess,
} from '@/lib/onboardingPermissions';
import { setMediaLibraryOptIn } from '@/lib/mediaLibraryOptIn';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import {
  getLocalMemoriesPendingCloudSync,
} from '@/lib/localDb';
import {
  peekHasRealAuthAccount,
  peekOfflineLocalResumeActive,
} from '@/lib/authAccount';

export default function ParentApplicationScreen() {
  const pathname = usePathname();
  const { t } = useAppTranslation('common');
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const [versionLabel, setVersionLabel] = useState('—');
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState('');
  const [hasRealAccount, setHasRealAccount] = useState(() => peekHasRealAuthAccount());

  useFocusEffect(
    useCallback(() => {
      setHasRealAccount(peekHasRealAuthAccount());
      void collectBugReportContext({
        pathname,
        sentryEnabled: isSentryEnabled(),
      }).then((ctx) => setVersionLabel(formatAppVersionLabel(ctx)));
      if (peekHasRealAuthAccount() || peekOfflineLocalResumeActive()) {
        const pending = getLocalMemoriesPendingCloudSync().length;
        setBackupStatus(
          peekOfflineLocalResumeActive()
            ? t('parent.account.backupOfflinePaused')
            : pending > 0
              ? `Synchronisation (${pending})`
              : 'À jour',
        );
      } else {
        setBackupStatus('');
      }
    }, [pathname, t]),
  );

  const handleCheckForUpdate = useCallback(() => {
    setUpdateCheckBusy(true);
    void (async () => {
      try {
        const reloaded = await applyAvailableOtaUpdate({
          reload: true,
          waitForNativeDownloadMs: 20_000,
        });
        if (reloaded) return;
        const ctx = await collectBugReportContext({
          pathname,
          sentryEnabled: isSentryEnabled(),
        });
        setVersionLabel(formatAppVersionLabel(ctx));
        Alert.alert(
          'Mise à jour',
          ctx.updateId.startsWith('embedded')
            ? `Toujours sur le bundle embarqué (${ctx.updateId}). Vérifie le Wi‑Fi, puis ferme complètement l’app et rouvre-la.`
            : `Tu es à jour · ${ctx.updateId.slice(0, 12)}…`,
        );
      } finally {
        setUpdateCheckBusy(false);
      }
    })();
  }, [pathname]);

  const handleSentrySmokeLongPress = useCallback(() => {
    Alert.alert(
      t('parent.application.sentrySmokeTitle'),
      t('parent.application.sentrySmokeBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('parent.application.sentrySmokeConfirm'),
          onPress: () => {
            if (!isSentryEnabled()) {
              Alert.alert(
                t('parent.application.sentrySmokeOffTitle'),
                t('parent.application.sentrySmokeOffBody'),
              );
              return;
            }
            const eventId = captureSentrySmokeTest();
            const id = eventId?.trim() || '—';
            Alert.alert(
              t('parent.application.sentrySmokeDoneTitle'),
              t('parent.application.sentrySmokeDoneBody', { eventId: id }),
              [
                { text: t('ok'), style: 'cancel' },
                {
                  text: t('parent.application.sentrySmokeShare'),
                  onPress: () => {
                    void Share.share({
                      message: [
                        'Petit Cœur — smoke Sentry HITL',
                        `eventId: ${id}`,
                        'Transférer aussi le mail support@ (draft à valider).',
                      ].join('\n'),
                    });
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [t]);

  const handleSharePushToken = useCallback(() => {
    void (async () => {
      let token = await peekCachedExpoPushToken();
      if (!token) token = await registerPushTokenInBackground();
      if (!token) {
        Alert.alert(t('parent.application.pushTokenMissingTitle'), t('parent.application.pushTokenMissingBody'));
        return;
      }
      try {
        await Share.share({
          message: token,
          title: t('parent.application.pushTokenShareTitle'),
        });
      } catch {
        Alert.alert(t('parent.application.pushTokenShareTitle'), `${token}\n\n${t('parent.application.pushTokenHint')}`);
      }
    })();
  }, [t]);

  const handleEnablePhotos = useCallback(() => {
    void (async () => {
      const granted = await requestPhotoLibraryAccess();
      if (granted) {
        await setMediaLibraryOptIn(true, peekLastRealAuthUserId());
        const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        Alert.alert(t('parent.application.photosGrantedTitle'), t('parent.application.photosGrantedBody'));
        return;
      }
      Alert.alert(t('parent.application.photosDeniedTitle'), t('parent.application.photosDeniedBody'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('parent.application.openSettings'), onPress: () => void Linking.openSettings() },
      ]);
    })();
  }, [t]);

  const handleEnableNotifications = useCallback(() => {
    void (async () => {
      if (!(await isNotificationsModuleAvailable())) {
        Alert.alert(
          t('parent.application.notificationsDeniedTitle'),
          t('parent.application.notificationsUnavailableBody'),
        );
        return;
      }
      if (await getNotificationsGranted()) {
        void registerPushTokenInBackground();
        const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        Alert.alert(
          t('parent.application.notificationsGrantedTitle'),
          t('parent.application.notificationsGrantedBody'),
        );
        return;
      }
      const granted = await requestNotificationsAccess();
      if (granted) {
        void registerPushTokenInBackground();
        const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        Alert.alert(
          t('parent.application.notificationsGrantedTitle'),
          t('parent.application.notificationsGrantedBody'),
        );
        return;
      }
      Alert.alert(
        t('parent.application.notificationsDeniedTitle'),
        t('parent.application.notificationsDeniedBody'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('parent.application.openSettings'), onPress: () => void Linking.openSettings() },
        ],
      );
    })();
  }, [t]);

  return (
    <ParentSubpageShell title="Application">
      <MenuGroup titleFontFamily={dm600}>
        <MenuRow
          icon={menuIcon(RefreshCw)}
          label={t('parent.application.checkUpdate')}
          detail={t('parent.application.versionPrefix', { label: versionLabel })}
          labelFontFamily={dm500}
          onPress={handleCheckForUpdate}
          onLongPress={handleSentrySmokeLongPress}
          disabled={updateCheckBusy}
          trailing={
            updateCheckBusy ? <ActivityIndicator size="small" color={THEME.textMuted} /> : undefined
          }
          accessibilityLabel={t('parent.application.checkUpdate')}
        />
        <MenuRow
          bordered
          icon={menuIcon(ImageIcon)}
          label={t('parent.application.enablePhotos')}
          detail={t('parent.application.enablePhotosHint')}
          labelFontFamily={dm500}
          onPress={handleEnablePhotos}
          accessibilityLabel={t('parent.application.enablePhotos')}
        />
        <MenuRow
          bordered
          icon={menuIcon(Bell)}
          label={t('parent.application.enableNotifications')}
          detail={t('parent.application.enableNotificationsHint')}
          labelFontFamily={dm500}
          onPress={handleEnableNotifications}
          accessibilityLabel={t('parent.application.enableNotifications')}
        />
        <MenuRow
          bordered
          icon={menuIcon(Share2)}
          label={t('parent.application.copyPushToken')}
          detail={t('parent.application.pushTokenHint')}
          labelFontFamily={dm500}
          onPress={handleSharePushToken}
          accessibilityLabel={t('parent.application.copyPushToken')}
        />
        {hasRealAccount ? (
          <MenuRow
            bordered
            icon={menuIcon(Cloud)}
            label="Sauvegarde cloud"
            detail={backupStatus || 'À jour'}
            labelFontFamily={dm500}
            showChevron={false}
          />
        ) : null}
      </MenuGroup>
    </ParentSubpageShell>
  );
}

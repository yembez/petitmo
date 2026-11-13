/**
 * Rappel du soir + Notifications — Espace parent (avant Mes commandes).
 * Low Friction : coupe le rappel en silence si les notifs iOS sont off.
 */
import { useCallback, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Linking, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, Moon } from 'lucide-react-native';
import CaptureReminderTimeSheet from '@/components/parentSpace/CaptureReminderTimeSheet';
import { MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { THEME } from '@/constants/theme';
import {
  getNotificationsGranted,
  getNotificationsPermissionStatus,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
} from '@/lib/onboardingPermissions';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { peekHasRealAuthAccount } from '@/lib/authAccount';
import {
  DEFAULT_NOTIFICATION_PREFS,
  loadNotificationPrefs,
  peekCachedNotificationPrefs,
  saveNotificationPrefs,
  snapCaptureReminderTimeToSlot,
  type NotificationPrefs,
} from '@/lib/notificationPrefs';
import { registerPushTokenInBackground } from '@/services/registerPushToken';

type Props = {
  labelFontFamily?: string;
  /** Première rangée du groupe : pas de bordure haute. */
  firstRowBordered?: boolean;
};

export default function ParentNotificationSettingsBlock({
  labelFontFamily,
  firstRowBordered = false,
}: Props) {
  const { t } = useAppTranslation('common');
  const [hasRealAccount, setHasRealAccount] = useState(() => peekHasRealAuthAccount());
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [notifsStatus, setNotifsStatus] = useState<'granted' | 'denied' | 'undetermined'>(
    'undetermined',
  );
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const refreshNotifs = useCallback(async () => {
    const notifs = await getNotificationsPermissionStatus();
    setNotifsStatus(notifs);
    if (notifs !== 'granted') {
      const prefs = await peekCachedNotificationPrefs();
      if (prefs.captureReminderEnabled) {
        const next = await saveNotificationPrefs({ captureReminderEnabled: false });
        setNotifPrefs(next);
        setTimeSheetOpen(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setHasRealAccount(peekHasRealAuthAccount());
      void peekCachedNotificationPrefs().then(setNotifPrefs);
      void loadNotificationPrefs().then(setNotifPrefs);
      void refreshNotifs();

      const sub = AppState.addEventListener('change', (next) => {
        const prev = appStateRef.current;
        appStateRef.current = next;
        if (next === 'active' && prev !== 'active') {
          void refreshNotifs();
        }
      });
      return () => sub.remove();
    }, [refreshNotifs]),
  );

  const handleNotificationsRowPress = useCallback(() => {
    void (async () => {
      if (!(await isNotificationsModuleAvailable())) {
        Alert.alert(
          t('parent.application.notificationsDeniedTitle'),
          t('parent.application.notificationsUnavailableBody'),
        );
        return;
      }
      const status = await getNotificationsPermissionStatus();
      if (status === 'granted' || status === 'denied') {
        void Linking.openSettings();
        return;
      }
      if (await getNotificationsGranted()) {
        void registerPushTokenInBackground();
        await refreshNotifs();
        const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        return;
      }
      const granted = await requestNotificationsAccess();
      await refreshNotifs();
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
  }, [refreshNotifs, t]);

  const handleCaptureReminderToggle = useCallback(
    (enabled: boolean) => {
      void (async () => {
        if (enabled) {
          if (!(await isNotificationsModuleAvailable())) return;
          const { ensureProvisionalNotificationsAuthorization } = await import(
            '@/lib/onboardingPermissions'
          );
          let granted = await getNotificationsGranted();
          if (!granted) {
            granted = await ensureProvisionalNotificationsAuthorization();
          }
          if (!granted) {
            void Linking.openSettings();
            return;
          }
          await refreshNotifs();
          void registerPushTokenInBackground();
        }
        const next = await saveNotificationPrefs({ captureReminderEnabled: enabled });
        setNotifPrefs(next);
      })();
    },
    [refreshNotifs],
  );

  const reminderOn = notifPrefs.captureReminderEnabled && notifsStatus === 'granted';
  const showReminder = hasRealAccount;

  return (
    <>
      <CaptureReminderTimeSheet
        visible={timeSheetOpen}
        selectedTime={notifPrefs.captureReminderLocalTime}
        onSelect={(time) => {
          const snapped = snapCaptureReminderTimeToSlot(time);
          void saveNotificationPrefs({ captureReminderLocalTime: snapped }).then(setNotifPrefs);
        }}
        onClose={() => setTimeSheetOpen(false)}
      />
      {showReminder ? (
        <>
          <MenuRow
            bordered={firstRowBordered}
            icon={menuIcon(Moon)}
            label={t('parent.application.captureReminder')}
            detail={
              reminderOn
                ? t('parent.application.captureReminderHintOnShort')
                : t('parent.application.captureReminderHintOff')
            }
            labelFontFamily={labelFontFamily}
            showChevron={false}
            trailing={
              <Switch
                value={reminderOn}
                onValueChange={handleCaptureReminderToggle}
                trackColor={{ false: '#E5E5EA', true: 'rgba(252, 87, 87, 0.4)' }}
                thumbColor={reminderOn ? THEME.brandPrimary : '#FFFFFF'}
                ios_backgroundColor="#E5E5EA"
                accessibilityLabel={t('parent.application.captureReminder')}
              />
            }
            accessibilityLabel={t('parent.application.captureReminder')}
          />
          {reminderOn ? (
            <MenuRow
              bordered
              nested
              label={t('parent.application.captureReminderTimeTitle')}
              value={notifPrefs.captureReminderLocalTime}
              labelFontFamily={labelFontFamily}
              onPress={() => setTimeSheetOpen(true)}
              accessibilityLabel={t('parent.application.captureReminderTimeTitle')}
            />
          ) : null}
        </>
      ) : null}
      <MenuRow
        bordered={showReminder || firstRowBordered}
        icon={menuIcon(Bell)}
        label={
          notifsStatus === 'undetermined'
            ? t('parent.application.enableNotifications')
            : t('parent.application.notificationsLabel')
        }
        detail={
          notifsStatus === 'granted'
            ? t('parent.application.notificationsStatusOnHint')
            : notifsStatus === 'denied'
              ? t('parent.application.notificationsStatusOffHint')
              : t('parent.application.enableNotificationsHint')
        }
        value={
          notifsStatus === 'granted'
            ? t('parent.application.notificationsStatusOn')
            : notifsStatus === 'denied'
              ? t('parent.application.notificationsStatusOff')
              : undefined
        }
        labelFontFamily={labelFontFamily}
        onPress={handleNotificationsRowPress}
        accessibilityLabel={
          notifsStatus === 'undetermined'
            ? t('parent.application.enableNotifications')
            : t('parent.application.notificationsLabel')
        }
      />
    </>
  );
}

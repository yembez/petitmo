/**
 * Rappel du soir + Notifications — Espace parent (avant Mes commandes).
 * Low Friction : coupe le rappel si pas d’alertes iOS ; provisoire → Réglages (pas de 2ᵉ boîte Apple).
 */
import { useCallback, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, Moon } from 'lucide-react-native';
import CaptureReminderTimeSheet from '@/components/parentSpace/CaptureReminderTimeSheet';
import { MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { THEME } from '@/constants/theme';
import {
  getNotificationsGranted,
  getNotificationsIosKind,
  getNotificationsPermissionStatus,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
  type NotificationsIosKind,
} from '@/lib/onboardingPermissions';
import { openAppSettings } from '@/lib/openAppSettings';
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
  const [notifsKind, setNotifsKind] = useState<NotificationsIosKind>('undetermined');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const refreshNotifs = useCallback(async () => {
    const kind = await getNotificationsIosKind();
    setNotifsKind(kind);
    const notifs = await getNotificationsPermissionStatus();
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

      const sub = AppState.addEventListener('change', next => {
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
      const kind = await getNotificationsIosKind();
      // Déjà alertes / refus / provisoire : seule la page Réglages iOS peut changer.
      if (kind === 'authorized' || kind === 'denied' || kind === 'provisional') {
        openAppSettings();
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
        return;
      }
    })();
  }, [refreshNotifs, t]);

  const handleCaptureReminderToggle = useCallback(
    (enabled: boolean) => {
      void (async () => {
        if (enabled) {
          if (!(await isNotificationsModuleAvailable())) return;
          let granted = await getNotificationsGranted();
          if (!granted) {
            granted = await requestNotificationsAccess();
          }
          if (!granted) {
            // requestNotificationsAccess a déjà ouvert Réglages si provisoire/refus.
            await refreshNotifs();
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

  const reminderOn = notifPrefs.captureReminderEnabled && notifsKind === 'authorized';
  const showReminder = hasRealAccount;

  const notifsValue =
    notifsKind === 'authorized'
      ? t('parent.application.notificationsStatusOn')
      : notifsKind === 'denied'
        ? t('parent.application.notificationsStatusOff')
        : notifsKind === 'provisional'
          ? t('parent.application.notificationsStatusQuiet')
          : undefined;

  const notifsDetail =
    notifsKind === 'authorized'
      ? t('parent.application.notificationsStatusOnHint')
      : notifsKind === 'denied'
        ? t('parent.application.notificationsStatusOffHint')
        : notifsKind === 'provisional'
          ? t('parent.application.notificationsStatusQuietHint')
          : t('parent.application.enableNotificationsHint');

  const notifsLabel =
    notifsKind === 'undetermined'
      ? t('parent.application.enableNotifications')
      : t('parent.application.notificationsLabel');

  return (
    <>
      <CaptureReminderTimeSheet
        visible={timeSheetOpen}
        selectedTime={notifPrefs.captureReminderLocalTime}
        onSelect={time => {
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
        label={notifsLabel}
        detail={notifsDetail}
        value={notifsValue}
        labelFontFamily={labelFontFamily}
        onPress={handleNotificationsRowPress}
        accessibilityLabel={notifsLabel}
      />
    </>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
  Share,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CreditCard,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shield,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getChildren, setSelectedChild } from '@/services/children';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { Child } from '@/types/local';
import { scale, verticalScale } from '@/utils/responsive';
import { calculateAge } from '@/utils/date';
import { getUserTier, peekUserTier, type UserTier } from '@/lib/userTier';
import {
  deleteRealAccount,
  getRealAuthUser,
  peekHasRealAuthAccount,
  peekOfflineLocalResumeActive,
  peekRealAuthEmail,
  signOutRealAccount,
} from '@/lib/authAccount';
import { resetNavigationToOnboarding } from '@/utils/resetNavigationToOnboarding';
import {
  beginAccountClosingUi,
  endAccountClosingUi,
} from '@/lib/accountClosingUi';
import {
  getLocalChild,
  getLocalMemoriesPendingCloudSync,
  listLocalChildren,
  listLocalChildrenForUser,
} from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { ChildAvatar } from '@/components/ChildAvatar';
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
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useAppLanguage } from '@/hooks/useAppLanguage';
import { formatAppCurrency, formatAppDate } from '@/utils/appLocale';
import { fetchPrintOrdersForAccount, hydratePrintOrderTitles, PETITMO_PRINT_ORDERS_UPDATED_EVENT } from '@/services/printOrders';
import { getCachedPrintOrders, peekCachedPrintOrders } from '@/lib/printOrdersCache';
import type { PrintOrderStatus, PrintOrderSummary } from '@/lib/printOrderSummary';
import { isGenericPrintBookTitle } from '@/lib/printOrderSummary';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { getBillingIssueCached, syncBillingIssueFromUser } from '@/lib/billingIssue';
import { getCaptureLockedCached, peekCaptureLocked, syncCaptureLockedFromUser } from '@/lib/captureLock';
import SupportContactModal from '@/components/SupportContactModal';
import type { SupportMessageKind } from '@/services/supportContact';
import {
  LEGAL_MENTIONS_URL,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
} from '@/lib/legalUrls';

function readLocalChildrenForSettings(): Child[] {
  const uid = peekLastRealAuthUserId();
  const list = uid ? listLocalChildrenForUser(uid) : listLocalChildren().filter(c => !(c.user_id ?? '').trim());
  return sortChildrenByBirthdateAsc(list);
}

function manageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

async function openUrl(url: string): Promise<void> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) return;
  await Linking.openURL(url);
}

export default function ParentSpaceScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const lang = useAppLanguage();
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  /** Local-first : 1er paint complet (pas de pop différé « Mon compte »). */
  const [children, setChildrenState] = useState<Child[]>(() => readLocalChildrenForSettings());
  const [tier, setTierState] = useState<UserTier>(() => peekUserTier());
  const [billingIssue, setBillingIssue] = useState(false);
  const [captureLocked, setCaptureLocked] = useState(() => peekCaptureLocked());
  const [hasRealAccount, setHasRealAccount] = useState(() => peekHasRealAuthAccount());
  const [accountEmail, setAccountEmail] = useState(() => peekRealAuthEmail() || '—');
  const [backupStatus, setBackupStatus] = useState(() => {
    if (!peekHasRealAuthAccount()) return '';
    const pending = getLocalMemoriesPendingCloudSync().length;
    return pending > 0 ? `Synchronisation (${pending})` : 'À jour';
  });
  const [versionLabel, setVersionLabel] = useState('—');
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [supportKind, setSupportKind] = useState<SupportMessageKind | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [orders, setOrders] = useState<PrintOrderSummary[]>(() =>
    peekHasRealAuthAccount() ? hydratePrintOrderTitles(peekCachedPrintOrders()) : [],
  );
  const [ordersStatusRefreshing, setOrdersStatusRefreshing] = useState(false);

  const handleCheckForUpdate = useCallback(() => {
    setUpdateCheckBusy(true);
    void (async () => {
      try {
        /** Reload immédiat si une OTA est prête ; sinon on affiche l’état courant. */
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
      if (!token) {
        token = await registerPushTokenInBackground();
      }
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
        const { markOnboardingPermissionsSeen } = await import(
          '@/lib/onboardingPermissionsSeen'
        );
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        Alert.alert(
          t('parent.application.photosGrantedTitle'),
          t('parent.application.photosGrantedBody'),
        );
        return;
      }
      Alert.alert(
        t('parent.application.photosDeniedTitle'),
        t('parent.application.photosDeniedBody'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('parent.application.openSettings'),
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
    })();
  }, [t]);

  const handleEnableNotifications = useCallback(() => {
    void (async () => {
      if (!(await isNotificationsModuleAvailable())) {
        Alert.alert(t('parent.application.notificationsDeniedTitle'), t('parent.application.notificationsUnavailableBody'));
        return;
      }
      if (await getNotificationsGranted()) {
        void registerPushTokenInBackground();
        const { markOnboardingPermissionsSeen } = await import(
          '@/lib/onboardingPermissionsSeen'
        );
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
        const { markOnboardingPermissionsSeen } = await import(
          '@/lib/onboardingPermissionsSeen'
        );
        await markOnboardingPermissionsSeen(peekLastRealAuthUserId());
        Alert.alert(
          t('parent.application.notificationsGrantedTitle'),
          t('parent.application.notificationsGrantedBody'),
        );
        return;
      }
      Alert.alert(t('parent.application.notificationsDeniedTitle'), t('parent.application.notificationsDeniedBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('parent.application.openSettings'),
          onPress: () => void Linking.openSettings(),
        },
      ]);
    })();
  }, [t]);

  const refreshOrderTracking = useCallback(() => {
    setOrdersStatusRefreshing(true);
    void fetchPrintOrdersForAccount()
      .then(setOrders)
      .finally(() => setOrdersStatusRefreshing(false));
  }, []);

  const load = useCallback(() => {
    setChildrenState(readLocalChildrenForSettings());

    const showLocalOrders = peekHasRealAuthAccount();
    if (showLocalOrders) {
      setOrders(hydratePrintOrderTitles(peekCachedPrintOrders()));
      void getCachedPrintOrders().then((cached) => {
        setOrders(hydratePrintOrderTitles(cached));
      });
      refreshOrderTracking();
    }

    void getUserTier().then(setTierState);
    void getBillingIssueCached().then(setBillingIssue);
    void getCaptureLockedCached().then(setCaptureLocked);
    void collectBugReportContext({
      pathname,
      sentryEnabled: isSentryEnabled(),
    }).then((ctx) => setVersionLabel(formatAppVersionLabel(ctx)));

    void getRealAuthUser().then((realUser) => {
      if (realUser) {
        setHasRealAccount(true);
        void syncBillingIssueFromUser(realUser).then(setBillingIssue);
        void syncCaptureLockedFromUser(realUser).then(setCaptureLocked);
        const rawEmail =
          realUser.email ??
          (typeof realUser.user_metadata?.email === 'string' ? realUser.user_metadata.email : '') ??
          '';
        setAccountEmail(rawEmail.trim() || '—');
        const pending = getLocalMemoriesPendingCloudSync().length;
        setBackupStatus(pending > 0 ? `Synchronisation (${pending})` : 'À jour');
        if (!showLocalOrders) {
          void getCachedPrintOrders().then((cached) => {
            setOrders(hydratePrintOrderTitles(cached));
          });
          refreshOrderTracking();
        }
        return;
      }

      // Reprise hors-ligne : pas de session Supabase, mais compte local actif.
      if (peekHasRealAuthAccount() || peekOfflineLocalResumeActive()) {
        setHasRealAccount(true);
        setAccountEmail(peekRealAuthEmail() || '—');
        const pending = getLocalMemoriesPendingCloudSync().length;
        setBackupStatus(
          peekOfflineLocalResumeActive()
            ? t('parent.account.backupOfflinePaused')
            : pending > 0
              ? `Synchronisation (${pending})`
              : 'À jour',
        );
        return;
      }

      setHasRealAccount(false);
      setAccountEmail('');
      setBackupStatus('');
      setOrders([]);
      setBillingIssue(false);
      setCaptureLocked(false);
    });

    void getChildren().then((list) => {
      setChildrenState(sortChildrenByBirthdateAsc(list));
    });
  }, [pathname, refreshOrderTracking, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PETITMO_PRINT_ORDERS_UPDATED_EVENT, () => {
      setOrders(hydratePrintOrderTitles(peekCachedPrintOrders()));
    });
    return () => sub.remove();
  }, []);

  const performSignOut = useCallback(async () => {
    if (signOutBusy || deleteBusy) return;
    setSignOutBusy(true);
    beginAccountClosingUi('signOut');
    try {
      await signOutRealAccount();
      // Reset pile : sinon swipe-back onboarding → fil du compte précédent.
      resetNavigationToOnboarding(router, navigation);
      // Overlay racine : survit au unmount Espace parent, puis fade vers onboarding.
      setTimeout(() => endAccountClosingUi(), 280);
    } catch {
      endAccountClosingUi();
      Alert.alert(t('error'), t('parent.account.signOutFailed'));
      setSignOutBusy(false);
    }
  }, [deleteBusy, navigation, router, signOutBusy, t]);

  const handleSignOut = useCallback(() => {
    if (signOutBusy || deleteBusy) return;
    Alert.alert(t('parent.account.signOutConfirmTitle'), t('parent.account.signOutConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('parent.account.signOut'),
        style: 'destructive',
        onPress: () => void performSignOut(),
      },
    ]);
  }, [deleteBusy, performSignOut, signOutBusy, t]);

  const performDeleteAccount = useCallback(async () => {
    if (deleteBusy || signOutBusy) return;
    setDeleteBusy(true);
    beginAccountClosingUi('delete');
    try {
      const result = await deleteRealAccount();
      if (!result.ok) {
        endAccountClosingUi();
        Alert.alert(t('error'), result.error);
        setDeleteBusy(false);
        return;
      }
      resetNavigationToOnboarding(router, navigation);
      setTimeout(() => endAccountClosingUi(), 280);
    } catch {
      endAccountClosingUi();
      Alert.alert(t('error'), t('parent.account.deleteFailed'));
      setDeleteBusy(false);
    }
  }, [deleteBusy, navigation, router, signOutBusy, t]);

  const handleDeleteAccount = useCallback(() => {
    if (deleteBusy || signOutBusy) return;
    if (peekOfflineLocalResumeActive()) {
      Alert.alert(t('error'), t('parent.account.deleteNeedsNetwork'));
      return;
    }
    Alert.alert(t('parent.account.deleteConfirmTitle'), t('parent.account.deleteConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('parent.account.deleteAccount'),
        style: 'destructive',
        onPress: () => void performDeleteAccount(),
      },
    ]);
  }, [deleteBusy, performDeleteAccount, signOutBusy, t]);

  const paid = tier === 'paid';
  const menuIcon = (Icon: LucideIcon) => (
    <Icon size={ICON_SIZES.md} color={THEME.textPrimary} strokeWidth={1.85} />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => safeRouterBack(router, '/(tabs)')}
          style={styles.headerButton}
          activeOpacity={0.8}
        >
          <ChevronLeft size={ICON_SIZES.lg} color={THEME.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, dm600 ? { fontFamily: dm600 } : null]}>Espace parent</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + verticalScale(32) }]}
        showsVerticalScrollIndicator={false}
      >
        <MenuGroup title="Mes enfants" titleFontFamily={dm600}>
          {children.length === 0 ? (
            <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
              Aucun enfant pour le moment.
            </Text>
          ) : (
            children.map((c, i) => (
              <MenuRow
                key={c.id}
                bordered={i > 0}
                icon={<ChildAvatar child={c} size={scale(34)} />}
                label={c.name ?? 'Sans nom'}
                detail={c.birthdate ? calculateAge(c.birthdate) : undefined}
                labelFontFamily={dm500}
                onPress={async () => {
                  await setSelectedChild(c.id);
                  router.push(`/edit-child?childId=${c.id}`);
                }}
              />
            ))
          )}
          <MenuRow
            bordered={children.length > 0}
            icon={
              <LinearGradient
                colors={[...BRAND_ACTION_GRADIENT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.addChildIcon}
              >
                <Plus size={ICON_SIZES.sm} color="#FFFFFF" strokeWidth={2.5} />
              </LinearGradient>
            }
            label="Ajouter un enfant"
            labelFontFamily={dm600}
            onPress={() => router.push('/create-child')}
          />
        </MenuGroup>

        <MenuGroup title={t('parent.subscription.sectionTitle')} titleFontFamily={dm600}>
          {billingIssue ? (
            <View style={styles.billingIssueBanner}>
              <Text style={[styles.billingIssueTitle, dm600 ? { fontFamily: dm600 } : null]}>
                {t('parent.subscription.billingIssueTitle')}
              </Text>
              <Text style={[styles.billingIssueBody, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.subscription.billingIssueBody')}
              </Text>
              <TouchableOpacity
                style={styles.billingIssueCta}
                onPress={() => void openUrl(manageSubscriptionUrl())}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('parent.subscription.billingIssueCta')}
              >
                <Text style={[styles.billingIssueCtaText, dm600 ? { fontFamily: dm600 } : null]}>
                  {t('parent.subscription.billingIssueCta')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {paid ? (
            <>
              <MenuRow
                icon={menuIcon(CreditCard)}
                label={t('parent.subscription.currentPlan')}
                detail={t('parent.subscription.planPremium')}
                labelFontFamily={dm500}
                showChevron={false}
              />
              <MenuRow
                bordered
                icon={menuIcon(Settings)}
                label={t('parent.subscription.manage')}
                labelFontFamily={dm500}
                onPress={() => void openUrl(manageSubscriptionUrl())}
                accessibilityLabel={t('parent.subscription.manage')}
              />
            </>
          ) : (
            <MenuRow
              icon={menuIcon(CreditCard)}
              label={t('parent.subscription.upgradeCta')}
              labelFontFamily={dm700}
              labelAccent
              onPress={() =>
                router.push({
                  pathname: '/paywall',
                  params: { context: captureLocked ? 'EX_SUBSCRIBER' : 'GENERAL' },
                })
              }
              accessibilityLabel={t('parent.subscription.upgradeCta')}
            />
          )}
        </MenuGroup>

        {hasRealAccount ? (
          <MenuGroup title={t('parent.orders.sectionTitle')} titleFontFamily={dm600}>
            {orders.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('parent.orders.empty')}
                </Text>
                <Text style={[styles.emptyTextHint, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('parent.orders.hint')}
                </Text>
              </View>
            ) : (
              orders.map((o, i) => {
                const when = o.createdAt
                  ? formatAppDate(new Date(o.createdAt), { day: '2-digit', month: '2-digit', year: 'numeric' }, lang)
                  : '';
                const price = formatAppCurrency(o.priceCents / 100, lang);
                const meta = [when, price].filter(Boolean).join(' · ');
                return (
                  <MenuRow
                    key={o.id}
                    bordered={i > 0}
                    icon={menuIcon(Package)}
                    label={orderBookTitle(o, t)}
                    detail={meta || undefined}
                    value={printOrderStatusLabel(o.status, t)}
                    valueRefreshing={ordersStatusRefreshing}
                    refreshingAccessibilityLabel={t('parent.orders.statusUpdating')}
                    labelFontFamily={dm500}
                    showChevron={false}
                  />
                );
              })
            )}
          </MenuGroup>
        ) : null}

        <MenuGroup title="Aide" titleFontFamily={dm600}>
          <MenuRow
            icon={menuIcon(HelpCircle)}
            label={t('parent.report.cta')}
            labelFontFamily={dm500}
            onPress={() => setSupportKind('report')}
            accessibilityLabel={t('parent.report.cta')}
          />
          <MenuRow
            bordered
            icon={menuIcon(MessageCircle)}
            label={t('parent.support.contactCta')}
            labelFontFamily={dm500}
            onPress={() => setSupportKind('contact')}
            accessibilityLabel={t('parent.support.contactCta')}
          />
        </MenuGroup>

        <MenuGroup title="Application" titleFontFamily={dm600}>
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
        </MenuGroup>

        {hasRealAccount ? (
          <MenuGroup title={t('parent.account.sectionTitle')} titleFontFamily={dm600}>
            <MenuRow
              icon={menuIcon(UserRound)}
              label={accountEmail || '—'}
              labelFontFamily={dm500}
              showChevron={false}
            />
            <MenuRow
              bordered
              icon={menuIcon(LogOut)}
              label={t('parent.account.signOut')}
              labelFontFamily={dm500}
              destructive
              showChevron={false}
              onPress={handleSignOut}
              disabled={signOutBusy || deleteBusy}
              accessibilityLabel={t('parent.account.signOut')}
            />
            <MenuRow
              bordered
              icon={menuIcon(Trash2)}
              label={t('parent.account.deleteAccount')}
              labelFontFamily={dm500}
              destructive
              showChevron={false}
              onPress={handleDeleteAccount}
              disabled={signOutBusy || deleteBusy}
              accessibilityLabel={t('parent.account.deleteAccount')}
            />
          </MenuGroup>
        ) : null}

        {hasRealAccount ? (
          <MenuGroup title="Sauvegarde cloud" titleFontFamily={dm600}>
            <MenuRow
              icon={menuIcon(Cloud)}
              label="Sauvegarde"
              detail={backupStatus || 'À jour'}
              labelFontFamily={dm500}
              showChevron={false}
            />
          </MenuGroup>
        ) : null}

        <MenuGroup title="Informations légales" titleFontFamily={dm600}>
          <MenuRow
            icon={menuIcon(Shield)}
            label="Politique de confidentialité"
            labelFontFamily={dm500}
            onPress={() => void openUrl(LEGAL_PRIVACY_URL)}
          />
          <MenuRow
            bordered
            icon={menuIcon(FileText)}
            label="Conditions d'utilisation"
            labelFontFamily={dm500}
            onPress={() => void openUrl(LEGAL_TERMS_URL)}
          />
          <MenuRow
            bordered
            icon={menuIcon(FileText)}
            label="Mentions légales"
            labelFontFamily={dm500}
            onPress={() => void openUrl(LEGAL_MENTIONS_URL)}
          />
        </MenuGroup>
      </ScrollView>

      <SupportContactModal
        visible={supportKind != null}
        kind={supportKind ?? 'contact'}
        defaultEmail={accountEmail}
        onClose={() => setSupportKind(null)}
      />
    </View>
  );
}

function orderBookTitle(
  order: PrintOrderSummary,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const titled = order.bookTitle.trim();
  if (titled && !isGenericPrintBookTitle(titled)) return titled;
  const childName = order.childId.trim()
    ? (getLocalChild(order.childId)?.name ?? '').trim()
    : '';
  if (childName) return t('parent.orders.journalOf', { name: childName });
  return t('parent.orders.untitledBook');
}

function printOrderStatusLabel(
  status: PrintOrderStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case 'printing':
      return t('parent.orders.statusPrinting');
    case 'shipped':
      return t('parent.orders.statusShipped');
    case 'in_transit':
      return t('parent.orders.statusInTransit');
    case 'delivered':
      return t('parent.orders.statusDelivered');
    case 'failed':
      return t('parent.orders.statusFailed');
    case 'refunded':
      return t('parent.orders.statusRefunded');
    case 'returned':
      return t('parent.orders.statusReturned');
    default:
      return t('parent.orders.statusPaid');
  }
}

const MENU_BG = '#F2F2F7';
const MENU_CARD = '#FFFFFF';
const MENU_HEADER = '#6D6D72';
const MENU_SEPARATOR = '#C6C6C8';
const MENU_CHEVRON = '#C7C7CC';

function MenuGroup({
  title,
  children,
  titleFontFamily,
}: {
  title: string;
  children: ReactNode;
  titleFontFamily?: string;
}) {
  return (
    <View style={styles.menuGroup}>
      <Text
        style={[styles.menuGroupTitle, titleFontFamily ? { fontFamily: titleFontFamily } : null]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <View style={styles.menuCard}>{children}</View>
    </View>
  );
}

function MenuRow({
  label,
  detail,
  value,
  icon,
  onPress,
  onLongPress,
  bordered,
  labelFontFamily,
  labelAccent,
  destructive,
  showChevron = true,
  disabled,
  trailing,
  valueRefreshing,
  refreshingAccessibilityLabel,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  value?: string;
  icon?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  bordered?: boolean;
  labelFontFamily?: string;
  labelAccent?: boolean;
  destructive?: boolean;
  showChevron?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  valueRefreshing?: boolean;
  refreshingAccessibilityLabel?: string;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      <View style={styles.rowIconSlot}>
        {icon ?? <View style={styles.rowIconPlaceholder} />}
      </View>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            labelAccent && styles.rowLabelAccent,
            destructive && styles.rowLabelDestructive,
            labelFontFamily ? { fontFamily: labelFontFamily } : null,
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={styles.rowTrailing}>{trailing}</View>
      ) : valueRefreshing ? (
        <View style={styles.statusRefreshWrap}>
          {value ? (
            <Text style={styles.rowValue} numberOfLines={2}>
              {value}
            </Text>
          ) : null}
          <ActivityIndicator
            color={THEME.brandPrimary}
            size="small"
            style={styles.statusSpinner}
            accessibilityLabel={refreshingAccessibilityLabel}
          />
        </View>
      ) : value ? (
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : showChevron && onPress ? (
        <ChevronRight size={ICON_SIZES.md} color={MENU_CHEVRON} strokeWidth={2} />
      ) : (
        <View style={styles.rowValuePlaceholder} />
      )}
    </>
  );

  const wrap = (node: ReactNode) => (
    <View style={styles.rowWrap}>
      {bordered ? <View style={styles.rowDivider} /> : null}
      {node}
    </View>
  );

  if (onPress) {
    return wrap(
      <TouchableOpacity
        style={styles.row}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={onLongPress ? 700 : undefined}
        activeOpacity={0.65}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        {content}
      </TouchableOpacity>,
    );
  }

  return wrap(
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? [label, detail, value].filter(Boolean).join(', ')}
    >
      {content}
    </View>,
  );
}

const MENU_BG = '#F2F2F7';
const MENU_CARD = '#FFFFFF';
const MENU_HEADER = '#6D6D72';
const MENU_SEPARATOR = '#C6C6C8';
const MENU_CHEVRON = '#C7C7CC';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MENU_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: MENU_BG,
  },
  headerButton: {
    width: scale(44),
    height: scale(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  menuGroup: {
    marginBottom: verticalScale(22),
  },
  menuGroupTitle: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: MENU_HEADER,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: SPACING.lg,
    marginBottom: verticalScale(8),
  },
  menuCard: {
    backgroundColor: MENU_CARD,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: MENU_SEPARATOR,
    overflow: 'hidden',
  },
  billingIssueBanner: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: verticalScale(14),
    backgroundColor: MENU_BG,
    borderRadius: scale(12),
    gap: verticalScale(8),
  },
  billingIssueTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  billingIssueBody: {
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
    color: THEME.textSecondary,
    lineHeight: scale(20),
  },
  billingIssueCta: {
    alignSelf: 'flex-start',
    marginTop: verticalScale(4),
    paddingVertical: verticalScale(8),
    paddingHorizontal: SPACING.md,
    borderRadius: scale(100),
    backgroundColor: THEME.brandPrimary,
  },
  billingIssueCtaText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  rowWrap: {
    backgroundColor: MENU_CARD,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: MENU_SEPARATOR,
    marginLeft: scale(52),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    paddingRight: SPACING.md,
    paddingVertical: verticalScale(14),
    minHeight: scale(52),
    backgroundColor: MENU_CARD,
  },
  rowIconSlot: {
    width: scale(36),
    marginRight: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconPlaceholder: {
    width: scale(22),
    height: scale(22),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    fontWeight: '500',
  },
  rowDetail: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginTop: 2,
  },
  rowLabelAccent: {
    color: THEME.brandPrimary,
    fontWeight: '700',
  },
  rowLabelDestructive: {
    color: '#C62828',
    fontWeight: '600',
  },
  rowValue: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '42%',
    textAlign: 'right',
  },
  rowTrailing: {
    marginLeft: SPACING.sm,
  },
  statusRefreshWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '50%',
  },
  statusSpinner: {
    marginLeft: 8,
  },
  rowValuePlaceholder: {
    width: scale(10),
  },
  emptyBlock: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: verticalScale(4),
  },
  emptyText: {
    fontSize: FONT_SIZES.md,
    color: THEME.textMuted,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  emptyTextHint: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    lineHeight: scale(18),
  },
  addChildIcon: {
    width: scale(28),
    height: scale(28),
    borderRadius: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
});

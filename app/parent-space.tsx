import { useCallback, useEffect, useState } from 'react';
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
import { ChevronLeft, Plus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getChildren, setSelectedChild } from '@/services/children';
import { useFocusEffect } from '@react-navigation/native';
import type { Child } from '@/types/local';
import { scale, verticalScale } from '@/utils/responsive';
import { calculateAge } from '@/utils/date';
import { getUserTier, peekUserTier, type UserTier } from '@/lib/userTier';
import {
  deleteRealAccount,
  getRealAuthUser,
  peekHasRealAuthAccount,
  peekRealAuthEmail,
  signOutRealAccount,
} from '@/lib/authAccount';
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
import { isSentryEnabled } from '@/lib/sentry';
import { applyAvailableOtaUpdate } from '@/services/applyOtaUpdate';
import {
  peekCachedExpoPushToken,
  registerPushTokenInBackground,
} from '@/services/registerPushToken';
import {
  getNotificationsGranted,
  isNotificationsModuleAvailable,
  requestNotificationsAccess,
} from '@/lib/onboardingPermissions';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useAppLanguage } from '@/hooks/useAppLanguage';
import { formatAppCurrency, formatAppDate } from '@/utils/appLocale';
import { fetchPrintOrdersForAccount, hydratePrintOrderTitles, PETITMO_PRINT_ORDERS_UPDATED_EVENT } from '@/services/printOrders';
import { getCachedPrintOrders, peekCachedPrintOrders } from '@/lib/printOrdersCache';
import type { PrintOrderStatus, PrintOrderSummary } from '@/lib/printOrderSummary';
import { isGenericPrintBookTitle } from '@/lib/printOrderSummary';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import SupportContactModal from '@/components/SupportContactModal';
import type { SupportMessageKind } from '@/services/supportContact';

const URL_PRIVACY = 'https://petitmo.app/privacy';
const URL_TERMS = 'https://petitmo.app/terms';
const URL_LEGAL = 'https://petitmo.app/legal';

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
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const lang = useAppLanguage();
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  /** Local-first : 1er paint complet (pas de pop différé « Mon compte »). */
  const [children, setChildrenState] = useState<Child[]>(() => readLocalChildrenForSettings());
  const [tier, setTierState] = useState<UserTier>(() => peekUserTier());
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

  const handleEnableNotifications = useCallback(() => {
    void (async () => {
      if (!(await isNotificationsModuleAvailable())) {
        Alert.alert(t('parent.application.notificationsDeniedTitle'), t('parent.application.notificationsUnavailableBody'));
        return;
      }
      if (await getNotificationsGranted()) {
        void registerPushTokenInBackground();
        Alert.alert(
          t('parent.application.notificationsGrantedTitle'),
          t('parent.application.notificationsGrantedBody'),
        );
        return;
      }
      const granted = await requestNotificationsAccess();
      if (granted) {
        void registerPushTokenInBackground();
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
    void collectBugReportContext({
      pathname,
      sentryEnabled: isSentryEnabled(),
    }).then((ctx) => setVersionLabel(formatAppVersionLabel(ctx)));

    void getRealAuthUser().then((realUser) => {
      setHasRealAccount(!!realUser);
      if (realUser) {
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
      } else {
        setAccountEmail('');
        setBackupStatus('');
        setOrders([]);
      }
    });

    void getChildren().then((list) => {
      setChildrenState(list);
    });
  }, [pathname, refreshOrderTracking]);

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
    try {
      // Navigation d’abord côté UX : signOut est déjà rapide (device-user en bg).
      await signOutRealAccount();
      router.replace('/onboarding');
    } catch {
      Alert.alert(t('error'), t('parent.account.signOutFailed'));
      setSignOutBusy(false);
    }
  }, [deleteBusy, router, signOutBusy, t]);

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
    try {
      const result = await deleteRealAccount();
      if (!result.ok) {
        Alert.alert(t('error'), result.error);
        setDeleteBusy(false);
        return;
      }
      router.replace('/onboarding');
    } catch {
      Alert.alert(t('error'), t('parent.account.deleteFailed'));
      setDeleteBusy(false);
    }
  }, [deleteBusy, router, signOutBusy, t]);

  const handleDeleteAccount = useCallback(() => {
    if (deleteBusy || signOutBusy) return;
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + verticalScale(24) }]}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Mes enfants" titleFontFamily={dm700}>
          {children.length === 0 ? (
            <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
              Aucun enfant pour le moment.
            </Text>
          ) : (
            children.map((c) => (
              <Row
                key={c.id}
                icon={<ChildAvatar child={c} size={scale(34)} />}
                label={c.name ?? 'Sans nom'}
                labelFontFamily={dm500}
                value={c.birthdate ? calculateAge(c.birthdate) : ''}
                onPress={async () => {
                  await setSelectedChild(c.id);
                  router.push(`/edit-child?childId=${c.id}`);
                }}
              />
            ))
          )}

          <TouchableOpacity
            style={styles.addChildRow}
            onPress={() => router.push('/create-child')}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={[...BRAND_ACTION_GRADIENT]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.addChildIcon}
            >
              <Plus size={ICON_SIZES.md} color="#FFFFFF" strokeWidth={2.5} />
            </LinearGradient>
            <Text style={[styles.addChildText, dm600 ? { fontFamily: dm600 } : null]}>Ajouter un enfant</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Mon abonnement" titleFontFamily={dm700}>
          {paid ? (
            <>
              <StaticRow label="Plan actuel" value="Petitmo+" labelFontFamily={dm500} />
              <TouchableOpacity
                style={[styles.row, styles.rowBorderTop]}
                onPress={() => void openUrl(manageSubscriptionUrl())}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Gérer mon abonnement"
              >
                <View style={styles.rowIconPlaceholder} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                    Gérer mon abonnement
                  </Text>
                </View>
                <Text style={styles.rowValue}>Ouvrir</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                router.push({ pathname: '/paywall', params: { context: 'GENERAL' } })
              }
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('parent.subscription.upgradeCta')}
            >
              <View style={styles.rowIconPlaceholder} />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, styles.rowLabelAccent, dm500 ? { fontFamily: dm500 } : null]}
                >
                  {t('parent.subscription.upgradeCta')}
                </Text>
              </View>
              <Text style={styles.rowValue}>›</Text>
            </TouchableOpacity>
          )}
        </Section>

        {hasRealAccount ? (
          <Section title={t('parent.orders.sectionTitle')} titleFontFamily={dm700}>
            {orders.length === 0 ? (
              <>
                <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('parent.orders.empty')}
                </Text>
                <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('parent.orders.hint')}
                </Text>
              </>
            ) : (
              orders.map((o, i) => {
                const when = o.createdAt
                  ? formatAppDate(new Date(o.createdAt), { day: 'numeric', month: 'short', year: 'numeric' }, lang)
                  : '';
                const price = formatAppCurrency(o.priceCents / 100, lang);
                const meta = [when, price].filter(Boolean).join(' · ');
                return (
                  <StaticRow
                    key={o.id}
                    label={orderBookTitle(o, t)}
                    detail={meta || undefined}
                    value={printOrderStatusLabel(o.status, t)}
                    valueRefreshing={ordersStatusRefreshing}
                    refreshingAccessibilityLabel={t('parent.orders.statusUpdating')}
                    labelFontFamily={dm500}
                    bordered={i > 0}
                  />
                );
              })
            )}
          </Section>
        ) : null}

        <Section title="Aide" titleFontFamily={dm700}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setSupportKind('report')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('parent.report.cta')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.report.cta')}
              </Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            onPress={() => setSupportKind('contact')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('parent.support.contactCta')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.support.contactCta')}
              </Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Informations légales" titleFontFamily={dm700}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => void openUrl(URL_PRIVACY)}
            activeOpacity={0.85}
            accessibilityRole="link"
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                Politique de confidentialité
              </Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            onPress={() => void openUrl(URL_TERMS)}
            activeOpacity={0.85}
            accessibilityRole="link"
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                Conditions d&apos;utilisation
              </Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            onPress={() => void openUrl(URL_LEGAL)}
            activeOpacity={0.85}
            accessibilityRole="link"
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>Mentions légales</Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Application" titleFontFamily={dm700}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.85}
            disabled={updateCheckBusy}
            onPress={handleCheckForUpdate}
            accessibilityRole="button"
            accessibilityLabel={t('parent.application.checkUpdate')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.application.checkUpdate')}
              </Text>
              <Text style={styles.rowDetail}>
                {t('parent.application.versionPrefix', { label: versionLabel })}
              </Text>
            </View>
            {updateCheckBusy ? (
              <ActivityIndicator size="small" color={THEME.textMuted} />
            ) : (
              <Text style={styles.rowValue}>›</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            activeOpacity={0.85}
            onPress={handleEnableNotifications}
            accessibilityRole="button"
            accessibilityLabel={t('parent.application.enableNotifications')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.application.enableNotifications')}
              </Text>
              <Text style={styles.rowDetail}>{t('parent.application.enableNotificationsHint')}</Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            activeOpacity={0.85}
            onPress={handleSharePushToken}
            accessibilityRole="button"
            accessibilityLabel={t('parent.application.copyPushToken')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.application.copyPushToken')}
              </Text>
              <Text style={styles.rowDetail}>{t('parent.application.pushTokenHint')}</Text>
            </View>
            <Text style={styles.rowValue}>›</Text>
          </TouchableOpacity>
        </Section>

        {hasRealAccount ? (
          <Section title={t('parent.account.sectionTitle')} titleFontFamily={dm700}>
            <StaticRow label={accountEmail || '—'} labelFontFamily={dm500} />
            <TouchableOpacity
              style={[styles.row, styles.rowBorderTop]}
              onPress={handleSignOut}
              activeOpacity={0.85}
              disabled={signOutBusy || deleteBusy}
              accessibilityRole="button"
              accessibilityLabel={t('parent.account.signOut')}
            >
              <View style={styles.rowIconPlaceholder} />
              <View style={styles.rowText}>
                <Text style={[styles.rowLabelDestructive, dm500 ? { fontFamily: dm500 } : null]}>
                  {signOutBusy ? '…' : t('parent.account.signOut')}
                </Text>
              </View>
              <View style={styles.rowValuePlaceholder} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.row, styles.rowBorderTop]}
              onPress={handleDeleteAccount}
              activeOpacity={0.85}
              disabled={signOutBusy || deleteBusy}
              accessibilityRole="button"
              accessibilityLabel={t('parent.account.deleteAccount')}
            >
              <View style={styles.rowIconPlaceholder} />
              <View style={styles.rowText}>
                <Text style={[styles.rowLabelDestructive, dm500 ? { fontFamily: dm500 } : null]}>
                  {deleteBusy ? '…' : t('parent.account.deleteAccount')}
                </Text>
              </View>
              <View style={styles.rowValuePlaceholder} />
            </TouchableOpacity>
          </Section>
        ) : null}

        {hasRealAccount ? (
          <Section title="Sauvegarde cloud" titleFontFamily={dm700}>
            <StaticRow label="Sauvegarde" value={backupStatus || 'À jour'} labelFontFamily={dm500} />
          </Section>
        ) : null}
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

function Section({
  title,
  children,
  titleFontFamily,
}: {
  title: string;
  children: React.ReactNode;
  titleFontFamily?: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, titleFontFamily ? { fontFamily: titleFontFamily } : null]}>
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function StaticRow({
  label,
  detail,
  value,
  valueRefreshing,
  refreshingAccessibilityLabel,
  labelFontFamily,
  bordered,
}: {
  label: string;
  detail?: string;
  value?: string;
  valueRefreshing?: boolean;
  refreshingAccessibilityLabel?: string;
  labelFontFamily?: string;
  bordered?: boolean;
}) {
  return (
    <View
      style={[styles.row, bordered && styles.rowBorderTop]}
      accessibilityRole="text"
      accessibilityLabel={
        valueRefreshing && refreshingAccessibilityLabel
          ? [label, detail, refreshingAccessibilityLabel].filter(Boolean).join(', ')
          : undefined
      }
    >
      <View style={styles.rowIconPlaceholder} />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowLabel, labelFontFamily ? { fontFamily: labelFontFamily } : null]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={1} ellipsizeMode="tail">
            {detail}
          </Text>
        ) : null}
      </View>
      {valueRefreshing ? (
        <View style={styles.statusRefreshWrap}>
          {value ? (
            <Text style={styles.statusLabel} numberOfLines={2}>
              {value}
            </Text>
          ) : null}
          <ActivityIndicator
            color={THEME.brandCtaOrange}
            size="small"
            style={styles.statusSpinner}
            accessibilityLabel={refreshingAccessibilityLabel}
          />
        </View>
      ) : value ? (
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        <View style={styles.rowValuePlaceholder} />
      )}
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  icon,
  labelFontFamily,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  icon?: React.ReactNode;
  labelFontFamily?: string;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : <View style={styles.rowIconPlaceholder} />}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, labelFontFamily ? { fontFamily: labelFontFamily } : null]}>
          {label}
        </Text>
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : <View style={styles.rowValuePlaceholder} />}
    </TouchableOpacity>
  );
}

function AvatarFallback({ letter, letterFontFamily }: { letter: string; letterFontFamily?: string }) {
  return (
    <View style={styles.avatarFallback}>
      <Text style={[styles.avatarFallbackText, letterFontFamily ? { fontFamily: letterFontFamily } : null]}>
        {letter}
      </Text>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: THEME.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.familyFlowLine,
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
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: THEME.textPrimary,
    letterSpacing: -0.3,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  card: {
    backgroundColor: THEME.bg,
    borderRadius: scale(18),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.familyFlowLine,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  rowBorderTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.familyFlowLine,
  },
  rowIcon: {
    width: scale(40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconPlaceholder: {
    width: scale(40),
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
    color: THEME.brandCtaOrange,
    fontWeight: '600',
  },
  rowLabelDestructive: {
    fontSize: FONT_SIZES.base,
    color: '#C62828',
    fontWeight: '600',
  },
  rowValue: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '46%',
  },
  statusRefreshWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACING.sm,
    flexShrink: 0,
    maxWidth: '50%',
  },
  statusLabel: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    flexShrink: 1,
  },
  statusSpinner: {
    marginLeft: 8,
  },
  rowValuePlaceholder: {
    width: scale(18),
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  addChildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: THEME.familyFlowLine,
  },
  addChildIcon: {
    width: scale(34),
    height: scale(34),
    borderRadius: scale(17),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  addChildText: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    fontWeight: '600',
  },
  childRowAvatarImg: {
    width: scale(34),
    height: scale(34),
    borderRadius: scale(17),
    backgroundColor: '#E8E8ED',
  },
  avatarFallback: {
    width: scale(34),
    height: scale(34),
    borderRadius: scale(17),
    backgroundColor: '#C8DCDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#2F5560',
    fontWeight: '700',
    fontSize: FONT_SIZES.sm,
  },
});

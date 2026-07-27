import { useCallback, useState } from 'react';
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
  Share,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
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
  getLocalMemoriesPendingCloudSync,
  listLocalChildren,
  listLocalChildrenForUser,
} from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { ChildAvatar } from '@/components/ChildAvatar';
import {
  buildBugReportMailto,
  collectBugReportContext,
  formatAppVersionLabel,
  formatBugReportTechBlock,
} from '@/lib/bugReportContext';
import { captureUserBugReport, isSentryEnabled } from '@/lib/sentry';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';

const CONTACT_EMAIL = 'contact@petitmo.app';
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
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
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
  const [reportBusy, setReportBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setChildrenState(readLocalChildrenForSettings());

    const tTier = await getUserTier();
    setTierState(tTier);

    const ctx = await collectBugReportContext({
      pathname,
      sentryEnabled: isSentryEnabled(),
    });
    setVersionLabel(formatAppVersionLabel(ctx));

    const realUser = await getRealAuthUser();
    setHasRealAccount(!!realUser);
    if (realUser) {
      const rawEmail =
        realUser.email ??
        (typeof realUser.user_metadata?.email === 'string' ? realUser.user_metadata.email : '') ??
        '';
      setAccountEmail(rawEmail.trim() || '—');
      const pending = getLocalMemoriesPendingCloudSync().length;
      setBackupStatus(pending > 0 ? `Synchronisation (${pending})` : 'À jour');
    } else {
      setAccountEmail('');
      setBackupStatus('');
    }

    // Enrichit enfants depuis getChildren (réseau en fond) sans masquer le local déjà peint.
    void getChildren().then(list => {
      setChildrenState(list);
    });
  }, [pathname]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
  const handleReportProblem = useCallback(async () => {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const ctx = await collectBugReportContext({
        pathname,
        sentryEnabled: isSentryEnabled(),
      });
      const eventId = captureUserBugReport('Signalement utilisateur (bêta)', { ...ctx });
      const { url, body } = buildBugReportMailto({
        email: CONTACT_EMAIL,
        ctx,
        sentryEventId: eventId,
      });
      const opened = await Linking.canOpenURL(url);
      if (opened) {
        await Linking.openURL(url);
        Alert.alert(t('parent.report.openedTitle'), t('parent.report.openedBody'));
      } else {
        try {
          await Share.share({ message: body });
        } catch {
          Alert.alert(
            t('parent.report.fallbackTitle'),
            `${t('parent.report.fallbackBody')}\n\n${formatBugReportTechBlock(ctx, eventId)}`,
          );
        }
      }
    } catch {
      Alert.alert(t('error'), t('parent.report.failed'));
    } finally {
      setReportBusy(false);
    }
  }, [pathname, reportBusy, t]);

  const paid = tier === 'paid';

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, styles.fontsGate, { paddingTop: insets.top }]}>
        <ActivityIndicator color={THEME.brandCtaOrange} size="large" />
      </View>
    );
  }

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
              accessibilityLabel="Passer à Petitmo plus"
            >
              <View style={styles.rowIconPlaceholder} />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, styles.rowLabelAccent, dm500 ? { fontFamily: dm500 } : null]}
                >
                  Passer à Petitmo+
                </Text>
              </View>
              <Text style={styles.rowValue}>›</Text>
            </TouchableOpacity>
          )}
        </Section>

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
            <View style={styles.addChildIcon}>
              <Plus size={ICON_SIZES.md} color="#FFFFFF" strokeWidth={2.5} />
            </View>
            <Text style={[styles.addChildText, dm600 ? { fontFamily: dm600 } : null]}>Ajouter un enfant</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Aide" titleFontFamily={dm700}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => void handleReportProblem()}
            activeOpacity={0.85}
            disabled={reportBusy}
            accessibilityRole="button"
            accessibilityLabel={t('parent.report.cta')}
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>
                {t('parent.report.cta')}
              </Text>
            </View>
            <Text style={styles.rowValue}>{reportBusy ? '…' : '›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowBorderTop]}
            onPress={() => void openUrl(`mailto:${CONTACT_EMAIL}`)}
            activeOpacity={0.85}
            accessibilityRole="link"
            accessibilityLabel="Nous contacter"
          >
            <View style={styles.rowIconPlaceholder} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, dm500 ? { fontFamily: dm500 } : null]}>Nous contacter</Text>
            </View>
            <Text style={styles.rowValue}>{CONTACT_EMAIL}</Text>
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

        <Text style={[styles.versionText, dm500 ? { fontFamily: dm500 } : null]} accessibilityRole="text">
          Version {versionLabel}
        </Text>

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
    </View>
  );
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
  value,
  labelFontFamily,
}: {
  label: string;
  value?: string;
  labelFontFamily?: string;
}) {
  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={styles.rowIconPlaceholder} />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowLabel, labelFontFamily ? { fontFamily: labelFontFamily } : null]}
          numberOfLines={3}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : <View style={styles.rowValuePlaceholder} />}
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
  fontsGate: {
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: THEME.brandCtaOrange,
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
  versionText: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    textAlign: 'center',
  },
});

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  CreditCard,
  FileText,
  HelpCircle,
  Package,
  Plus,
  Settings,
  UserRound,
} from 'lucide-react-native';
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
  getRealAuthUser,
  peekHasRealAuthAccount,
  peekOfflineLocalResumeActive,
} from '@/lib/authAccount';
import { listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { ChildAvatar } from '@/components/ChildAvatar';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { getBillingIssueCached, syncBillingIssueFromUser } from '@/lib/billingIssue';
import { getCaptureLockedCached, peekCaptureLocked, syncCaptureLockedFromUser } from '@/lib/captureLock';
import {
  MENU_BG,
  MenuGroup,
  MenuRow,
  manageSubscriptionUrl,
  menuIcon,
  openUrl,
} from '@/components/parentSpace/menuUi';

function readLocalChildrenForSettings(): Child[] {
  const uid = peekLastRealAuthUserId();
  const list = uid ? listLocalChildrenForUser(uid) : listLocalChildren().filter(c => !(c.user_id ?? '').trim());
  return sortChildrenByBirthdateAsc(list);
}

export default function ParentSpaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useAppTranslation('common');
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const [children, setChildrenState] = useState<Child[]>(() => readLocalChildrenForSettings());
  const [tier, setTierState] = useState<UserTier>(() => peekUserTier());
  const [billingIssue, setBillingIssue] = useState(false);
  const [captureLocked, setCaptureLocked] = useState(() => peekCaptureLocked());
  const [hasRealAccount, setHasRealAccount] = useState(() => peekHasRealAuthAccount());

  const load = useCallback(() => {
    setChildrenState(readLocalChildrenForSettings());
    void getUserTier().then(setTierState);
    void getBillingIssueCached().then(setBillingIssue);
    void getCaptureLockedCached().then(setCaptureLocked);

    void getRealAuthUser().then((realUser) => {
      if (realUser) {
        setHasRealAccount(true);
        void syncBillingIssueFromUser(realUser).then(setBillingIssue);
        void syncCaptureLockedFromUser(realUser).then(setCaptureLocked);
        return;
      }
      if (peekHasRealAuthAccount() || peekOfflineLocalResumeActive()) {
        setHasRealAccount(true);
        return;
      }
      setHasRealAccount(false);
      setBillingIssue(false);
      setCaptureLocked(false);
    });

    void getChildren().then((list) => {
      setChildrenState(sortChildrenByBirthdateAsc(list));
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

        {/* Rubriques sans titres — bandes blanches + chevrons vers pages détail */}
        <MenuGroup>
          {hasRealAccount ? (
            <MenuRow
              icon={menuIcon(Package)}
              label={t('parent.orders.sectionTitle')}
              labelFontFamily={dm500}
              onPress={() => router.push('/parent-orders')}
            />
          ) : null}
          <MenuRow
            bordered={hasRealAccount}
            icon={menuIcon(HelpCircle)}
            label="Aide"
            labelFontFamily={dm500}
            onPress={() => router.push('/parent-help')}
          />
          <MenuRow
            bordered
            icon={menuIcon(Settings)}
            label="Application"
            labelFontFamily={dm500}
            onPress={() => router.push('/parent-application')}
          />
          {hasRealAccount ? (
            <MenuRow
              bordered
              icon={menuIcon(UserRound)}
              label={t('parent.account.sectionTitle')}
              labelFontFamily={dm500}
              onPress={() => router.push('/parent-account')}
            />
          ) : null}
          <MenuRow
            bordered
            icon={menuIcon(FileText)}
            label="Informations légales"
            labelFontFamily={dm500}
            onPress={() => router.push('/parent-legal')}
          />
        </MenuGroup>
      </ScrollView>
    </View>
  );
}

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
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.sm,
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
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  billingIssueBody: {
    fontSize: FONT_SIZES.base,
    fontWeight: '500',
    color: THEME.textSecondary,
    lineHeight: scale(22),
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
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyText: {
    fontSize: FONT_SIZES.base,
    color: THEME.textMuted,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  addChildIcon: {
    width: scale(28),
    height: scale(28),
    borderRadius: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
});

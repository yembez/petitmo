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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
import Constants from 'expo-constants';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getChildren, setSelectedChild } from '@/services/children';
import { useFocusEffect } from '@react-navigation/native';
import type { Child } from '@/types/local';
import { scale, verticalScale } from '@/utils/responsive';
import { calculateAge } from '@/utils/date';
import { getUserTier, setUserTier, type UserTier } from '@/lib/userTier';
import { Image } from 'expo-image';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';
import { supabase } from '@/lib/supabase';
import { getLocalMemoriesPendingCloudSync } from '@/lib/localDb';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';

const CONTACT_EMAIL = 'contact@petitmo.app';
const URL_PRIVACY = 'https://petitmo.app/privacy';
const URL_TERMS = 'https://petitmo.app/terms';
const URL_LEGAL = 'https://petitmo.app/legal';

function manageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

function appVersionLabel(): string {
  return Constants.expoConfig?.version?.trim() || '—';
}

async function openUrl(url: string): Promise<void> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) return;
  await Linking.openURL(url);
}

export default function ParentSpaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const [children, setChildrenState] = useState<Child[]>([]);
  const [tier, setTierState] = useState<UserTier>('free');
  const [accountEmail, setAccountEmail] = useState('');
  const [backupStatus, setBackupStatus] = useState('');

  const load = useCallback(async () => {
    const list = await getChildren();
    setChildrenState(list);

    const t = await getUserTier();
    setTierState(t);

    if (t === 'paid') {
      const { data: { session } } = await supabase.auth.getSession();
      const u = session?.user;
      const rawEmail =
        u?.email ??
        (typeof u?.user_metadata?.email === 'string' ? u.user_metadata.email : '') ??
        '';
      setAccountEmail(rawEmail.trim() || '—');

      const pending = getLocalMemoriesPendingCloudSync().length;
      setBackupStatus(pending > 0 ? `Synchronisation (${pending})` : 'À jour');
    } else {
      setAccountEmail('');
      setBackupStatus('');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      await setUserTier('free');
      router.replace('/onboarding');
    } catch {
      Alert.alert('Erreur', 'Impossible de te déconnecter pour le moment.');
    }
  }, [router]);

  const paid = tier === 'paid';

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, styles.fontsGate, { paddingTop: insets.top }]}>
        <ActivityIndicator color={THEME.brandTerracotta} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton} activeOpacity={0.8}>
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
        {paid ? (
          <Section title="Mon compte" titleFontFamily={dm600}>
            <StaticRow label={accountEmail || '—'} labelFontFamily={dm500} />
            <TouchableOpacity
              style={[styles.row, styles.rowBorderTop]}
              onPress={() => void handleSignOut()}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Se déconnecter"
            >
              <View style={styles.rowIconPlaceholder} />
              <View style={styles.rowText}>
                <Text style={[styles.rowLabelDestructive, dm500 ? { fontFamily: dm500 } : null]}>
                  Se déconnecter
                </Text>
              </View>
              <View style={styles.rowValuePlaceholder} />
            </TouchableOpacity>
          </Section>
        ) : null}

        <Section title="Mon abonnement" titleFontFamily={dm600}>
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

        <Section title="Mes enfants" titleFontFamily={dm600}>
          {children.length === 0 ? (
            <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
              Aucun enfant pour le moment.
            </Text>
          ) : (
            children.map((c) => (
              <Row
                key={c.id}
                icon={<ChildRowAvatar child={c} letterFontFamily={dm700} />}
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

        {paid ? (
          <Section title="Sauvegarde cloud" titleFontFamily={dm600}>
            <StaticRow label="Sauvegarde" value={backupStatus} labelFontFamily={dm500} />
          </Section>
        ) : null}

        <Section title="Aide" titleFontFamily={dm600}>
          <TouchableOpacity
            style={styles.row}
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

        <Section title="Informations légales" titleFontFamily={dm600}>
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
          Version {appVersionLabel()}
        </Text>
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

function ChildRowAvatar({
  child,
  letterFontFamily,
}: {
  child: Child;
  letterFontFamily?: string;
}) {
  const uri = resolveChildProfileImageUri(child.local_photo_path, child.photo_url);
  if (!uri) {
    return (
      <AvatarFallback
        letter={(child.name ?? '?').charAt(0).toUpperCase()}
        letterFontFamily={letterFontFamily}
      />
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.childRowAvatarImg}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={child.id}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.familyFlowScreenBg,
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
    backgroundColor: THEME.familyFlowScreenBg,
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
    paddingTop: SPACING.sm,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: SPACING.sm,
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
    color: THEME.brandTerracotta,
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
    backgroundColor: THEME.brandTerracotta,
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

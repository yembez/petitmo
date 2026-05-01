import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus, User } from 'lucide-react-native';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getChildren, setSelectedChild } from '@/services/children';
import { useFocusEffect } from '@react-navigation/native';
import type { Child } from '@/types/local';
import { scale, verticalScale } from '@/utils/responsive';
import { calculateAge } from '@/utils/date';
import { getUserTier } from '@/lib/userTier';
import { Image } from 'expo-image';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';

export default function ParentSpaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [children, setChildrenState] = useState<Child[]>([]);

  const load = useCallback(async () => {
    const list = await getChildren();
    setChildrenState(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton} activeOpacity={0.8}>
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Espace parent</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + verticalScale(24) }]}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Profil">
          <Row icon={<User size={ICON_SIZES.md} color="#6B7D8C" strokeWidth={2} />} label="Compte" value="Gérer" onPress={() => {}} />
        </Section>

        <Section title="Mes enfants">
          {children.length === 0 ? (
            <Text style={styles.emptyText}>Aucun enfant pour le moment.</Text>
          ) : (
            children.map((c) => (
              <Row
                key={c.id}
                icon={<ChildRowAvatar child={c} />}
                label={c.name ?? 'Sans nom'}
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
            <Text style={styles.addChildText}>Ajouter un enfant</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Sauvegarde / Cloud">
          <Row
            label="Sauvegarde"
            value="Voir"
            onPress={async () => {
              const tier = await getUserTier();
              if (tier === 'free') {
                router.push({ pathname: '/paywall', params: { context: 'EXPORT_PAYWALL' } });
                return;
              }
            }}
          />
        </Section>

        <Section title="Créer un livre">
          <Row label="Créer un livre" value="Bientôt" onPress={() => router.push('/book-preview')} />
        </Section>

        <Section title="Abonnement">
          <Row label="Abonnement" value="Voir" onPress={() => {}} />
        </Section>

        <Section title="Réglages">
          <Row label="Préférences" value="" onPress={() => {}} />
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  icon,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : <View style={styles.rowIconPlaceholder} />}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : <View style={styles.rowValuePlaceholder} />}
    </TouchableOpacity>
  );
}

function AvatarFallback({ letter }: { letter: string }) {
  return (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarFallbackText}>{letter}</Text>
    </View>
  );
}

function ChildRowAvatar({ child }: { child: Child }) {
  const uri = resolveChildProfileImageUri(child.local_photo_path, child.photo_url);
  if (!uri) {
    return <AvatarFallback letter={(child.name ?? '?').charAt(0).toUpperCase()} />;
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
    backgroundColor: THEME.bgScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: THEME.bgScreen,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
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
    color: '#3F4A5A',
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
    color: '#8791A1',
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  card: {
    backgroundColor: THEME.bg,
    borderRadius: scale(18),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
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
  },
  rowLabel: {
    fontSize: FONT_SIZES.base,
    color: '#3F4A5A',
    fontWeight: '500',
  },
  rowValue: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
    marginLeft: SPACING.sm,
  },
  rowValuePlaceholder: {
    width: scale(18),
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  addChildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  addChildIcon: {
    width: scale(34),
    height: scale(34),
    borderRadius: scale(17),
    backgroundColor: THEME.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  addChildText: {
    fontSize: FONT_SIZES.base,
    color: '#3F4A5A',
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


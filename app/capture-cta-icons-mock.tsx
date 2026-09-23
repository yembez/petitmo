/**
 * Mock Capturer plein écran — swipe entre variantes.
 * D1–D18 = disques · S1–S18 = carrés continuous (mêmes couleurs).
 * Icônes : Mic · PencilLine · ImagePlus
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  FlatList,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BookOpenText,
  ChevronLeft,
  Heart,
  ImagePlus,
  List,
  Mic,
  PencilLine,
  Plus,
} from 'lucide-react-native';
import CaptureDiscCtaGradient from '@/components/CaptureDiscCtaGradient';
import CaptureDiscCtaOutline from '@/components/CaptureDiscCtaOutline';
import {
  BRAND_ACTION_ACCENT,
  CAPTURE_CTA_GRADIENT_LOCATIONS,
  CAPTURE_CTA_ICON_CORAL,
  CAPTURE_CTA_IMPORT_GRADIENT,
  CAPTURE_CTA_RECORD_GRADIENT,
  CAPTURE_CTA_WRITE_GRADIENT,
  CAPTURE_SCREEN_BG,
  CAPTURE_TITLE_HEART,
} from '@/constants/captureScreenPalette';
import { CAPTURE_CTA_ICON_SIZE, CAPTURE_CTA_SIZE } from '@/constants/captureCtaVariant';
import { PETITMO_CTA_BORDER_RADIUS, PETITMO_CTA_BORDER_WIDTH } from '@/constants/petitmoCtaStyles';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';

const ICON_SIZE = CAPTURE_CTA_ICON_SIZE;
const STROKE = 2.4;
const SQUARE_RADIUS = PETITMO_CTA_BORDER_RADIUS;
const SQUARE_SIZE = CAPTURE_CTA_SIZE;
const OUTLINE_BORDER = '#9A9AA0';

const CORAL = CAPTURE_CTA_ICON_CORAL;
const CORAL_SOFT = BRAND_ACTION_ACCENT;
const INK = '#1C1C1E';
const GRAY = '#51545E';
const GRAY_SOFT = '#8E8E93';
const GRAY_PALE = '#E8E6E1';
const CORAL_PALE = 'rgba(252, 87, 87, 0.16)';
const CORAL_MID = 'rgba(253, 119, 100, 0.28)';
const GRAY_MID = 'rgba(81, 84, 94, 0.14)';
const WHITE = '#FFFFFF';

type DiscSpec = {
  bg?: string;
  gradient?: readonly [string, string] | readonly [string, string, string];
  border?: string;
  borderWidth?: number;
  icon: string;
};

type CtaBoard = {
  id: string;
  title: string;
  subtitle: string;
  shape: 'disc' | 'square';
  discs: DiscSpec | [DiscSpec, DiscSpec, DiscSpec];
};

const DISC_SPECS: Omit<CtaBoard, 'shape'>[] = [
  {
    id: 'D1',
    title: 'Outline actuel',
    subtitle: 'Fond beige + liseré gris · icônes corail',
    discs: { icon: CORAL },
  },
  {
    id: 'D2',
    title: 'Corail plein',
    subtitle: '3 × corail · icônes blanches',
    discs: { bg: CORAL, icon: WHITE },
  },
  {
    id: 'D3',
    title: 'Corail soft',
    subtitle: 'Fond corail pâle · icônes corail',
    discs: { bg: CORAL_PALE, icon: CORAL },
  },
  {
    id: 'D4',
    title: 'Corail mid',
    subtitle: 'Fond corail ~28 % · icônes corail',
    discs: { bg: CORAL_MID, icon: CORAL },
  },
  {
    id: 'D5',
    title: 'Gris plein',
    subtitle: '3 × gris · icônes blanches',
    discs: { bg: GRAY, icon: WHITE },
  },
  {
    id: 'D6',
    title: 'Gris soft',
    subtitle: 'Fond gris pâle · icônes encre',
    discs: { bg: GRAY_PALE, icon: INK },
  },
  {
    id: 'D7',
    title: 'Gris mid + corail',
    subtitle: 'Fond gris léger · icônes corail',
    discs: { bg: GRAY_MID, icon: CORAL },
  },
  {
    id: 'D8',
    title: 'Noir plein',
    subtitle: '3 × encre · icônes blanches',
    discs: { bg: INK, icon: WHITE },
  },
  {
    id: 'D9',
    title: 'Blanc + liseré noir',
    subtitle: 'Blanc · icônes encre',
    discs: { bg: WHITE, border: INK, borderWidth: 1.5, icon: INK },
  },
  {
    id: 'D10',
    title: 'Blanc + liseré corail',
    subtitle: 'Blanc · icônes corail',
    discs: { bg: WHITE, border: CORAL, borderWidth: 1.5, icon: CORAL },
  },
  {
    id: 'D11',
    title: 'Trio uni distinct',
    subtitle: 'Corail / Gris / Noir · icônes blanches',
    discs: [
      { bg: CORAL, icon: WHITE },
      { bg: GRAY, icon: WHITE },
      { bg: INK, icon: WHITE },
    ],
  },
  {
    id: 'D12',
    title: 'Trio soft distinct',
    subtitle: 'Corail pâle / Gris pâle / Blanc+liseré',
    discs: [
      { bg: CORAL_PALE, icon: CORAL },
      { bg: GRAY_PALE, icon: GRAY },
      { bg: WHITE, border: GRAY_SOFT, borderWidth: 1.25, icon: INK },
    ],
  },
  {
    id: 'D13',
    title: 'Accent corail seul',
    subtitle: 'Écrire corail · autres outline',
    discs: [{ icon: CORAL }, { bg: CORAL, icon: WHITE }, { icon: CORAL }],
  },
  {
    id: 'D14',
    title: 'Accent noir seul',
    subtitle: 'Enregistrer noir · autres soft corail',
    discs: [
      { bg: INK, icon: WHITE },
      { bg: CORAL_PALE, icon: CORAL },
      { bg: CORAL_PALE, icon: CORAL },
    ],
  },
  {
    id: 'D15',
    title: 'Dégradés charte',
    subtitle: 'Bleu→violet / magenta→rose / rose→corail',
    discs: [
      { gradient: CAPTURE_CTA_RECORD_GRADIENT, icon: WHITE },
      { gradient: CAPTURE_CTA_WRITE_GRADIENT, icon: WHITE },
      { gradient: CAPTURE_CTA_IMPORT_GRADIENT, icon: WHITE },
    ],
  },
  {
    id: 'D16',
    title: 'Corail action uni',
    subtitle: '3 × #FD7764 · icônes blanches',
    discs: { bg: CORAL_SOFT, icon: WHITE },
  },
  {
    id: 'D17',
    title: 'Noir + icônes corail',
    subtitle: 'Encre · glyphes corail',
    discs: { bg: INK, icon: CORAL },
  },
  {
    id: 'D18',
    title: 'Outline noir',
    subtitle: 'Fond beige · liseré encre · icônes encre',
    discs: { border: INK, borderWidth: 1.5, icon: INK },
  },
];

const ALL_BOARDS: CtaBoard[] = [
  ...DISC_SPECS.map(b => ({ ...b, shape: 'disc' as const })),
  ...DISC_SPECS.map(b => ({
    ...b,
    id: b.id.replace(/^D/, 'S'),
    title: `Carré · ${b.title}`,
    subtitle: `${b.subtitle} · continuous`,
    shape: 'square' as const,
  })),
];

function resolveDiscs(board: CtaBoard): [DiscSpec, DiscSpec, DiscSpec] {
  if (Array.isArray(board.discs)) return board.discs;
  return [board.discs, board.discs, board.discs];
}

function Glyph({
  kind,
  color,
}: {
  kind: 'mic' | 'pen' | 'image';
  color: string;
}) {
  const props = { size: ICON_SIZE, color, fill: 'none' as const, strokeWidth: STROKE };
  if (kind === 'mic') return <Mic {...props} />;
  if (kind === 'pen') return <PencilLine {...props} />;
  return <ImagePlus {...props} />;
}

function MockSquareCta({
  label,
  kind,
  spec,
}: {
  label: string;
  kind: 'mic' | 'pen' | 'image';
  spec: DiscSpec;
}) {
  const isOutlineOnly = !spec.bg && !spec.gradient;
  const bg = isOutlineOnly
    ? CAPTURE_SCREEN_BG
    : (spec.bg ?? (spec.gradient ? 'transparent' : CAPTURE_SCREEN_BG));
  const borderColor = spec.border ?? (isOutlineOnly ? OUTLINE_BORDER : 'transparent');
  const borderWidth = spec.borderWidth ?? (isOutlineOnly || spec.border ? PETITMO_CTA_BORDER_WIDTH : 0);

  return (
    <View style={styles.squareTouch}>
      <View
        style={[
          styles.squareShadow,
          {
            width: SQUARE_SIZE,
            height: SQUARE_SIZE,
            borderRadius: SQUARE_RADIUS,
          },
        ]}
      >
        <View
          style={[
            styles.squareShell,
            {
              width: SQUARE_SIZE,
              height: SQUARE_SIZE,
              borderRadius: SQUARE_RADIUS,
              backgroundColor: bg,
              borderWidth,
              borderColor,
              borderCurve: 'continuous',
            },
          ]}
        >
          {spec.gradient ? (
            <LinearGradient
              colors={[
                spec.gradient[0],
                spec.gradient[0],
                spec.gradient[spec.gradient.length - 1],
                spec.gradient[spec.gradient.length - 1],
              ]}
              locations={[...CAPTURE_CTA_GRADIENT_LOCATIONS]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
          <View style={styles.squareIcon}>
            <Glyph kind={kind} color={spec.icon} />
          </View>
        </View>
      </View>
      <Text style={styles.squareLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MockCta({
  label,
  kind,
  spec,
  shape,
}: {
  label: string;
  kind: 'mic' | 'pen' | 'image';
  spec: DiscSpec;
  shape: 'disc' | 'square';
}) {
  if (shape === 'square') {
    return <MockSquareCta label={label} kind={kind} spec={spec} />;
  }

  const icon = <Glyph kind={kind} color={spec.icon} />;
  const isOutlineOnly = !spec.bg && !spec.gradient;

  if (isOutlineOnly && !spec.border) {
    return (
      <CaptureDiscCtaOutline
        label={label}
        icon={<Glyph kind={kind} color={spec.icon} />}
        onPress={() => {}}
      />
    );
  }

  if (isOutlineOnly && spec.border) {
    return (
      <CaptureDiscCtaGradient
        label={label}
        icon={icon}
        discColor={CAPTURE_SCREEN_BG}
        discBorderColor={spec.border}
        discBorderWidth={spec.borderWidth ?? 1.5}
        onPress={() => {}}
      />
    );
  }

  return (
    <CaptureDiscCtaGradient
      label={label}
      icon={icon}
      discColor={spec.bg}
      discGradient={spec.gradient}
      discBorderColor={spec.border}
      discBorderWidth={spec.borderWidth ?? 0}
      onPress={() => {}}
    />
  );
}

function FakeTabBar({ bottomPad }: { bottomPad: number }) {
  const items = [
    { Icon: Plus, label: 'Capturer', active: true },
    { Icon: List, label: 'Journal', active: false },
    { Icon: Heart, label: 'Favoris', active: false },
    { Icon: BookOpenText, label: 'Livres', active: false },
  ] as const;

  return (
    <View style={[styles.fakeTabBar, { paddingBottom: Math.max(bottomPad, verticalScale(8)) }]}>
      {items.map(({ Icon, label, active }) => (
        <View key={label} style={styles.fakeTabItem}>
          <Icon
            size={scale(22)}
            color={INK}
            strokeWidth={active ? 2.4 : 2}
            opacity={active ? 1 : 0.55}
          />
          <Text style={[styles.fakeTabLabel, active && styles.fakeTabLabelActive]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function CaptureMockPage({
  board,
  width,
  topInset,
  bottomInset,
}: {
  board: CtaBoard;
  width: number;
  topInset: number;
  bottomInset: number;
}) {
  const [record, write, importSpec] = resolveDiscs(board);
  const tabPad = tabBarFloatingOverlapPad(bottomInset);

  return (
    <View style={[styles.page, { width }]}>
      <View style={[styles.pageInner, { paddingTop: topInset + verticalScale(8) }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerDate}>dimanche 20 septembre</Text>
          <View style={styles.settingsDot}>
            <Text style={styles.settingsEllipsis}>···</Text>
          </View>
        </View>

        <View style={styles.photoCard}>
          <LinearGradient
            colors={['#F2D4C8', '#E8B4A8', '#D4A090']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(28,28,30,0.2)', 'rgba(28,28,30,0.55)']}
            locations={[0, 0.45, 1]}
            style={styles.photoScrim}
            pointerEvents="none"
          />
          <View style={styles.photoPills}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>Léna</Text>
            </View>
            <View style={styles.pill}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>3 ans</Text>
            </View>
          </View>
          <Text style={styles.photoTagline}>Un souvenir, aujourd’hui</Text>
        </View>

        <View style={styles.lower}>
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Heart
                size={scale(22)}
                color={CAPTURE_TITLE_HEART}
                fill={CAPTURE_TITLE_HEART}
                strokeWidth={0}
                style={styles.titleHeart}
              />
              <Text style={styles.titleBold}>Capturer</Text>
            </View>
            <Text style={styles.titleSub}>ce moment</Text>
          </View>

          <View style={styles.ctaRow}>
            <MockCta label="Enregistrer" kind="mic" spec={record} shape={board.shape} />
            <MockCta label="Écrire" kind="pen" spec={write} shape={board.shape} />
            <MockCta label="Importer" kind="image" spec={importSpec} shape={board.shape} />
          </View>
        </View>

        <View style={{ height: tabPad + verticalScale(52) }} />
      </View>

      <FakeTabBar bottomPad={bottomInset} />
    </View>
  );
}

export default function CaptureCtaIconsMockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<CtaBoard>>(null);
  const [index, setIndex] = useState(0);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.max(0, Math.min(ALL_BOARDS.length - 1, next)));
    },
    [width],
  );

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(ALL_BOARDS.length - 1, i));
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
    setIndex(clamped);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CtaBoard>) => (
      <CaptureMockPage
        board={item}
        width={width}
        topInset={insets.top}
        bottomInset={insets.bottom}
      />
    ),
    [width, insets.top, insets.bottom],
  );

  const current = ALL_BOARDS[index];

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={ALL_BOARDS}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2}
        windowSize={3}
      />

      <View style={[styles.chrome, { top: insets.top + verticalScale(4) }]} pointerEvents="box-none">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <ChevronLeft size={scale(26)} color={INK} strokeWidth={2.2} />
        </Pressable>

        <View style={styles.badge}>
          <Text style={styles.badgeId}>
            {current.id} · {index + 1}/{ALL_BOARDS.length} ·{' '}
            {current.shape === 'square' ? 'carré' : 'disque'}
          </Text>
          <Text style={styles.badgeTitle} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={styles.badgeSub} numberOfLines={1}>
            {current.subtitle}
          </Text>
        </View>

        <View style={styles.navBtns}>
          <Pressable
            onPress={() => goTo(index - 1)}
            disabled={index === 0}
            style={[styles.navBtn, index === 0 && styles.navBtnDisabled]}
            hitSlop={8}
          >
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => goTo(index + 1)}
            disabled={index === ALL_BOARDS.length - 1}
            style={[
              styles.navBtn,
              index === ALL_BOARDS.length - 1 && styles.navBtnDisabled,
            ]}
            hitSlop={8}
          >
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const PHOTO_H = verticalScale(340);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  page: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  pageInner: {
    flex: 1,
    paddingHorizontal: scale(20),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: verticalScale(12),
    minHeight: scale(40),
  },
  headerDate: {
    fontSize: scale(13),
    color: THEME.textMuted,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  settingsDot: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: 'rgba(60, 49, 38, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsEllipsis: {
    fontSize: scale(18),
    color: INK,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: -2,
  },
  photoCard: {
    height: PHOTO_H,
    borderRadius: scale(28),
    overflow: 'hidden',
    backgroundColor: '#E8E8ED',
  },
  photoScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  photoPills: {
    position: 'absolute',
    top: scale(14),
    left: scale(14),
    right: scale(14),
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  pillDot: {
    width: scale(6),
    height: scale(6),
    borderRadius: scale(3),
    backgroundColor: CORAL_SOFT,
  },
  pillText: {
    fontSize: scale(13),
    fontWeight: '600',
    color: INK,
  },
  photoTagline: {
    position: 'absolute',
    left: scale(18),
    right: scale(18),
    bottom: scale(18),
    fontSize: scale(22),
    fontWeight: '600',
    color: WHITE,
    letterSpacing: -0.3,
  },
  lower: {
    marginTop: verticalScale(22),
    gap: verticalScale(22),
  },
  titleBlock: {
    alignItems: 'flex-start',
    gap: verticalScale(2),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleHeart: {
    marginRight: scale(6),
  },
  titleBold: {
    fontSize: scale(34),
    fontWeight: '700',
    color: INK,
    letterSpacing: -0.8,
  },
  titleSub: {
    fontSize: scale(34),
    fontWeight: '300',
    color: INK,
    letterSpacing: -0.8,
    marginLeft: scale(28),
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: scale(22),
  },
  squareTouch: {
    alignItems: 'center',
    gap: verticalScale(10),
    maxWidth: SQUARE_SIZE + scale(16),
    paddingHorizontal: scale(6),
  },
  squareShadow: {
    ...Platform.select({
      ios: {
        shadowColor: '#1C1C1E',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  squareShell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  squareIcon: {
    zIndex: 1,
  },
  squareLabel: {
    fontSize: scale(12),
    lineHeight: scale(14),
    color: THEME.captureCtaLabelColor,
    letterSpacing: 0.15,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: scale(2),
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  fakeTabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: CAPTURE_SCREEN_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(28,28,30,0.12)',
    paddingTop: verticalScale(8),
  },
  fakeTabItem: {
    flex: 1,
    alignItems: 'center',
    gap: verticalScale(2),
  },
  fakeTabLabel: {
    fontSize: scale(10),
    color: INK,
    opacity: 0.55,
  },
  fakeTabLabelActive: {
    opacity: 1,
    fontWeight: '600',
  },
  chrome: {
    position: 'absolute',
    left: scale(8),
    right: scale(8),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scale(6),
    zIndex: 20,
  },
  backBtn: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: 'rgba(254,251,247,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  badge: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(254,251,247,0.94)',
    borderRadius: scale(12),
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(28,28,30,0.1)',
  },
  badgeId: {
    fontSize: scale(11),
    fontWeight: '700',
    color: CORAL,
    letterSpacing: 0.3,
  },
  badgeTitle: {
    fontSize: scale(13),
    fontWeight: '700',
    color: INK,
    marginTop: 1,
  },
  badgeSub: {
    fontSize: scale(11),
    color: THEME.textMuted,
    marginTop: 1,
  },
  navBtns: {
    flexDirection: 'row',
    gap: scale(4),
  },
  navBtn: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: 'rgba(254,251,247,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(28,28,30,0.12)',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    fontSize: scale(22),
    color: INK,
    marginTop: -2,
  },
});

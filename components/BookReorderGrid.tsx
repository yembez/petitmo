import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Mic, Video } from 'lucide-react-native';
import { bookCoverThemeForId } from '@/constants/bookCoverColors';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';

/**
 * Une case du pavage, dans l’ordre de lecture. Le mode Réorganiser affiche **tout** le
 * livre — couverture, pages chapitre, quatrième — pour donner la même vue que le spread ;
 * seules les pages de souvenirs sont saisissables (`movable`).
 */
export type BookReorderSlot = {
  /** Identité stable : clé d’entrée pour une page contenu, `fixed::n` sinon. */
  key: string;
  movable: boolean;
  /** Folio Gelato affiché, `null` hors numérotation (couverture, quatrième). */
  folio: number | null;
  /** Index de la double page. */
  row: number;
  side: 'left' | 'right';
  kind: 'photo' | 'text' | 'audio' | 'video' | 'cover' | 'chapter' | 'back-cover';
  /** Aperçu léger hors fenêtre de rendu. */
  imageUri: string | null;
  text: string | null;
};

type Props = {
  slots: BookReorderSlot[];
  /** Ordre final des pages contenu après un dépôt — permutation des clés `movable`. */
  onReorder: (orderedKeys: string[]) => void;
  coverColorId?: string | null;
  /** Marge basse (barre d’actions). */
  bottomInset?: number;
  /**
   * Rendu fidèle de la page (maquette réelle). Appelé uniquement pour les cases proches
   * du viewport ; ailleurs on retombe sur l’aperçu léger. Sans cette fenêtre, un livre de
   * 80 pages monterait 80 maquettes d’un coup.
   */
  renderContent?: (slot: BookReorderSlot, width: number, height: number) => ReactNode;
  /** Police du folio — la même qu’en lecture. */
  folioFont?: string;
};

/** Doubles pages rendues en maquette réelle au-delà du viewport, de chaque côté. */
const WINDOW_ROWS = 2;

const SIDE_PAD = scale(16);
const ROW_GAP = verticalScale(22);
/** Ratio page Gelato 21 × 28. */
const PAGE_RATIO = 28 / 21;
/** Hauteur du folio sous la page (marge 8 + ligne 11pt) — disposition de `BookBrowseLeaf`. */
const FOLIO_H = 22;
const MOVE_MS = 180;
/** Bande de déclenchement du défilement automatique en bord de zone. */
const AUTOSCROLL_EDGE = verticalScale(80);
const AUTOSCROLL_STEP = 14;

/**
 * Bords couverture autour d’une double page ouverte — mêmes proportions qu’en lecture
 * (`BookPortraitSpreadRow`), à l’échelle de la grille : latérales plus larges que
 * haute / basse.
 */
const COVER_EDGE_W = scale(4);
const COVER_RIM_H = scale(2);
const SPINE_W = scale(10);

type Geom = { x: number; y: number };

/**
 * Nouvelle carte clé → rang après déplacement de `key` de `from` vers `to`.
 * Les autres pages se décalent d’un cran, jamais plus : le multiset est préservé.
 */
function movedPositions(
  positions: Record<string, number>,
  key: string,
  from: number,
  to: number,
): Record<string, number> {
  'worklet';
  const next: Record<string, number> = {};
  for (const k in positions) {
    const rank = positions[k]!;
    if (k === key) {
      next[k] = to;
    } else if (from < to && rank > from && rank <= to) {
      next[k] = rank - 1;
    } else if (from > to && rank >= to && rank < from) {
      next[k] = rank + 1;
    } else {
      next[k] = rank;
    }
  }
  return next;
}

function SlotPreview({ slot }: { slot: BookReorderSlot }) {
  if (slot.imageUri) {
    return (
      <ExpoImage
        source={{ uri: slot.imageUri }}
        recyclingKey={slot.key}
        cachePolicy="memory-disk"
        transition={0}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
      />
    );
  }
  if (slot.kind === 'audio' || slot.kind === 'video') {
    const Icon = slot.kind === 'audio' ? Mic : Video;
    return (
      <View style={styles.iconPreview}>
        <Icon size={scale(20)} color={THEME.textMuted} strokeWidth={2} />
      </View>
    );
  }
  return (
    <View style={styles.textPreview}>
      <Text style={styles.textPreviewLabel} numberOfLines={6}>
        {slot.text?.trim() || '…'}
      </Text>
    </View>
  );
}

type LeafProps = {
  slot: BookReorderSlot;
  pageW: number;
  pageH: number;
  active: boolean;
  renderContent?: (slot: BookReorderSlot, width: number, height: number) => ReactNode;
  folioFont?: string;
};

/** Une feuille : bords vifs, papier blanc, folio dessous — comme `BookBrowseLeaf`. */
function Leaf({ slot, pageW, pageH, active, renderContent, folioFont }: LeafProps) {
  const content = useMemo(
    () => (active && renderContent ? renderContent(slot, pageW, pageH) : null),
    [active, renderContent, slot, pageH, pageW],
  );
  const showFolio = slot.folio != null && slot.folio > 0;

  return (
    <>
      <View style={[styles.leaf, { width: pageW, height: pageH }]} pointerEvents="none">
        {content ?? <SlotPreview slot={slot} />}
      </View>
      <Text style={[styles.folio, folioFont ? { fontFamily: folioFont } : null]}>
        {showFolio ? String(slot.folio) : ' '}
      </Text>
    </>
  );
}

type MovableLeafProps = LeafProps & {
  /** Géométries des emplacements contenu, indexées par rang. */
  movableGeom: Geom[];
  positions: ReturnType<typeof useSharedValue<Record<string, number>>>;
  draggingKey: ReturnType<typeof useSharedValue<string | null>>;
  scrollY: ReturnType<typeof useSharedValue<number>>;
  viewportH: ReturnType<typeof useSharedValue<number>>;
  contentH: number;
  scrollRef: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  onDrop: (orderedKeys: string[]) => void;
};

function MovableLeafInner({
  slot,
  pageW,
  pageH,
  active,
  renderContent,
  folioFont,
  movableGeom,
  positions,
  draggingKey,
  scrollY,
  viewportH,
  contentH,
  scrollRef,
  onDrop,
}: MovableLeafProps) {
  const initial = movableGeom[positions.value[slot.key] ?? 0] ?? { x: 0, y: 0 };
  const x = useSharedValue(initial.x);
  const y = useSharedValue(initial.y);
  const lifted = useSharedValue(0);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const startRank = useSharedValue(0);

  /** Une page au repos suit son emplacement ; celle qu’on tient suit le doigt. */
  useAnimatedReaction(
    () => positions.value[slot.key],
    (rank, previous) => {
      if (rank == null || rank === previous) return;
      if (draggingKey.value === slot.key) return;
      const geom = movableGeom[rank];
      if (!geom) return;
      x.value = withTiming(geom.x, { duration: MOVE_MS });
      y.value = withTiming(geom.y, { duration: MOVE_MS });
    },
  );

  /**
   * Le pavage lui-même peut bouger à rang constant : une page chapitre qui apparaît après
   * un déplacement décale toutes les suivantes. Sans ce recalage, une page dont le rang
   * n’a pas changé resterait à son ancienne place.
   */
  useEffect(() => {
    if (draggingKey.value === slot.key) return;
    const geom = movableGeom[positions.value[slot.key] ?? 0];
    if (!geom) return;
    x.value = withTiming(geom.x, { duration: MOVE_MS });
    y.value = withTiming(geom.y, { duration: MOVE_MS });
  }, [draggingKey, movableGeom, positions, slot.key, x, y]);

  const commit = useCallback(() => {
    const map = positions.value;
    const ordered = Object.keys(map).sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
    onDrop(ordered);
  }, [onDrop, positions]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(200)
        .onStart(() => {
          draggingKey.value = slot.key;
          startX.value = x.value;
          startY.value = y.value;
          startScrollY.value = scrollY.value;
          startRank.value = positions.value[slot.key] ?? 0;
          lifted.value = withTiming(1, { duration: 120 });
        })
        .onUpdate(event => {
          // Le décalage de défilement est réintégré : les positions sont en coordonnées contenu.
          const scrolled = scrollY.value - startScrollY.value;
          x.value = startX.value + event.translationX;
          y.value = startY.value + event.translationY + scrolled;

          const fingerY = y.value + pageH / 2 - scrollY.value;
          if (fingerY < AUTOSCROLL_EDGE && scrollY.value > 0) {
            scrollTo(scrollRef, 0, Math.max(0, scrollY.value - AUTOSCROLL_STEP), false);
          } else if (
            fingerY > viewportH.value - AUTOSCROLL_EDGE &&
            scrollY.value < contentH - viewportH.value
          ) {
            scrollTo(scrollRef, 0, scrollY.value + AUTOSCROLL_STEP, false);
          }

          /**
           * Emplacement contenu le plus proche. Le pavage saute les pages figées
           * (chapitres, couverture) : une recherche du minimum est plus juste — et plus
           * simple à lire — qu’une arithmétique ligne / colonne à trous.
           */
          let target = 0;
          let best = Number.POSITIVE_INFINITY;
          for (let r = 0; r < movableGeom.length; r++) {
            const geom = movableGeom[r]!;
            const dx = geom.x - x.value;
            const dy = geom.y - y.value;
            const dist = dx * dx + dy * dy;
            if (dist < best) {
              best = dist;
              target = r;
            }
          }
          const current = positions.value[slot.key] ?? 0;
          if (target !== current) {
            positions.value = movedPositions(positions.value, slot.key, current, target);
          }
        })
        .onEnd(() => {
          const geom = movableGeom[positions.value[slot.key] ?? 0] ?? { x: x.value, y: y.value };
          x.value = withTiming(geom.x, { duration: MOVE_MS });
          y.value = withTiming(geom.y, { duration: MOVE_MS });
          lifted.value = withTiming(0, { duration: 120 });
          draggingKey.value = null;
          if ((positions.value[slot.key] ?? 0) !== startRank.value) {
            runOnJS(commit)();
          }
        })
        .onFinalize(() => {
          if (draggingKey.value === slot.key) {
            draggingKey.value = null;
            lifted.value = withTiming(0, { duration: 120 });
          }
        }),
    [
      commit,
      contentH,
      draggingKey,
      lifted,
      movableGeom,
      pageH,
      positions,
      scrollRef,
      scrollY,
      slot.key,
      startRank,
      startScrollY,
      startX,
      startY,
      viewportH,
      x,
      y,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + lifted.value * 0.06 },
    ],
    zIndex: lifted.value > 0 ? 10 : 3,
    shadowOpacity: lifted.value * 0.3,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.slot, { width: pageW }, animatedStyle]}
        accessibilityRole="button"
        accessibilityLabel={
          slot.folio != null ? `Page ${slot.folio}, maintenir pour déplacer` : 'Page, maintenir pour déplacer'
        }
      >
        <Leaf
          slot={slot}
          pageW={pageW}
          pageH={pageH}
          active={active}
          renderContent={renderContent}
          folioFont={folioFont}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const MovableLeaf = memo(MovableLeafInner);

/** Page figée (couverture, chapitre, quatrième) : affichée pour la vue, jamais déplacée. */
const FixedLeaf = memo(function FixedLeafInner({
  slot,
  geom,
  pageW,
  pageH,
  active,
  renderContent,
  folioFont,
}: LeafProps & { geom: Geom }) {
  return (
    <View
      style={[styles.slot, { width: pageW, transform: [{ translateX: geom.x }, { translateY: geom.y }] }]}
      pointerEvents="none"
    >
      <Leaf
        slot={slot}
        pageW={pageW}
        pageH={pageH}
        active={active}
        renderContent={renderContent}
        folioFont={folioFont}
      />
    </View>
  );
});

/**
 * Plan couverture d’une double page ouverte + pliure centrale, sous les feuilles.
 * Repris de `BookPortraitSpreadRow` pour que la grille et le spread montrent le même objet.
 */
const SpreadBoard = memo(function SpreadBoardInner({
  y,
  pageW,
  pageH,
  paper,
  line,
  variant,
}: {
  y: number;
  pageW: number;
  pageH: number;
  paper: string;
  line: string;
  variant: 'pair' | 'cover-solo';
}) {
  if (variant === 'cover-solo') {
    // Livre fermé : pas de liseré, mais du volume — deux calques d’ombre empilés
    // (RN n’en gère qu’une par vue), au format exact de la page.
    return (
      <>
        <View
          pointerEvents="none"
          style={[
            styles.board,
            styles.coverSoloAmbient,
            { backgroundColor: paper, top: y, left: pageW, width: pageW, height: pageH },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.board,
            styles.coverSoloContact,
            { backgroundColor: paper, top: y, left: pageW, width: pageW, height: pageH },
          ]}
        />
      </>
    );
  }

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.board,
          {
            backgroundColor: paper,
            top: y - COVER_RIM_H,
            left: -COVER_EDGE_W,
            width: pageW * 2 + COVER_EDGE_W * 2,
            height: pageH + COVER_RIM_H * 2,
          },
        ]}
      >
        <View style={[styles.boardInnerLine, { borderColor: line }]} pointerEvents="none" />
      </View>
      <LinearGradient
        colors={[
          'rgba(0,0,0,0)',
          'rgba(0,0,0,0.14)',
          'rgba(0,0,0,0.30)',
          'rgba(0,0,0,0.14)',
          'rgba(0,0,0,0)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        pointerEvents="none"
        style={[styles.spine, { top: y, height: pageH, width: SPINE_W, left: pageW - SPINE_W / 2 }]}
      >
        <View style={styles.spineLine} pointerEvents="none" />
      </LinearGradient>
    </>
  );
});

function BookReorderGridInner({
  slots,
  onReorder,
  coverColorId,
  bottomInset = 0,
  renderContent,
  folioFont,
}: Props) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(1);
  const draggingKey = useSharedValue<string | null>(null);
  const lastTopRow = useSharedValue(0);
  const [topRow, setTopRow] = useState(0);
  const [visibleRows, setVisibleRows] = useState(3);

  const coverTheme = useMemo(() => bookCoverThemeForId(coverColorId), [coverColorId]);

  const { width: screenWidth } = useWindowDimensions();
  const [pageW, pageH] = useMemo(() => {
    // Deux pages jointives, comme la double page ouverte du spread : aucun écart central.
    const w = Math.max(1, Math.floor((screenWidth - SIDE_PAD * 2) / 2));
    return [w, Math.round(w * PAGE_RATIO)] as const;
  }, [screenWidth]);

  const rowPitch = pageH + FOLIO_H + ROW_GAP;
  const rowCount = slots.reduce((max, s) => Math.max(max, s.row + 1), 0);
  const contentH = Math.max(0, rowCount * rowPitch - ROW_GAP);

  const geomForSlot = useCallback(
    (slot: BookReorderSlot): Geom => ({
      x: slot.side === 'left' ? 0 : pageW,
      y: slot.row * rowPitch,
    }),
    [pageW, rowPitch],
  );

  /** Emplacements contenu, dans l’ordre de lecture : rang → géométrie. */
  const movableSlots = useMemo(() => slots.filter(s => s.movable), [slots]);
  const movableGeom = useMemo(() => movableSlots.map(geomForSlot), [geomForSlot, movableSlots]);

  const initialPositions = useMemo(() => {
    const map: Record<string, number> = {};
    movableSlots.forEach((s, i) => {
      map[s.key] = i;
    });
    return map;
  }, [movableSlots]);

  const positions = useSharedValue<Record<string, number>>(initialPositions);

  /** Resynchronise après une écriture SQLite (ou un ajout de page depuis Favoris). */
  useEffect(() => {
    positions.value = initialPositions;
  }, [initialPositions, positions]);

  const scrollHandler = useAnimatedScrollHandler(event => {
    scrollY.value = event.contentOffset.y;
    // Ne remonter au thread JS qu’au franchissement d’une double page, pas à chaque frame.
    const row = Math.max(0, Math.floor(event.contentOffset.y / rowPitch));
    if (row !== lastTopRow.value) {
      lastTopRow.value = row;
      runOnJS(setTopRow)(row);
    }
  });

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = Math.max(1, e.nativeEvent.layout.height);
      viewportH.value = h;
      setVisibleRows(Math.ceil(h / rowPitch));
    },
    [rowPitch, viewportH],
  );

  const isRowActive = useCallback(
    (row: number) => row >= topRow - WINDOW_ROWS && row <= topRow + visibleRows + WINDOW_ROWS,
    [topRow, visibleRows],
  );

  /** Plans couverture : une entrée par double page, dérivée du pavage reçu. */
  const boards = useMemo(() => {
    const perRow = new Map<number, BookReorderSlot[]>();
    for (const slot of slots) {
      const list = perRow.get(slot.row);
      if (list) list.push(slot);
      else perRow.set(slot.row, [slot]);
    }
    const out: { row: number; variant: 'pair' | 'cover-solo' }[] = [];
    for (const [row, list] of perRow) {
      if (list.length >= 2) out.push({ row, variant: 'pair' });
      else if (list[0]?.kind === 'cover') out.push({ row, variant: 'cover-solo' });
    }
    return out;
  }, [slots]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onLayout={onLayout}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      contentContainerStyle={{
        paddingHorizontal: SIDE_PAD,
        paddingTop: ROW_GAP,
        paddingBottom: ROW_GAP + bottomInset,
      }}
    >
      <View style={{ height: contentH }}>
        {boards.map(board => (
          <SpreadBoard
            key={`board-${board.row}`}
            y={board.row * rowPitch}
            pageW={pageW}
            pageH={pageH}
            paper={coverTheme.paper}
            line={coverTheme.line}
            variant={board.variant}
          />
        ))}
        {slots
          .filter(s => !s.movable)
          .map(slot => (
            <FixedLeaf
              key={slot.key}
              slot={slot}
              geom={geomForSlot(slot)}
              pageW={pageW}
              pageH={pageH}
              active={isRowActive(slot.row)}
              renderContent={renderContent}
              folioFont={folioFont}
            />
          ))}
        {movableSlots.map(slot => (
          <MovableLeaf
            key={slot.key}
            slot={slot}
            pageW={pageW}
            pageH={pageH}
            active={isRowActive(slot.row)}
            renderContent={renderContent}
            folioFont={folioFont}
            movableGeom={movableGeom}
            positions={positions}
            draggingKey={draggingKey}
            scrollY={scrollY}
            viewportH={viewportH}
            contentH={contentH}
            scrollRef={scrollRef}
            onDrop={onReorder}
          />
        ))}
      </View>
    </Animated.ScrollView>
  );
}

export default memo(BookReorderGridInner);

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 3,
    /** Ombre du soulèvement pendant le glisser — animée, nulle au repos. */
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: verticalScale(6) },
    shadowRadius: scale(12),
  },
  /** Une page de livre : bords vifs, papier blanc. */
  leaf: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  folio: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(60,60,67,0.5)',
    textAlign: 'center',
  },
  board: {
    position: 'absolute',
    zIndex: 0,
    /**
     * Android : pas d’`elevation` — elle primerait sur `zIndex` et ferait passer le plan
     * couverture par-dessus les pages. Ombre iOS / web uniquement.
     */
    ...Platform.select({
      android: {},
      default: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(5) },
        shadowOpacity: 0.18,
        shadowRadius: scale(12),
      },
    }),
  },
  /** Couverture seule : diffusion large, le livre fermé décolle du fond. */
  coverSoloAmbient: {
    ...Platform.select({
      android: {},
      default: {
        shadowOffset: { width: 0, height: verticalScale(10) },
        shadowOpacity: 0.24,
        shadowRadius: scale(18),
      },
    }),
  },
  /** Couverture seule : ombre de contact, ancre le bas du livre. */
  coverSoloContact: {
    ...Platform.select({
      android: {},
      default: {
        shadowOffset: { width: 0, height: verticalScale(2) },
        shadowOpacity: 0.2,
        shadowRadius: scale(5),
      },
    }),
  },
  boardInnerLine: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
  },
  spine: {
    position: 'absolute',
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spineLine: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  textPreview: {
    ...StyleSheet.absoluteFillObject,
    padding: scale(10),
    justifyContent: 'center',
  },
  textPreviewLabel: {
    fontSize: scale(10),
    lineHeight: scale(14),
    color: THEME.textPrimary,
  },
  iconPreview: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

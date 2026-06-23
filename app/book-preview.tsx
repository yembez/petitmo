import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  BackHandler,
  Alert,
  Modal,
  Image,
  RefreshControl,
  InteractionManager,
  type ListRenderItem,
} from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Check, ImageIcon, Pencil, Trash2, X } from 'lucide-react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { buildBookPages, type BookPage, type PhotoFullVariant } from '@/src/book/BookEngine';
import MaquetteBookPages from '@/src/book/maquette/MaquetteBookPages';
import EditTextModal from '@/components/EditTextModal';
import { BookPreviewZoomWrap } from '@/components/BookPreviewZoomWrap';
import {
  bookPrintFrameMmFor,
  effectiveBookPhotoPrintDpi,
  BOOK_PAGE_W_MM,
  BOOK_PAGE_H_MM,
  type BookPhotoPageType,
} from '@/utils/bookPhotoPrintDpi';
import { getChildren, getOrSelectFirstChild } from '@/services/children';
import { getFamilyMemories, updateMemoryContent } from '@/services/media';
import { getLocalMemoryById, updateLocalMemoryContent } from '@/lib/localDb';
import { awaitVoiceCoverPrintDerivativeForMemory } from '@/services/memoryLocalStore';
import { loadBookSelectionKeys, memoryIdFromBookSelectionKey } from '@/services/bookSelection';
import { setPendingFavorisAddToBookId } from '@/services/favorisBookAddFlow';
import {
  applyBookCoverFromUri,
  dedupeMemoryIds,
  deleteBook,
  findBookCoverMemory,
  getBook,
  healBookCoverIfNeeded,
  healBookMemoryIdsIfWiped,
  readBookPreviewLocalSnapshotSync,
  resolveBookCoverEditorUri,
  resolveBookCoverPrintUri,
  upsertBook,
  type Book,
} from '@/services/books';
import { shareBookPdf } from '@/services/bookPdf';
import {
  generateBookPdfViaServer,
  generateBookPdfViaServerAsGuest,
  isBookPdfServerConfigured,
  isInitExportConfigured,
  PDF_EXPORT_REQUIRES_SERVER_MESSAGE,
} from '@/services/bookPdfServer';
import { BookPdfGeneratingOverlay } from '@/components/BookPdfGeneratingOverlay';
import { GuestPdfExportModal } from '@/components/GuestPdfExportModal';
import {
  parseFavoritePhotoUrls,
  mapPhotoUrlToThumb,
  getAlbumCanonicalFavoriteUrls,
  normalizeMemoryMediaUriForDisplay,
  collectBookPhotoDpiUriCandidates,
  getBookPhotoPrintPixelSize,
  getPrimaryPhotoUriForBookPreview,
  getVoiceCoverUriForBookPreview,
  getVideoPosterUriForBookPreview,
} from '@/utils/memoryPhotos';
import { runBookExportPrepInBackground } from '@/services/bookExportPrep';
import { getBookExportPrepIssues } from '@/services/bookExportPrep';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { MAX_BOOK_CAPTION_LINES, MAX_BOOK_LINES } from '@/utils/textLimits';

import type { Child, Memory } from '@/types/local';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { canExportBookPdfViaServer } from '@/lib/digitalExportPurchase';
import { setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { setPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import { supabase } from '@/lib/supabase';
import { THEME } from '@/constants/theme';

const HEADER_H = 44;
const BOTTOM_H = 82;
/** Vue verticale (Phase 1) : marge latérale ; pages collées à la reliure (trait + ombres latérales). */
const BROWSE_SIDE_PAD = 16;
/** Éditeur plein écran : marges autour de la page Gelato 21×28 (effet feuillet posé sur le fond). */
const EDITOR_PAGE_SIDE_PAD = 28;
const EDITOR_PAGE_VERT_PAD = 24;
const BROWSE_PAGE_GAP = 0;
const BROWSE_ROW_GAP = 24;
/** Largeur de la « reliure » (dégradé d’ombre) au centre d’un spread. */
const BROWSE_SPINE_W = 16;
/** Fond du viewer livre — blanc cassé charte (`THEME.bg`). */
const BROWSE_BG = THEME.bg;
const QR_BASE = 'https://petitmo.app/m';
const MIN_BOOK_SELECTION_KEYS = 5;
const MAX_BOOK_SELECTION_KEYS = 80;

/**
 * Aligné sur `bookPhotoPrintDpi` — trim Gelato 21×28 (aperçu éditeur = trim, pas fond perdu).
 * Spread paysage : deux pages → même gabarit **Gelato 21×28** (210×280 mm à l’échelle), comme un livre ouvert.
 * Page seule (couverture à droite, quatrième à gauche, dernière page impaire) : **même format** que les demi-pages
 * du double page — la maquette (couverture incluse) attend width/height au ratio 210:280, pas un cadre 210:142.
 */
function computeLandscapeSpreadLayout(
  left: PageRow | null,
  right: PageRow | null,
  availW: number,
  availH: number,
): {
  left: { width: number; height: number } | null;
  right: { width: number; height: number } | null;
  spineWidth: number;
  rowHeight: number;
} {
  const spineMargin = 6;
  const hairline = Math.max(StyleSheet.hairlineWidth, 1);
  const spineTotal = spineMargin + hairline + spineMargin;

  const trimPage = { w: BOOK_PAGE_W_MM, h: BOOK_PAGE_H_MM };

  if (!left && !right) {
    return { left: null, right: null, spineWidth: 0, rowHeight: 0 };
  }

  if (!left && right) {
    const s = Math.min(availW / trimPage.w, availH / trimPage.h);
    const rw = Math.max(1, Math.floor(s * trimPage.w));
    const rh = Math.max(1, Math.floor(s * trimPage.h));
    return { left: null, right: { width: rw, height: rh }, spineWidth: 0, rowHeight: rh };
  }

  if (left && !right) {
    const s = Math.min(availW / trimPage.w, availH / trimPage.h);
    const lw = Math.max(1, Math.floor(s * trimPage.w));
    const lh = Math.max(1, Math.floor(s * trimPage.h));
    return { left: { width: lw, height: lh }, right: null, spineWidth: 0, rowHeight: lh };
  }

  const s = Math.min((availW - spineTotal) / (trimPage.w * 2), availH / trimPage.h);
  const pw = Math.max(1, Math.floor(s * trimPage.w));
  const ph = Math.max(1, Math.floor(s * trimPage.h));
  return {
    left: { width: pw, height: ph },
    right: { width: pw, height: ph },
    spineWidth: spineTotal,
    rowHeight: ph,
  };
}

type PageRow = { page: BookPage; pageNum: number };

type SpreadRow = {
  kind: 'spread';
  spreadIndex: number;
  left: PageRow | null;
  right: PageRow | null;
};

type TextEditTarget =
  | { kind: 'cover'; modalTitle: string }
  | { kind: 'chapter'; modalTitle: string }
  | { kind: 'memory'; memory: Memory; modalTitle: string };


const EMPTY_MEMORY_EDITS: Record<string, Partial<Memory>> = {};

function monthNameFrLower(d: Date): string {
  const raw = d.toLocaleDateString('fr-FR', { month: 'long' });
  return raw.replace(/^\w/u, c => c.toLocaleLowerCase('fr-FR'));
}

/** Première lettre du libellé en majuscule (ex. février → Février). */
function capitalizeFirstLetterFr(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[a-zA-ZÀ-ÿ]/u.test(c)) {
      return s.slice(0, i) + c.toLocaleUpperCase('fr-FR') + s.slice(i + 1);
    }
  }
  return s;
}

/**
 * Sous-titre de couverture : du premier au dernier mois des souvenirs du livre.
 * Même année : « Janvier – mars 2026 » · années différentes : « Décembre 2025 – mars 2026 ».
 */
function coverJournalPeriodLabel(memories: Memory[]): string {
  if (memories.length === 0) {
    const d = new Date();
    const line = `${monthNameFrLower(d)} ${d.getFullYear()}`;
    return capitalizeFirstLetterFr(line);
  }

  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const d0 = new Date(sorted[0].created_at);
  const d1 = new Date(sorted[sorted.length - 1].created_at);

  const m0 = d0.getMonth();
  const y0 = d0.getFullYear();
  const m1 = d1.getMonth();
  const y1 = d1.getFullYear();

  const label0 = monthNameFrLower(d0);
  const label1 = monthNameFrLower(d1);

  let line: string;
  if (y0 === y1) {
    if (m0 === m1) {
      line = `${label0} ${y0}`;
    } else {
      line = `${label0} – ${label1} ${y1}`;
    }
  } else {
    line = `${label0} ${y0} – ${label1} ${y1}`;
  }
  return capitalizeFirstLetterFr(line);
}

function memoryForMaquette(
  page: BookPage,
  merge: (m: Memory) => Memory
): Memory | null {
  switch (page.type) {
    case 'cover':
    case 'chapter':
    case 'back-cover':
      return null;
    case 'photo-full':
    case 'photo-note':
    case 'quote':
    case 'audio':
    case 'video':
      return merge(page.memory);
    default: {
      const _e: never = page;
      return _e;
    }
  }
}

/** URI image principale d’une page livre (prefetch avant ouverture de l’éditeur). */
function bookPageMainImageUri(
  row: PageRow,
  merge: (m: Memory) => Memory,
  coverPhotoDisplayUri: string | null,
): string | null {
  const { page } = row;
  if (page.type === 'cover') {
    const u = coverPhotoDisplayUri?.trim();
    return u || null;
  }
  const m = memoryForMaquette(page, merge);
  if (!m) return null;
  if (page.type === 'photo-full' || page.type === 'photo-note') {
    return getPrimaryPhotoUriForBookPreview(m).trim() || null;
  }
  if (page.type === 'audio') return getVoiceCoverUriForBookPreview(m).trim() || null;
  if (page.type === 'video') return getVideoPosterUriForBookPreview(m).trim() || null;
  return null;
}

function prefetchBookPageImage(uri: string | null): void {
  if (!uri) return;
  void ExpoImage.prefetch(uri, 'memory-disk').catch(() => {});
}

function pageLabel(current: number, total: number): string {
  return `Page ${current} · ${total} pages`;
}

export default function BookPreviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookId?: string }>();
  const bookId = typeof params.bookId === 'string' ? params.bookId : undefined;
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm500 = fontsLoaded ? 'DMSans_500Medium' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dm700 = fontsLoaded ? 'DMSans_700Bold' : undefined;

  const localSnapshotRef = useRef(
    bookId ? readBookPreviewLocalSnapshotSync(bookId) : null,
  );
  const localSnapshot = localSnapshotRef.current;
  const hadLocalSnapshotRef = useRef(localSnapshot != null);

  const [child, setChild] = useState<Child | null>(localSnapshot?.child ?? null);
  const [familyChildren, setFamilyChildren] = useState<Child[]>(
    localSnapshot?.familyChildren ?? [],
  );
  const [bookMemories, setBookMemories] = useState<Memory[]>(localSnapshot?.bookMemories ?? []);
  const [bookSelectionKeys, setBookSelectionKeys] = useState<string[]>(
    localSnapshot?.bookSelectionKeys ?? [],
  );
  const [loading, setLoading] = useState(!localSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [rotations, setRotations] = useState<Record<string, number>>(
    localSnapshot?.book.rotations ?? {},
  );
  const [photoCrops, setPhotoCrops] = useState<
    Record<string, { xPct: number; yPct: number; scale: number }>
  >(localSnapshot?.book.photoCrops ?? {});
  const [imagePxCache, setImagePxCache] = useState<Record<string, { w: number; h: number }>>({});
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  /** Éditeur plein écran (Phase 1) : ouvert au tap sur une page de la vue verticale. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPageIndex, setEditorPageIndex] = useState(0);
  /** Titre principal de la couverture (ligne complète, ex. « Journal de … »). */
  const [coverTitleLine, setCoverTitleLine] = useState<string | null>(
    localSnapshot?.book.title ?? null,
  );
  const [bookSnapshot, setBookSnapshot] = useState<Book | null>(localSnapshot?.book ?? null);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(
    localSnapshot ? resolveBookCoverEditorUri(localSnapshot.book) : null,
  );
  /** Texte des pages chapitre (éditable). */
  const [chapterTitleLine, setChapterTitleLine] = useState<string | null>(
    localSnapshot?.book.chapterTitle ?? null,
  );
  const [textEditTarget, setTextEditTarget] = useState<TextEditTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [allMemories, setAllMemories] = useState<Memory[]>([]);
  const [guestExportModalVisible, setGuestExportModalVisible] = useState(false);
  const [guestExportSubmitting, setGuestExportSubmitting] = useState(false);
  const pendingGuestExportMode = useRef<'screen' | 'print'>('screen');
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  /** Depuis un tap en mode spread (paysage) : ouvre l’éditeur puis la modale texte sur la page tapée. */
  const [pendingTextEditPageIndex, setPendingTextEditPageIndex] = useState<number | null>(null);
  const [cropDpiMetaByKey, setCropDpiMetaByKey] = useState<
    Record<
      string,
      {
        imgPxW: number;
        imgPxH: number;
        dpiPxW: number;
        dpiPxH: number;
        printMmW: number;
        printMmH: number;
        sourceUri?: string;
      }
    >
  >({});

  const listRef = useRef<FlatList<any>>(null);
  const editorListRef = useRef<FlatList<any>>(null);
  const editorOpenRef = useRef(false);
  const coverPickerOpenRef = useRef(false);

  const openTextEditForPage = useCallback((page: BookPage, m: Memory | null) => {
    if (!page) return;
    switch (page.type) {
      case 'cover':
        setTextEditTarget({ kind: 'cover', modalTitle: 'Titre du livre' });
        return;
      case 'chapter':
        setTextEditTarget({ kind: 'chapter', modalTitle: 'Titre des chapitres' });
        return;
      case 'photo-full':
      case 'quote':
      case 'audio':
      case 'photo-note':
      case 'video':
        if (!m) return;
        setTextEditTarget({ kind: 'memory', memory: m, modalTitle: 'Modifier le texte' });
        return;
      default:
        return;
    }
  }, []);

  const pages = useMemo(() => {
    if (!child) return [];
    return buildBookPages(child, bookMemories);
  }, [child, bookMemories]);

  // Préparation best-effort en fond: pousse les médias nécessaires + déclenche les dérivés pour l’export serveur.
  const exportPrepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isBookPdfServerConfigured()) return;
    if (!child || pages.length === 0) return;
    if (exportPrepTimerRef.current) clearTimeout(exportPrepTimerRef.current);
    exportPrepTimerRef.current = setTimeout(() => {
      void runBookExportPrepInBackground({ pages, localEdits: EMPTY_MEMORY_EDITS });
    }, 2500);
    return () => {
      if (exportPrepTimerRef.current) clearTimeout(exportPrepTimerRef.current);
    };
  }, [child, pages]);

  const pageRows = useMemo(
    () => pages.map((page, i) => ({ page, pageNum: i + 1 })),
    [pages]
  );

  const isLandscape = screenWidth > screenHeight;

  /**
   * Paysage: aperçu en doubles-pages (spreads) pour visualiser les voisinages.
   * Étape A (safe): pas d’actions d’édition en paysage (sinon ambigu: page gauche ou droite ?).
   *
   * Règles:
   * - Couverture seule à droite (gauche vide)
   * - Quatrième de couverture seule à gauche (droite vide)
   * - Entre les deux: paires (2–3), (4–5), etc. (gauche=page paire, droite=page impaire suivante)
   */
  const spreadRows = useMemo<SpreadRow[]>(() => {
    if (pageRows.length === 0) return [];

    const out: SpreadRow[] = [];
    const last = pageRows[pageRows.length - 1]!;
    const hasBackCover = last.page.type === 'back-cover';
    const backCover = hasBackCover ? last : null;

    // Cover (page 1) seule à droite
    out.push({ kind: 'spread', spreadIndex: 0, left: null, right: pageRows[0] ?? null });

    // Paires au milieu, sans inclure la quatrième de couverture.
    const endExclusive = hasBackCover ? pageRows.length - 1 : pageRows.length;
    let i = 1;
    while (i + 1 < endExclusive) {
      out.push({
        kind: 'spread',
        spreadIndex: out.length,
        left: pageRows[i] ?? null,
        right: pageRows[i + 1] ?? null,
      });
      i += 2;
    }
    if (i < endExclusive) {
      out.push({
        kind: 'spread',
        spreadIndex: out.length,
        left: pageRows[i] ?? null,
        right: null,
      });
    }

    // Quatrième de couverture seule à gauche
    if (backCover) {
      out.push({
        kind: 'spread',
        spreadIndex: out.length,
        left: backCover,
        right: null,
      });
    }

    return out;
  }, [pageRows]);

  const totalSlides = isLandscape ? spreadRows.length : pageRows.length;

  // En cas de rotation / changement de data, borner l’index courant.
  useEffect(() => {
    if (totalSlides <= 0) return;
    setCurrentPageIndex(prev => (prev >= totalSlides ? totalSlides - 1 : prev));
  }, [totalSlides]);

  const coverYearLabel = useMemo(() => coverJournalPeriodLabel(bookMemories), [bookMemories]);

  /** Portrait : header + barre d’actions. Paysage : lecture seule — toute la hauteur sous le header. */
  const availHPortrait =
    screenHeight - HEADER_H - BOTTOM_H - insets.top - insets.bottom;
  const availHLandscape = screenHeight - HEADER_H - insets.top - insets.bottom;

  /**
   * Page éditeur au **ratio Gelato 21×28 (210:280)**, légèrement réduite avec marges latérales —
   * même logique de fit que le spread, pour parité recadrage / bandeau couverture.
   */
  const editorPage = useMemo(() => {
    const availW = screenWidth - EDITOR_PAGE_SIDE_PAD * 2;
    const availH = availHPortrait - EDITOR_PAGE_VERT_PAD * 2;
    const s = Math.min(availW / BOOK_PAGE_W_MM, availH / BOOK_PAGE_H_MM);
    return {
      w: Math.max(1, Math.floor(s * BOOK_PAGE_W_MM)),
      h: Math.max(1, Math.floor(s * BOOK_PAGE_H_MM)),
    };
  }, [availHPortrait, screenWidth]);

  /**
   * Vue verticale (Phase 1, style Google Photos) : couverture seule en tête,
   * puis doubles-pages côte à côte avec un petit espace. Pages au ratio Gelato 210:280.
   */
  const browseLeaf = useMemo(() => {
    const availW = screenWidth - BROWSE_SIDE_PAD * 2;
    const pageW = Math.max(1, Math.floor((availW - BROWSE_PAGE_GAP) / 2));
    const pageH = Math.max(1, Math.round((pageW * BOOK_PAGE_H_MM) / BOOK_PAGE_W_MM));
    return { pageW, pageH };
  }, [screenWidth]);

  const signedCoverPhotoUrl = useSignedMediaUrl(coverPhotoUrl);
  const coverPhotoDisplayUriRaw = (signedCoverPhotoUrl ?? coverPhotoUrl ?? null)?.trim()
    ? (signedCoverPhotoUrl ?? coverPhotoUrl ?? null)
    : null;
  const coverPhotoDisplayUri = coverPhotoDisplayUriRaw
    ? normalizeMemoryMediaUriForDisplay(coverPhotoDisplayUriRaw)
    : null;

  const coverPhotoPrintUri = useMemo(
    () => (bookSnapshot ? resolveBookCoverPrintUri(bookSnapshot) : null),
    [bookSnapshot]
  );

  /** Éditeur : display pour le recadrage ; on évite `book_covers/` (copie parfois basse résolution). */
  const coverPhotoEditorRenderUri = useMemo(() => {
    const print = coverPhotoPrintUri?.trim();
    if (print && !print.includes('petitmo_memories/book_covers/')) {
      return normalizeMemoryMediaUriForDisplay(print);
    }
    return coverPhotoDisplayUri;
  }, [coverPhotoPrintUri, coverPhotoDisplayUri]);

  /** Dimensions fichier couverture pour recadrage PDF (`coverMode` = parité aperçu). */
  const coverPhotoImgPxForPdf = useMemo(() => {
    const meta = cropDpiMetaByKey.cover;
    if (meta?.imgPxW && meta?.imgPxH) {
      return { w: meta.imgPxW, h: meta.imgPxH };
    }
    const coverMem = bookSnapshot ? findBookCoverMemory(bookSnapshot) : null;
    if (!coverMem) return undefined;
    return getBookPhotoPrintPixelSize(coverMem, bookSnapshot?.coverPhotoUrl ?? undefined) ?? undefined;
  }, [cropDpiMetaByKey.cover, bookSnapshot]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const childId = await getOrSelectFirstChild();
      if (!childId) {
        setError('Aucun enfant sélectionné');
        setChild(null);
        setFamilyChildren([]);
        setBookMemories([]);
        setBookSelectionKeys([]);
        return;
      }
      const children = await getChildren();
      setFamilyChildren(sortChildrenByBirthdateAsc(children));
      const ch = children.find(c => c.id === childId) ?? null;
      if (!ch) {
        setError('Profil enfant introuvable');
        setChild(null);
        setFamilyChildren([]);
        setBookMemories([]);
        setBookSelectionKeys([]);
        return;
      }
      setChild(ch);

      let memoryIds: Set<string>;
      let bookForHeal: Book | null = null;
      if (bookId) {
        let b = await getBook(bookId);
        if (!b) {
          setError('Livre introuvable');
          setBookMemories([]);
          setBookSelectionKeys([]);
          return;
        }
        b = await healBookMemoryIdsIfWiped(b);
        if (b.textEdits && Object.keys(b.textEdits).length > 0) {
          for (const [id, e] of Object.entries(b.textEdits)) {
            if (e.content !== undefined) {
              updateLocalMemoryContent(id, e.content ?? '');
            }
          }
          b = { ...b, textEdits: undefined };
          await upsertBook(b);
        }
        setBookSnapshot(b);
        bookForHeal = b;
        setCropDpiMetaByKey(prev => {
          if (!prev.cover) return prev;
          const { cover: _c, ...rest } = prev;
          return rest;
        });
        setCoverTitleLine(b.title);
        setCoverPhotoUrl(resolveBookCoverEditorUri(b));
        if (b.rotations) setRotations(b.rotations);
        if (b.photoCrops) setPhotoCrops(b.photoCrops);
        if (b.chapterTitle) setChapterTitleLine(b.chapterTitle);
        memoryIds = new Set(b.memoryIds);
        setBookSelectionKeys(b.memoryIds);
      } else {
        const keys = await loadBookSelectionKeys();
        setBookSelectionKeys(keys);
        memoryIds = new Set(keys.map(memoryIdFromBookSelectionKey));
      }

      const picked: Memory[] = [];
      for (const id of memoryIds) {
        const row = getLocalMemoryById(id);
        if (row) picked.push(row as Memory);
      }
      picked.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      setBookMemories(picked);

      if (bookForHeal) {
        const snapshotId = bookForHeal.id;
        InteractionManager.runAfterInteractions(() => {
          void (async () => {
            const healed = await healBookCoverIfNeeded(bookForHeal!);
            if (healed.id !== snapshotId) return;
            setBookSnapshot(prev => (prev?.id === snapshotId ? healed : prev));
            setCoverPhotoUrl(resolveBookCoverEditorUri(healed));
          })();
        });
      }

      InteractionManager.runAfterInteractions(() => {
        void getFamilyMemories().then(all => setAllMemories(all as Memory[]));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  const refreshBookMemoriesFromDb = useCallback(async () => {
    if (!bookId) return;
    const b = await getBook(bookId);
    if (!b) return;
    const ids = dedupeMemoryIds(b.memoryIds ?? []);
    const picked: Memory[] = [];
    for (const id of ids) {
      const row = getLocalMemoryById(id);
      if (row) picked.push(row as Memory);
    }
    picked.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    setBookMemories(picked);
    setBookSelectionKeys(ids);
  }, [bookId]);

  const bookScreenWasBlurredRef = useRef(false);
  const voiceCoverPrintBackfillRef = useRef(new Set<string>());
  useEffect(() => {
    void load({ silent: hadLocalSnapshotRef.current });
  }, [load]);

  /** Souvenirs audio existants : génère `voice_cover_print.jpg` (2600px) pour le badge DPI livre. */
  useEffect(() => {
    for (const m of bookMemories) {
      if (m.type !== 'voice' || !(m.voice_cover_path ?? m.voice_cover_url ?? '').trim()) continue;
      if ((m.local_print_path ?? '').trim() && m.print_px_w && m.print_px_h) continue;
      if (voiceCoverPrintBackfillRef.current.has(m.id)) continue;
      voiceCoverPrintBackfillRef.current.add(m.id);
      void awaitVoiceCoverPrintDerivativeForMemory(m.id).then(updated => {
        if (!updated?.local_print_path) return;
        setBookMemories(prev => prev.map(x => (x.id === updated.id ? updated : x)));
        setCropDpiMetaByKey(prev => {
          const { [updated.id]: _drop, ...rest } = prev;
          return rest;
        });
      });
    }
  }, [bookMemories]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        bookScreenWasBlurredRef.current = true;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!bookId || !bookScreenWasBlurredRef.current) return;
      void refreshBookMemoriesFromDb();
    }, [bookId, refreshBookMemoriesFromDb])
  );

  // Auto-save customizations to AsyncStorage when they change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bookId || loading) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void (async () => {
        const b = await getBook(bookId);
        if (!b) return;
        const hasRotations = Object.keys(rotations).some(k => rotations[k] !== 0);
        const hasCrops = Object.keys(photoCrops).length > 0;
        const persistedIds = dedupeMemoryIds(b.memoryIds ?? []);
        const resolvedIds = dedupeMemoryIds(bookMemories.map(m => m.id));
        await upsertBook({
          ...b,
          memoryIds: resolvedIds.length > 0 ? resolvedIds : persistedIds,
          rotations: hasRotations ? rotations : undefined,
          photoCrops: hasCrops ? photoCrops : undefined,
          textEdits: undefined,
          chapterTitle: chapterTitleLine ?? undefined,
        });
      })();
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [bookId, loading, rotations, photoCrops, chapterTitleLine, bookMemories]);

  const upsertPhotoCrop = useCallback(
    (key: string, next: { xPct: number; yPct: number; scale: number }) => {
      setPhotoCrops(prev => ({ ...prev, [key]: next }));
    },
    []
  );

  const getImagePx = useCallback(
    async (uri: string): Promise<{ w: number; h: number }> => {
      const key = uri.trim();
      if (!key) throw new Error('URI image vide');
      const cached = imagePxCache[key];
      if (cached && cached.w > 0 && cached.h > 0) return cached;

      const fromRn = await new Promise<{ w: number; h: number } | null>(resolve => {
        Image.getSize(
          key,
          (w, h) => {
            if (w > 0 && h > 0) resolve({ w, h });
            else resolve(null);
          },
          () => resolve(null)
        );
      });
      if (fromRn) {
        setImagePxCache(prev => ({ ...prev, [key]: fromRn }));
        return fromRn;
      }

      // `Image.getSize` échoue souvent sur certaines URL signées / chemins sandbox — expo-image-manipulator décode et expose les pixels.
      const decoded = await ImageManipulator.manipulateAsync(key, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const w = decoded.width;
      const h = decoded.height;
      if (!(w > 0 && h > 0)) throw new Error('Dimensions image introuvables');
      const size = { w, h };
      setImagePxCache(prev => ({ ...prev, [key]: size }));
      return size;
    },
    [imagePxCache]
  );

  const resolveCropDpiMeta = useCallback(
    async (payload: {
      storageKey: string;
      uri: string;
      pageType: BookPhotoPageType;
      photoFullVariant?: PhotoFullVariant;
    }): Promise<{
      imgPxW: number;
      imgPxH: number;
      dpiPxW: number;
      dpiPxH: number;
      printMmW: number;
      printMmH: number;
      sourceUri?: string;
    }> => {
      const mm = bookPrintFrameMmFor(payload.pageType, payload.photoFullVariant);
      const finish = (display: { w: number; h: number }, dpi: { w: number; h: number }) => ({
        imgPxW: display.w,
        imgPxH: display.h,
        dpiPxW: dpi.w,
        dpiPxH: dpi.h,
        printMmW: mm.w,
        printMmH: mm.h,
        sourceUri: payload.uri,
      });

      const memoryForPayload = (): Memory | null => {
        const id = payload.storageKey.trim();
        if (id && id !== 'cover') {
          return bookMemories.find(m => m.id === id) ?? null;
        }
        if (payload.pageType === 'cover' && bookSnapshot) {
          return findBookCoverMemory(bookSnapshot);
        }
        return null;
      };

      let displayW = 0;
      let displayH = 0;
      try {
        const px = await getImagePx(payload.uri);
        displayW = px.w;
        displayH = px.h;
      } catch {
        const mem = memoryForPayload();
        const ow = mem?.original_px_w;
        const oh = mem?.original_px_h;
        if (typeof ow === 'number' && typeof oh === 'number' && ow > 0 && oh > 0) {
          displayW = ow;
          displayH = oh;
        }
      }

      const coverRef =
        payload.pageType === 'cover' && bookSnapshot
          ? (bookSnapshot.coverPhotoUrl ?? '').trim()
          : undefined;
      const mem = memoryForPayload();

      const bookPrintUri =
        payload.pageType === 'cover' && bookSnapshot
          ? resolveBookCoverPrintUri(bookSnapshot)
          : null;
      const dpiUriCandidates = collectBookPhotoDpiUriCandidates({
        memory: mem,
        photoRef: coverRef,
        displayUri: payload.uri,
        bookPrintUri,
      });

      let dpiW = 0;
      let dpiH = 0;
      let bestDpiArea = 0;
      const considerDpiPx = (w: number, h: number) => {
        if (!(w > 0 && h > 0)) return;
        const area = w * h;
        if (area > bestDpiArea) {
          dpiW = w;
          dpiH = h;
          bestDpiArea = area;
        }
      };

      if (mem) {
        const printPx = getBookPhotoPrintPixelSize(mem, coverRef);
        if (printPx) considerDpiPx(printPx.w, printPx.h);
        if (typeof mem.print_px_w === 'number' && typeof mem.print_px_h === 'number') {
          considerDpiPx(mem.print_px_w, mem.print_px_h);
        }
        if (typeof mem.original_px_w === 'number' && typeof mem.original_px_h === 'number') {
          considerDpiPx(mem.original_px_w, mem.original_px_h);
        }
      }

      for (const printUri of dpiUriCandidates) {
        try {
          const px = await getImagePx(printUri);
          considerDpiPx(px.w, px.h);
        } catch {
          /* essai suivant */
        }
      }

      if (!(dpiW > 0 && dpiH > 0)) {
        dpiW = displayW;
        dpiH = displayH;
      }

      return finish({ w: displayW, h: displayH }, { w: dpiW, h: dpiH });
    },
    [bookMemories, bookSnapshot, getImagePx]
  );

  const prefetchCropDpiMeta = useCallback(
    (payload: {
      storageKey: string;
      uri: string;
      pageType: BookPhotoPageType;
      photoFullVariant?: PhotoFullVariant;
    }) => {
      void (async () => {
        let alreadyCached = false;
        setCropDpiMetaByKey(prev => {
          const cur = prev[payload.storageKey];
          if (cur?.imgPxW > 0 && cur?.sourceUri === payload.uri) {
            const dpiLooksDisplayOnly =
              cur.dpiPxW > 0 &&
              cur.imgPxW > 0 &&
              cur.dpiPxW <= cur.imgPxW;
            if (!(payload.pageType === 'cover' && dpiLooksDisplayOnly)) alreadyCached = true;
          }
          return prev;
        });
        if (alreadyCached) return;
        const meta = await resolveCropDpiMeta(payload);
        setCropDpiMetaByKey(prev => {
          const cur = prev[payload.storageKey];
          if (cur?.imgPxW > 0 && cur?.sourceUri === payload.uri) {
            const dpiStale =
              payload.pageType === 'cover' &&
              meta.dpiPxW > 0 &&
              cur.dpiPxW > 0 &&
              meta.dpiPxW > cur.dpiPxW;
            if (!dpiStale) return prev;
          }
          return { ...prev, [payload.storageKey]: meta };
        });
      })();
    },
    [resolveCropDpiMeta]
  );

  useEffect(() => {
    const uri = coverPhotoDisplayUri?.trim();
    if (!uri) return;
    prefetchCropDpiMeta({ storageKey: 'cover', uri, pageType: 'cover' });
  }, [coverPhotoDisplayUri, coverPhotoPrintUri, prefetchCropDpiMeta]);

  const unlockOrientationPortrait = useCallback(() => {
    void (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        /* */
      }
    })();
  }, []);

  const unlockAndBack = useCallback(() => {
    unlockOrientationPortrait();
    /** `back()` = pop stack : l’écran précédent (ex. Livres) glisse depuis la gauche. */
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/livres');
  }, [router, unlockOrientationPortrait]);

  const unlockAndGoToFavoris = useCallback(() => {
    unlockOrientationPortrait();
    router.replace('/(tabs)/favoris');
  }, [router, unlockOrientationPortrait]);

  const confirmDeleteBookAndBack = useCallback(() => {
    if (!bookId) return;
    Alert.alert('Supprimer ce livre ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void deleteBook(bookId);
          unlockAndBack();
        },
      },
    ]);
  }, [bookId, unlockAndBack]);

  const unlockAndGoToFavorisForAdd = useCallback(() => {
    unlockOrientationPortrait();
    if (bookId) {
      setPendingFavorisAddToBookId(bookId);
      router.replace({
        pathname: '/(tabs)/favoris',
        params: { addToBookId: bookId },
      });
      return;
    }
    unlockAndGoToFavoris();
  }, [bookId, router, unlockAndGoToFavoris, unlockOrientationPortrait]);

  const openEditor = useCallback((pageIndex: number) => {
    const safe = Math.max(0, Math.min(pageIndex, Math.max(0, pageRows.length - 1)));
    setEditorPageIndex(safe);
    setCurrentPageIndex(safe);
    setEditorOpen(true);
  }, [pageRows.length]);

  const closeEditor = useCallback(() => {
    setCoverPickerOpen(false);
    setTextEditTarget(null);
    setEditorOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!editorOpen) return;
    editorListRef.current?.scrollToOffset({
      offset: screenWidth * editorPageIndex,
      animated: false,
    });
  }, [editorOpen, editorPageIndex, screenWidth]);

  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);

  useEffect(() => {
    coverPickerOpenRef.current = coverPickerOpen;
  }, [coverPickerOpen]);

  const openCoverPicker = useCallback(() => {
    setCoverPickerOpen(true);
  }, []);

  const closeCoverPicker = useCallback(() => {
    setCoverPickerOpen(false);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editorOpenRef.current) {
        if (coverPickerOpenRef.current) {
          setCoverPickerOpen(false);
          return true;
        }
        setCoverPickerOpen(false);
        setTextEditTarget(null);
        setEditorOpen(false);
        return true;
      }
      unlockAndBack();
      return true;
    });
    return () => sub.remove();
  }, [unlockAndBack]);

  const merge = useCallback((m: Memory) => m, []);

  const onRotateMemory = useCallback((memoryId: string) => {
    setRotations(prev => ({
      ...prev,
      [memoryId]: ((prev[memoryId] ?? 0) + 90) % 360,
    }));
  }, []);

  /**
   * Index barre du bas / actions : uniquement après fin de snap natif.
   * `onViewableItemsChanged` déclenchait encore un setState pendant l’animation de paging → à-coup.
   */
  const onBookPagerMomentumEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const slideCount = editorOpenRef.current
        ? pageRows.length
        : isLandscape
          ? spreadRows.length
          : pageRows.length;
      if (slideCount <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const ix = Math.max(0, Math.min(Math.round(x / screenWidth), slideCount - 1));
      setCurrentPageIndex(prev => (prev === ix ? prev : ix));
      if (editorOpenRef.current) {
        setEditorPageIndex(prev => (prev === ix ? prev : ix));
      }
    },
    [isLandscape, pageRows.length, screenWidth, spreadRows.length]
  );

  useEffect(() => {
    if (!editorOpen) return;
    if (pendingTextEditPageIndex == null) return;
    const ix = Math.max(0, Math.min(pendingTextEditPageIndex, Math.max(0, pageRows.length - 1)));
    const row = pageRows[ix];
    if (!row) {
      setPendingTextEditPageIndex(null);
      return;
    }
    setEditorPageIndex(ix);
    setCurrentPageIndex(ix);
    requestAnimationFrame(() => {
      const m = memoryForMaquette(row.page, merge);
      openTextEditForPage(row.page, m ?? null);
      setPendingTextEditPageIndex(null);
    });
  }, [editorOpen, merge, openTextEditForPage, pageRows, pendingTextEditPageIndex]);

  const cropDpiPayloadForPageRow = useCallback(
    (row: PageRow) => {
      const { page } = row;
      if (page.type === 'cover') {
        const uri = (coverPhotoDisplayUri ?? '').trim();
        if (!uri) return null;
        return { storageKey: 'cover', uri, pageType: 'cover' as const };
      }
      const m = memoryForMaquette(page, merge);
      if (!m) return null;
      if (page.type === 'photo-full' || page.type === 'photo-note') {
        const uri = getPrimaryPhotoUriForBookPreview(m).trim();
        if (!uri) return null;
        return {
          storageKey: m.id,
          uri,
          pageType: page.type,
          ...(page.type === 'photo-full' ? { photoFullVariant: page.variant } : {}),
        };
      }
      if (page.type === 'audio') {
        const uri = getVoiceCoverUriForBookPreview(m).trim();
        if (!uri) return null;
        return { storageKey: m.id, uri, pageType: 'audio' as const };
      }
      return null;
    },
    [coverPhotoDisplayUri, merge]
  );

  useEffect(() => {
    if (!editorOpen) return;
    const row = pageRows[editorPageIndex];
    if (!row) return;
    const payload = cropDpiPayloadForPageRow(row);
    if (payload) prefetchCropDpiMeta(payload);
  }, [cropDpiPayloadForPageRow, editorOpen, editorPageIndex, pageRows, prefetchCropDpiMeta]);

  const renderMaquettePage = useCallback(
    (row: PageRow): ReactElement => {
      const { page, pageNum } = row;
      const m = memoryForMaquette(page, merge);
      const rot = m ? rotations[m.id] ?? 0 : 0;
      const qrUrl = m ? `${QR_BASE}/${m.id}` : '';

      const coverDisplayTitle = coverTitleLine ?? `Journal de ${child!.name}`;

      return (
        <MaquetteBookPages
          page={page}
          pageNum={pageNum}
          width={editorPage.w}
          height={editorPage.h}
          child={child!}
          familyChildren={familyChildren}
          memory={m}
          rotation={rot}
          photoCrop={
            page.type === 'photo-full' || page.type === 'photo-note' || page.type === 'audio'
              ? photoCrops[m?.id ?? '']
              : undefined
          }
          truncated={false}
          coverYearLabel={coverYearLabel}
          coverDisplayTitle={page.type === 'cover' ? coverDisplayTitle : undefined}
          coverPhotoUri={page.type === 'cover' ? coverPhotoEditorRenderUri : null}
          coverPhotoCrop={photoCrops.cover}
          coverPhotoImgPxW={page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxW : undefined}
          coverPhotoImgPxH={page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxH : undefined}
          onRequestCoverPhoto={page.type === 'cover' ? openCoverPicker : undefined}
          inlineCropConfig={{
            dpiMetaByKey: cropDpiMetaByKey,
            onChange: (key, crop) => upsertPhotoCrop(key, crop),
          }}
          chapterDisplayTitle={page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
          onRotate={() => {
            if (m && (page.type === 'photo-full' || page.type === 'photo-note' || page.type === 'audio')) {
              onRotateMemory(m.id);
            }
          }}
          onRequestTextEdit={() => openTextEditForPage(page, m ?? null)}
          qrUrl={qrUrl}
        />
      );
    },
    [
      editorPage,
      child,
      coverPhotoEditorRenderUri,
      coverTitleLine,
      coverYearLabel,
      chapterTitleLine,
      cropDpiMetaByKey,
      merge,
      onRotateMemory,
      photoCrops,
      rotations,
      openCoverPicker,
      openTextEditForPage,
      upsertPhotoCrop,
    ]
  );

  const favoriteCoverThumbs = useMemo(() => {
    const out: { thumb: string; source: string }[] = [];
    const seen = new Set<string>();
    for (const m of allMemories) {
      if (m.type !== 'photo') continue;
      const favUrls = parseFavoritePhotoUrls(m);
      const allUrls =
        favUrls.length > 0 ? favUrls : m.is_favorite ? getAlbumCanonicalFavoriteUrls(m) : [];
      for (const u of allUrls) {
        const source = u.trim();
        if (!source) continue;
        const mapped = normalizeMemoryMediaUriForDisplay(mapPhotoUrlToThumb(m, source));
        if (!mapped) continue;
        // On déduplique par URL favorite canonique (pas par thumb affiché).
        const dedupeKey = source;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({ thumb: mapped, source });
      }
    }
    return out;
  }, [allMemories]);

  const pickCover = useCallback(
    async (uri: string) => {
      const trimmed = uri.trim();
      setCoverPickerOpen(false);
      if (!trimmed) {
        setCoverPhotoUrl(null);
        if (!bookId) return;
        const b = await getBook(bookId);
        if (!b) return;
        await upsertBook({ ...b, coverPhotoUrl: null });
        setBookSnapshot({ ...b, coverPhotoUrl: null });
        return;
      }
      if (!bookId) {
        const printOnly = normalizeMemoryMediaUriForDisplay(trimmed) || trimmed;
        setCoverPhotoUrl(printOnly);
        return;
      }
      if (!child?.id) {
        Alert.alert('Petitmo', 'Profil enfant introuvable.');
        return;
      }
      try {
        await applyBookCoverFromUri({
          bookId,
          childId: child.id,
          pickUri: trimmed,
        });
        setCropDpiMetaByKey(prev => {
          if (!prev.cover) return prev;
          const { cover: _c, ...rest } = prev;
          return rest;
        });
        await load();
        const fresh = await getBook(bookId);
        if (fresh) {
          const editorUri = resolveBookCoverEditorUri(fresh);
          if (editorUri) {
            prefetchCropDpiMeta({ storageKey: 'cover', uri: editorUri, pageType: 'cover' });
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message === 'LIMIT_REACHED') {
          Alert.alert(
            'Limite atteinte',
            'Vous avez atteint le nombre maximum de souvenirs gratuits. Passez à Petitmo+ pour continuer.',
          );
          return;
        }
        Alert.alert('Petitmo', e instanceof Error ? e.message : 'Impossible de changer la couverture.');
      }
    },
    [bookId, child?.id, load, prefetchCropDpiMeta]
  );

  const pickCoverFromGallery = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Accès refusé',
          'Autorisez l’accès à vos photos dans les réglages pour choisir une image de couverture.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri?.trim()) return;
      await pickCover(result.assets[0].uri.trim());
    } catch {
      Alert.alert('Erreur', 'Impossible d’ouvrir la galerie photos.');
    }
  }, [pickCover]);

  const renderPageItem: ListRenderItem<PageRow> = useCallback(
    ({ item, index }) => (
      <View
        style={[
          styles.pageSlide,
          { width: screenWidth, height: availHPortrait },
        ]}
      >
        <BookPreviewZoomWrap
          width={screenWidth}
          height={availHPortrait}
          isPagerActive={index === editorPageIndex}
          allowOverflow
        >
          <View style={[styles.editorZoomInner, { width: screenWidth, height: availHPortrait }]}>
            <View style={[styles.editorPageShadow, { width: editorPage.w, height: editorPage.h }]}>
              <View style={[styles.editorPageCard, { width: editorPage.w, height: editorPage.h }]}>
                {renderMaquettePage(item)}
              </View>
            </View>
          </View>
        </BookPreviewZoomWrap>
      </View>
    ),
    [editorPageIndex, editorPage, renderMaquettePage, screenWidth, availHPortrait]
  );

  const renderSpreadItem: ListRenderItem<SpreadRow> = useCallback(
    ({ item, index }) => {
      const left = item.left;
      const right = item.right;
      const layout = computeLandscapeSpreadLayout(left, right, screenWidth, availHLandscape);

      const leftMem = left ? memoryForMaquette(left.page, merge) : null;
      const rightMem = right ? memoryForMaquette(right.page, merge) : null;
      const qrUrlLeft = leftMem ? `${QR_BASE}/${leftMem.id}` : '';
      const qrUrlRight = rightMem ? `${QR_BASE}/${rightMem.id}` : '';

      const renderSpreadMaquette = (
        row: PageRow,
        dims: { width: number; height: number },
        qrUrl: string,
      ) => {
        const mem = memoryForMaquette(row.page, merge);
        return (
          <View style={[styles.spreadPageCenter, { width: dims.width, height: dims.height }]}>
            <MaquetteBookPages
              page={row.page}
              pageNum={row.pageNum}
              width={dims.width}
              height={dims.height}
              child={child!}
              familyChildren={familyChildren}
              memory={mem}
              rotation={mem ? rotations[mem.id] ?? 0 : 0}
              photoCrop={
                mem &&
                (row.page.type === 'photo-full' ||
                  row.page.type === 'photo-note' ||
                  row.page.type === 'audio')
                  ? photoCrops[mem.id]
                  : undefined
              }
              truncated={false}
              coverYearLabel={coverYearLabel}
              coverDisplayTitle={row.page.type === 'cover' ? (coverTitleLine ?? `Journal de ${child!.name}`) : undefined}
              coverPhotoUri={row.page.type === 'cover' ? coverPhotoDisplayUri : null}
              coverPhotoCrop={photoCrops.cover}
              coverPhotoImgPxW={row.page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxW : undefined}
              coverPhotoImgPxH={row.page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxH : undefined}
              chapterDisplayTitle={row.page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
              onRotate={() => {}}
              onRequestTextEdit={() => {
                // En mode spread (paysage), on ne sait pas éditer “in place” : on ouvre l’éditeur
                // sur la page tapée puis on affiche la modale texte.
                setPendingTextEditPageIndex(Math.max(0, row.pageNum - 1));
                openEditor(Math.max(0, row.pageNum - 1));
              }}
              qrUrl={qrUrl}
            />
          </View>
        );
      };

      const showSpine = Boolean(left && right && layout.spineWidth > 0);

      return (
        <View
          style={[
            styles.pageSlide,
            styles.pageSlideSpread,
            { width: screenWidth, height: availHLandscape },
          ]}
        >
          <BookPreviewZoomWrap
            width={screenWidth}
            height={availHLandscape}
            isPagerActive={index === currentPageIndex}
          >
            <View style={styles.spreadZoomInner}>
              <View style={styles.spreadRow}>
                {layout.left ? (
                  <View style={[styles.spreadCell, layout.left]}>
                    {renderSpreadMaquette(left!, layout.left, qrUrlLeft)}
                  </View>
                ) : null}
                {showSpine ? (
                  <View style={[styles.spreadSpine, { width: layout.spineWidth, height: layout.rowHeight }]}>
                    <View style={styles.spreadSpineHairline} />
                  </View>
                ) : null}
                {layout.right ? (
                  <View style={[styles.spreadCell, layout.right]}>
                    {renderSpreadMaquette(right!, layout.right, qrUrlRight)}
                  </View>
                ) : null}
              </View>
            </View>
          </BookPreviewZoomWrap>
        </View>
      );
    },
    [
      availHLandscape,
      child,
      chapterTitleLine,
      coverPhotoDisplayUri,
      coverTitleLine,
      coverYearLabel,
      cropDpiMetaByKey,
      currentPageIndex,
      merge,
      photoCrops,
      rotations,
      screenWidth,
    ]
  );

  /** Un feuillet (page) en lecture seule dans la vue verticale ; tap → éditeur plein écran. */
  const renderBrowseLeaf = useCallback(
    (row: PageRow, w: number, h: number) => {
      const mem = memoryForMaquette(row.page, merge);
      const qrUrl = mem ? `${QR_BASE}/${mem.id}` : '';
      const showFolio = row.page.type !== 'cover' && row.page.type !== 'back-cover';
      return (
        <View style={styles.browseLeafCol}>
          <View style={[styles.browseLeafShadow, { width: w, height: h }]}>
            <Pressable
              onPressIn={() =>
                prefetchBookPageImage(bookPageMainImageUri(row, merge, coverPhotoDisplayUri))
              }
              onPress={() => openEditor(row.pageNum - 1)}
              style={[styles.browseLeafCard, { width: w, height: h }]}
              accessibilityRole="button"
              accessibilityLabel={`Modifier la page ${row.pageNum}`}
            >
              <MaquetteBookPages
              page={row.page}
              pageNum={row.pageNum}
              width={w}
              height={h}
              child={child!}
              familyChildren={familyChildren}
              memory={mem}
              rotation={mem ? rotations[mem.id] ?? 0 : 0}
              photoCrop={
                mem &&
                (row.page.type === 'photo-full' ||
                  row.page.type === 'photo-note' ||
                  row.page.type === 'audio')
                  ? photoCrops[mem.id]
                  : undefined
              }
              truncated={false}
              coverYearLabel={coverYearLabel}
              coverDisplayTitle={row.page.type === 'cover' ? (coverTitleLine ?? `Journal de ${child!.name}`) : undefined}
              coverPhotoUri={row.page.type === 'cover' ? coverPhotoDisplayUri : null}
              coverPhotoCrop={photoCrops.cover}
              coverPhotoImgPxW={row.page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxW : undefined}
              coverPhotoImgPxH={row.page.type === 'cover' ? cropDpiMetaByKey.cover?.imgPxH : undefined}
              chapterDisplayTitle={row.page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
              onRotate={() => {}}
              onRequestTextEdit={() => openEditor(row.pageNum - 1)}
              qrUrl={qrUrl}
            />
            </Pressable>
          </View>
          <Text style={[styles.browseFolio, dm400 && { fontFamily: dm400 }]}>
            {showFolio ? String(row.pageNum) : ' '}
          </Text>
        </View>
      );
    },
    [
      child,
      chapterTitleLine,
      coverPhotoDisplayUri,
      coverTitleLine,
      coverYearLabel,
      cropDpiMetaByKey,
      dm400,
      merge,
      openEditor,
      photoCrops,
      rotations,
    ]
  );

  const renderVerticalSpreadItem: ListRenderItem<SpreadRow> = useCallback(
    ({ item }) => {
      const { pageW, pageH } = browseLeaf;
      const isPair = Boolean(item.left && item.right);
      if (isPair) {
        return (
          <View style={styles.browseRow}>
            <View style={styles.browsePairWrap}>
              <View style={styles.browsePairRow}>
                {renderBrowseLeaf(item.left!, pageW, pageH)}
                {renderBrowseLeaf(item.right!, pageW, pageH)}
              </View>
              {/* Reliure : ombres légères de part et d'autre + trait central. */}
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
                style={[
                  styles.browseSpine,
                  { height: pageH, width: BROWSE_SPINE_W, left: pageW - BROWSE_SPINE_W / 2 },
                ]}
              >
                <View style={styles.browseSpineLine} pointerEvents="none" />
              </LinearGradient>
            </View>
          </View>
        );
      }
      const only = item.left ?? item.right;
      if (!only) return <View />;
      return (
        <View style={[styles.browseRow, styles.browseRowSingle]}>
          {renderBrowseLeaf(only, pageW, pageH)}
        </View>
      );
    },
    [browseLeaf, renderBrowseLeaf]
  );

  const editorActivePageIndex = editorOpen ? editorPageIndex : currentPageIndex;

  const currentPage = editorOpen
    ? pageRows[editorActivePageIndex]?.page
    : isLandscape
      ? (spreadRows[currentPageIndex]?.right?.page ?? spreadRows[currentPageIndex]?.left?.page)
      : pageRows[currentPageIndex]?.page;

  const actionsDisabled = !editorOpen && isLandscape;

  const photoOk =
    !actionsDisabled && (currentPage?.type === 'photo-full' || currentPage?.type === 'photo-note');
  const editOk =
    !actionsDisabled &&
    (currentPage?.type === 'cover' ||
      currentPage?.type === 'chapter' ||
      currentPage?.type === 'photo-full' ||
      currentPage?.type === 'photo-note' ||
      currentPage?.type === 'quote' ||
      currentPage?.type === 'audio' ||
      currentPage?.type === 'video');

  const coverPhotoOk = !actionsDisabled && currentPage?.type === 'cover';

  const canDeletePage =
    !actionsDisabled &&
    (currentPage?.type === 'photo-full' ||
      currentPage?.type === 'photo-note' ||
      currentPage?.type === 'quote' ||
      currentPage?.type === 'audio' ||
      currentPage?.type === 'video');

  const handleDeleteCurrentPage = useCallback(() => {
    if (!currentPage || !canDeletePage) return;
    const m = memoryForMaquette(currentPage, merge);
    if (!m) return;
    Alert.alert(
      'Supprimer cette page ?',
      'Le souvenir sera retiré du livre (mais pas supprimé).',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            setBookMemories(prev => prev.filter(mem => mem.id !== m.id));
          },
        },
      ]
    );
  }, [canDeletePage, currentPage, merge]);

  const handleToolbarRotate = useCallback(() => {
    if (!currentPage || !photoOk) return;
    const m = merge(currentPage.memory);
    onRotateMemory(m.id);
  }, [currentPage, merge, onRotateMemory, photoOk]);

  const handleToolbarEdit = useCallback(() => {
    if (!currentPage || !editOk) return;
    const m = 'memory' in currentPage ? merge(currentPage.memory) : null;
    openTextEditForPage(currentPage, m);
  }, [currentPage, editOk, merge, openTextEditForPage]);

  const editModalSingleInitial = useMemo(() => {
    if (!textEditTarget) return '';
    if (textEditTarget.kind === 'cover') {
      return coverTitleLine ?? `Journal de ${child!.name}`;
    }
    if (textEditTarget.kind === 'chapter') {
      return chapterTitleLine ?? 'Notre histoire';
    }
    if (textEditTarget.kind === 'memory') {
      return merge(textEditTarget.memory).content ?? '';
    }
    return '';
  }, [textEditTarget, coverTitleLine, chapterTitleLine, child, merge]);

  const editModalLineBudget = useMemo(() => {
    if (!textEditTarget || textEditTarget.kind !== 'memory') return undefined;
    const t = textEditTarget.memory.type;
    if (t === 'text') return MAX_BOOK_LINES;
    if (t === 'photo' || t === 'voice' || t === 'video') return MAX_BOOK_CAPTION_LINES;
    return undefined;
  }, [textEditTarget]);

  const saveSingleEdit = useCallback(
    (text: string) => {
      if (!textEditTarget) return;
      if (textEditTarget.kind === 'cover') {
        setCoverTitleLine(text);
        if (bookId) {
          void (async () => {
            const b = await getBook(bookId);
            if (!b) return;
            await upsertBook({ ...b, title: text.trim() || b.title });
          })();
        }
      } else if (textEditTarget.kind === 'chapter') {
        setChapterTitleLine(text.trim() || null);
      } else if (textEditTarget.kind === 'memory') {
        const memoryId = textEditTarget.memory.id;
        setBookMemories(prev =>
          prev.map(m => (m.id === memoryId ? { ...m, content: text } : m))
        );
        setAllMemories(prev =>
          prev.map(m => (m.id === memoryId ? { ...m, content: text } : m))
        );
        void (async () => {
          const ok = await updateMemoryContent(memoryId, text);
          if (!ok) {
            Alert.alert(
              'Connexion',
              "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
            );
          }
        })();
      }
    },
    [bookId, textEditTarget]
  );

  const editModalKey = useMemo(() => {
    if (!textEditTarget) return 'closed';
    if (textEditTarget.kind === 'cover') return 'cover';
    if (textEditTarget.kind === 'chapter') return 'chapter';
    return `memory-${textEditTarget.memory.id}`;
  }, [textEditTarget]);

  const doExportPdf = useCallback(
    async (exportMode: 'screen' | 'print') => {
      if (exporting || guestExportModalVisible || pages.length === 0 || !child) return;
      if (!isBookPdfServerConfigured()) {
        Alert.alert('Export PDF indisponible', PDF_EXPORT_REQUIRES_SERVER_MESSAGE);
        return;
      }
      // Export livre = toujours le service PDF distant ; pas de génération expo-print sur l’appareil.
      if (!__DEV__) {
        const can = await canExportBookPdfViaServer();
        if (!can) {
          router.push({
            pathname: '/paywall',
            params: { context: 'EXPORT_DIGITAL_PDF', childName: child.name },
          });
          return;
        }
      }
      if (exportMode === 'print') {
        // Contrôle qualité impression (DPI sur trim Gelato) : <240 warning, <200 blocage.
        const printUriForMemory = (m: Memory): string =>
          (m.print_url ?? m.display_url ?? m.edited_media_url ?? m.media_url ?? '').trim();

        const blocks: string[] = [];
        const warns: string[] = [];

        // Cover: variante print (pas le display de l’éditeur).
        const coverUri = (coverPhotoPrintUri?.trim() || child.photo_url?.trim() || '').trim();
        if (coverUri) {
          try {
            const coverMem = bookSnapshot ? findBookCoverMemory(bookSnapshot) : null;
            const printPx = coverMem
              ? getBookPhotoPrintPixelSize(coverMem, bookSnapshot?.coverPhotoUrl ?? undefined)
              : null;
            const cropScale = Math.max(1, photoCrops.cover?.scale ?? 1);
            const { w: mmW, h: mmH } = bookPrintFrameMmFor('cover');
            const px = printPx ?? (await getImagePx(coverUri));
            const dpi = effectiveBookPhotoPrintDpi({
              imgPxW: px.w,
              imgPxH: px.h,
              printMmW: mmW,
              printMmH: mmH,
              scale: cropScale,
            });
            if (dpi > 0 && dpi < 200) blocks.push(`Couverture (${dpi} DPI)`);
            else if (dpi > 0 && dpi < 240) warns.push(`Couverture (${dpi} DPI)`);
          } catch {
            // Si on ne peut pas lire la taille, on ne bloque pas.
          }
        }

        for (const p of pages) {
          if (p.type !== 'photo-full' && p.type !== 'photo-note') continue;
          const uri = printUriForMemory(p.memory);
          if (!uri) continue;
          try {
            const { w, h } = await getImagePx(uri);
            const cropScale = Math.max(1, photoCrops[p.memory.id]?.scale ?? 1);
            const { w: mmW, h: mmH } = bookPrintFrameMmFor(
              p.type,
              p.type === 'photo-full' ? p.variant : undefined
            );
            const dpi = effectiveBookPhotoPrintDpi({
              imgPxW: w,
              imgPxH: h,
              printMmW: mmW,
              printMmH: mmH,
              scale: cropScale,
            });
            const label = `${p.type === 'photo-full' ? 'Photo pleine page' : 'Photo + texte'} (${dpi} DPI)`;
            if (dpi > 0 && dpi < 200) blocks.push(label);
            else if (dpi > 0 && dpi < 240) warns.push(label);
          } catch {
            // ignore
          }
        }

        if (blocks.length > 0) {
          Alert.alert(
            'Qualité impression insuffisante',
            `Impossible d’exporter en mode impression.\n\nÀ corriger (recadrage moins zoomé ou meilleure photo) :\n- ${blocks.join(
              '\n- '
            )}\n\nRègle : <200 DPI = bloquant.`,
            [{ text: 'OK' }]
          );
          return;
        }

        if (warns.length > 0) {
          const proceed = await new Promise<boolean>(resolve => {
            Alert.alert(
              'Qualité impression moyenne',
              `Certaines photos sont sous 240 DPI.\n\nTu peux exporter quand même, mais ça peut être un peu flou.\n\n- ${warns.join(
                '\n- '
              )}\n\nRègle : ≥240 DPI OK · <240 warning · <200 bloquant.`,
              [
                { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Exporter quand même', onPress: () => resolve(true) },
              ]
            );
          });
          if (!proceed) return;
        }
      }

      const { data: sessData } = await supabase.auth.getSession();
      const accessToken = sessData.session?.access_token ?? null;

      if (accessToken) {
        setExporting(true);
        try {
          const { localUri } = await generateBookPdfViaServer({
            bookId: bookId ?? `draft-${child.id}`,
            childId: child.id,
            child,
            coverPhotoUrl: coverPhotoPrintUri,
            coverPhotoImgPxW: coverPhotoImgPxForPdf?.w,
            coverPhotoImgPxH: coverPhotoImgPxForPdf?.h,
            coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
            coverYearLabel,
            chapterTitle: chapterTitleLine ?? 'Notre histoire',
            pages,
            rotations,
            photoCrops,
            localEdits: EMPTY_MEMORY_EDITS,
            exportMode,
          });
          await shareBookPdf(localUri);
        } catch (e) {
          Alert.alert('Erreur', e instanceof Error ? e.message : 'Export impossible');
        } finally {
          setExporting(false);
        }
        return;
      }

      if (!isInitExportConfigured()) {
        Alert.alert(
          'Connexion ou configuration',
          'Export serveur sans compte : configure EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY, ou connecte-toi pour exporter.'
        );
        return;
      }
      pendingGuestExportMode.current = exportMode;
      setGuestExportModalVisible(true);
    },
    [
      chapterTitleLine,
      child,
      coverTitleLine,
      coverYearLabel,
      exporting,
      guestExportModalVisible,
      pages,
      photoCrops,
      rotations,
      router,
      bookId,
      bookSnapshot,
      coverPhotoPrintUri,
      coverPhotoImgPxForPdf,
    ]
  );

  const goToBookOrderPdf = useCallback(() => {
    if (!child || exporting || guestExportSubmitting) return;
    const memoryPageCountForOrder = pages.filter(
      p =>
        p.type === 'photo-full' ||
        p.type === 'photo-note' ||
        p.type === 'quote' ||
        p.type === 'audio' ||
        p.type === 'video'
    ).length;
    const avPageCountForOrder = pages.filter(p => p.type === 'audio' || p.type === 'video').length;
    void setPendingBookOrderPdfPayload({
      bookId: bookId ?? `draft-${child.id}`,
      childId: child.id,
      child,
      coverPhotoUrl: coverPhotoPrintUri,
      coverPhotoImgPxW: coverPhotoImgPxForPdf?.w,
      coverPhotoImgPxH: coverPhotoImgPxForPdf?.h,
      coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
      coverYearLabel,
      chapterTitle: chapterTitleLine ?? 'Notre histoire',
      pages,
      rotations,
      photoCrops,
      localEdits: EMPTY_MEMORY_EDITS,
      exportMode: 'screen',
    });
    router.push({
      pathname: '/book-order',
      params: {
        bookId: bookId ?? `draft-${child.id}`,
        childId: child.id,
        memoryPageCount: String(memoryPageCountForOrder),
        avPageCount: String(avPageCountForOrder),
        exportMode: 'pdf',
      },
    });
  }, [
    bookId,
    child,
    chapterTitleLine,
    coverPhotoPrintUri,
    coverPhotoImgPxForPdf,
    coverTitleLine,
    coverYearLabel,
    exporting,
    guestExportSubmitting,
    pages,
    photoCrops,
    rotations,
    router,
  ]);

  const goToBookOrderPrint = useCallback(() => {
    if (exporting || guestExportSubmitting || !child) return;
    const memoryPageCountForOrder = pages.filter(
      p =>
        p.type === 'photo-full' ||
        p.type === 'photo-note' ||
        p.type === 'quote' ||
        p.type === 'audio' ||
        p.type === 'video'
    ).length;
    const avPageCountForOrder = pages.filter(p => p.type === 'audio' || p.type === 'video').length;
    void setPendingBookOrderPdfPayload({
      bookId: bookId ?? `draft-${child.id}`,
      childId: child.id,
      child,
      coverPhotoUrl: coverPhotoPrintUri,
      coverPhotoImgPxW: coverPhotoImgPxForPdf?.w,
      coverPhotoImgPxH: coverPhotoImgPxForPdf?.h,
      coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
      coverYearLabel,
      chapterTitle: chapterTitleLine ?? 'Notre histoire',
      pages,
      rotations,
      photoCrops,
      localEdits: EMPTY_MEMORY_EDITS,
      exportMode: 'print',
    });
    router.push({
      pathname: '/book-order',
      params: {
        bookId: bookId ?? `draft-${child.id}`,
        childId: child.id,
        memoryPageCount: String(memoryPageCountForOrder),
        avPageCount: String(avPageCountForOrder),
        exportMode: 'print',
      },
    });
  }, [
    bookId,
    child,
    chapterTitleLine,
    coverPhotoPrintUri,
    coverPhotoImgPxForPdf,
    coverTitleLine,
    coverYearLabel,
    exporting,
    guestExportSubmitting,
    pages,
    photoCrops,
    rotations,
    router,
  ]);

  const handleExportBook = useCallback(() => {
    if (exporting || guestExportSubmitting || !child) return;
    Alert.alert('Exporter', 'Choisis un format.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Livre PDF', onPress: () => goToBookOrderPdf() },
      { text: 'Livre imprimé', onPress: () => goToBookOrderPrint() },
    ]);
  }, [child, exporting, goToBookOrderPdf, goToBookOrderPrint, guestExportSubmitting]);

  const onGuestExportSubmit = useCallback(
    async ({ email, marketingOptIn }: { email: string; marketingOptIn: boolean }) => {
      if (!child) return;
      setGuestExportModalVisible(false);
      setGuestExportSubmitting(true);
      try {
        const mode = pendingGuestExportMode.current;
        const { localUri } = await generateBookPdfViaServerAsGuest({
          bookId: bookId ?? `draft-${child.id}`,
          childId: child.id,
          child,
          coverPhotoUrl: coverPhotoPrintUri,
          coverPhotoImgPxW: coverPhotoImgPxForPdf?.w,
          coverPhotoImgPxH: coverPhotoImgPxForPdf?.h,
          coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
          coverYearLabel,
          chapterTitle: chapterTitleLine ?? 'Notre histoire',
          pages,
          rotations,
          photoCrops,
          localEdits: EMPTY_MEMORY_EDITS,
          exportMode: mode,
          consent: {
            email,
            gdprConsentAtIso: new Date().toISOString(),
            marketingOptIn,
          },
        });
        await setLastGuestExportEmail(email);
        await shareBookPdf(localUri);
      } catch (e) {
        setGuestExportModalVisible(true);
        if (e instanceof Error && e.message === 'PREP_NOT_READY') {
          Alert.alert(
            'Préparation des médias',
            'Certains médias ne sont pas encore prêts pour l’export serveur.\n\nAttends quelques secondes puis réessaie. Si ça ne progresse pas, connecte-toi pour activer la synchronisation.'
          );
        } else {
          Alert.alert('Erreur', e instanceof Error ? e.message : 'Export impossible');
        }
      } finally {
        setGuestExportSubmitting(false);
      }
    },
    [
      bookId,
      child,
      chapterTitleLine,
      coverPhotoPrintUri,
      coverPhotoImgPxForPdf,
      coverTitleLine,
      coverYearLabel,
      pages,
      photoCrops,
      rotations,
    ]
  );

  const showManyDots = pages.length > 28;

  if (loading && !child) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator size="large" color={THEME.textMuted} />
      </View>
    );
  }

  if (error && !child) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  if (!child) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorText}>{error ?? 'Indisponible'}</Text>
        <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && bookSelectionKeys.length < MIN_BOOK_SELECTION_KEYS) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.guardText}>
          Sélectionne au moins {MIN_BOOK_SELECTION_KEYS} souvenirs dans tes favoris.
        </Text>
        <Pressable
          onPress={unlockAndGoToFavoris}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel="Aller aux favoris"
        >
          <Text style={[styles.retryBtnText, dm500 && { fontFamily: dm500 }]}>Aller aux favoris →</Text>
        </Pressable>
        <Pressable
          onPress={confirmDeleteBookAndBack}
          style={[styles.retryBtn, styles.guardDeleteBtn]}
          accessibilityRole="button"
          accessibilityLabel="Supprimer ce livre"
        >
          <Text style={[styles.guardDeleteBtnText, dm500 && { fontFamily: dm500 }]}>Supprimer ce livre</Text>
        </Pressable>
        <Pressable onPress={unlockAndBack} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.guardBackLink, dm500 && { fontFamily: dm500 }]}>← Retour</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && bookSelectionKeys.length > MAX_BOOK_SELECTION_KEYS) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.guardText}>
          Tu as sélectionné trop de souvenirs pour un seul livre. Retire-en dans l&apos;onglet
          Favoris (icône livre) pour en garder au maximum {MAX_BOOK_SELECTION_KEYS}.
        </Text>
        <Pressable onPress={unlockAndBack} style={styles.retryBtn} accessibilityRole="button">
          <Text style={[styles.retryBtnText, dm500 && { fontFamily: dm500 }]}>← Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={unlockAndBack} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.headerBack, dm500 && { fontFamily: dm500 }]}>← Retour</Text>
        </Pressable>
        <Text style={[styles.headerTitle, dm600 && { fontFamily: dm600 }]} numberOfLines={1}>
          {pages.length} {pages.length <= 1 ? 'page' : 'pages'}
        </Text>
        {isLandscape ? (
          bookId ? (
            <Pressable
              onPress={unlockAndGoToFavorisForAdd}
              hitSlop={12}
              style={styles.headerCtaOutline}
              accessibilityRole="button"
              accessibilityLabel="Ajouter des souvenirs depuis les favoris"
            >
              <Text style={[styles.headerCtaTextDark, dm700 && { fontFamily: dm700 }]}>Ajouter</Text>
            </Pressable>
          ) : (
            <View style={styles.headerRightSpacer} accessibilityElementsHidden />
          )
        ) : (
          <Pressable
            onPress={() => void handleExportBook()}
            hitSlop={12}
            style={[
              styles.headerCtaOrange,
              (exporting || guestExportSubmitting) && { opacity: 0.5 },
            ]}
            disabled={exporting || guestExportSubmitting}
            accessibilityRole="button"
          >
            <Text style={[styles.headerCtaText, dm700 && { fontFamily: dm700 }]}>
              {exporting || guestExportSubmitting ? 'Export…' : 'Exporter'}
            </Text>
          </Pressable>
        )}
      </View>

      {loading && bookMemories.length === 0 ? (
        <View style={styles.loadingMid}>
          <ActivityIndicator color={THEME.textMuted} />
        </View>
      ) : null}

      {error ? (
        <Text style={styles.bannerErr}>{error}</Text>
      ) : null}

      {isLandscape ? (
        <FlatList
          ref={listRef}
          key="spread"
          data={spreadRows}
          keyExtractor={(_, i) => i.toString()}
          renderItem={renderSpreadItem as any}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onBookPagerMomentumEnd}
          // IMPORTANT perf: éviter un nouvel objet `extraData` à chaque render (a-coups).
          // Les items se rerender déjà via `renderItem`/closures quand l'écran rerender.
          style={styles.list}
          getItemLayout={(_, index) => ({
            length: screenWidth,
            offset: screenWidth * index,
            index,
          })}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={false}
        />
      ) : (
        <FlatList
          key="browse"
          data={spreadRows}
          keyExtractor={(_, i) => i.toString()}
          renderItem={renderVerticalSpreadItem as any}
          showsVerticalScrollIndicator={false}
          style={[styles.list, styles.browseList]}
          contentContainerStyle={[
            styles.browseContent,
            bookId ? styles.browseContentWithAddBar : null,
          ]}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={9}
          removeClippedSubviews={false}
        />
      )}

      {!isLandscape && bookId ? (
        <View style={styles.browseAddBar}>
          <Pressable
            onPress={unlockAndGoToFavorisForAdd}
            style={styles.headerCtaOutline}
            accessibilityRole="button"
            accessibilityLabel="Ajouter des souvenirs depuis les favoris"
          >
            <Text style={[styles.headerCtaTextDark, dm700 && { fontFamily: dm700 }]}>Ajouter</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={editorOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeEditor}
      >
        <View style={styles.editorModalRoot}>
        <GestureHandlerRootView style={styles.editorGhRoot}>
          <View style={styles.editorShell}>
          <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={styles.header}>
              <Pressable onPress={closeEditor} hitSlop={12} accessibilityRole="button">
                <View style={styles.headerDoneRow}>
                  <Text style={[styles.headerBack, dm500 && { fontFamily: dm500 }]}>Terminé</Text>
                  <Check size={16} color={THEME.brandCtaOrange} strokeWidth={2.5} />
                </View>
              </Pressable>
              <Text style={[styles.headerTitle, dm600 && { fontFamily: dm600 }]} numberOfLines={1}>
                Page {Math.min(editorActivePageIndex + 1, Math.max(1, pages.length))} · {pages.length}
              </Text>
              <View style={styles.headerRightSpacer} accessibilityElementsHidden />
            </View>

            <FlatList
              ref={editorListRef}
              key="editor"
              data={pageRows}
              keyExtractor={(_, i) => i.toString()}
              renderItem={renderPageItem as any}
              horizontal
              pagingEnabled
              scrollEnabled={textEditTarget == null}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onBookPagerMomentumEnd}
              style={styles.editorList}
              getItemLayout={(_, index) => ({
                length: screenWidth,
                offset: screenWidth * index,
                index,
              })}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              windowSize={3}
              updateCellsBatchingPeriod={50}
              removeClippedSubviews={false}
            />

            <View style={styles.bottomBar}>
              <View style={styles.bottomIndicatorRow}>
                {showManyDots ? (
                  <Text style={[styles.pageFraction, dm400 && { fontFamily: dm400 }]}>
                    {editorActivePageIndex + 1} / {Math.max(1, pages.length)}
                  </Text>
                ) : (
                  <View style={styles.dotsRow}>
                    {pageRows.map((_, i) => (
                      <View
                        key={i.toString()}
                        style={i === editorActivePageIndex ? styles.dotActive : styles.dotIdle}
                      />
                    ))}
                  </View>
                )}
                <Text style={[styles.bottomPageLabel, dm400 && { fontFamily: dm400 }]}>
                  {pages.length > 0 ? pageLabel(editorActivePageIndex + 1, pages.length) : ''}
                </Text>
              </View>
              <View style={styles.bottomButtonsRow}>
                {canDeletePage ? (
                  <TouchableOpacity
                    style={styles.pill}
                    onPress={handleDeleteCurrentPage}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                  >
                    <View style={styles.pillInner}>
                      <Trash2 size={14} color={THEME.textSecondary} strokeWidth={2} />
                      <Text style={[styles.pillText, dm400 && { fontFamily: dm400 }]}>Supprimer</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
                {coverPhotoOk ? (
                  <TouchableOpacity
                    style={styles.pill}
                    onPress={openCoverPicker}
                    activeOpacity={0.75}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel="Changer la photo de couverture"
                  >
                    <View style={styles.pillInner}>
                      <ImageIcon size={14} color={THEME.textSecondary} strokeWidth={2} />
                      <Text style={[styles.pillText, dm400 && { fontFamily: dm400 }]}>Photo</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.pill, !editOk && styles.pillDisabled]}
                  onPress={handleToolbarEdit}
                  disabled={!editOk}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  <View style={styles.pillInner}>
                    <Pencil size={14} color={THEME.textSecondary} strokeWidth={2} />
                    <Text style={[styles.pillText, dm400 && { fontFamily: dm400 }]}>Modifier</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {coverPickerOpen ? (
            <View style={[styles.coverPickerOverlay, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}>
              <View style={styles.coverPickerHeader}>
                <Text style={styles.coverPickerTitle}>Choisir la couverture</Text>
                <Pressable onPress={closeCoverPicker} hitSlop={12} accessibilityRole="button">
                  <X size={20} color={THEME.textPrimary} strokeWidth={2.2} />
                </Pressable>
              </View>
              <FlatList
                data={favoriteCoverThumbs}
                keyExtractor={it => it.source}
                numColumns={3}
                columnWrapperStyle={{ gap: 2 }}
                contentContainerStyle={{ paddingHorizontal: 2, gap: 2, paddingBottom: 8 }}
                ListHeaderComponent={
                  <View style={styles.coverPickerListHeader}>
                    <Pressable
                      onPress={() => void pickCoverFromGallery()}
                      style={({ pressed }) => [
                        styles.coverPickerGalleryBtn,
                        pressed && { opacity: 0.9 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Choisir une photo depuis la galerie"
                    >
                      <Text style={styles.coverPickerGalleryBtnText}>Choisir depuis la galerie</Text>
                    </Pressable>
                    {favoriteCoverThumbs.length > 0 ? (
                      <Text style={styles.coverPickerSectionLabel}>Photos des favoris</Text>
                    ) : (
                      <Text style={styles.coverPickerSectionHint}>
                        Aucune photo favorite pour ce livre — utilise la galerie ou ajoute des favoris.
                      </Text>
                    )}
                  </View>
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => void pickCover(item.source)}
                    style={({ pressed }) => [{ flex: 1 / 3, aspectRatio: 1, opacity: pressed ? 0.9 : 1 }]}
                    accessibilityRole="button"
                  >
                    <Image source={{ uri: item.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  </Pressable>
                )}
                refreshControl={
                  <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={THEME.textMuted} />
                }
                showsVerticalScrollIndicator={false}
              />
            </View>
          ) : null}

          </View>
        </GestureHandlerRootView>

        <EditTextModal
          key={editModalKey}
          embedded
          visible={textEditTarget != null}
          initialText={editModalSingleInitial}
          previewVariant="book"
          bookLineBudget={editModalLineBudget}
          title={textEditTarget?.modalTitle ?? ''}
          onClose={() => setTextEditTarget(null)}
          onSave={saveSingleEdit}
        />
        </View>
      </Modal>

      <GuestPdfExportModal
        visible={guestExportModalVisible}
        loading={guestExportSubmitting}
        onClose={() => {
          if (!guestExportSubmitting) setGuestExportModalVisible(false);
        }}
        onSubmit={onGuestExportSubmit}
      />

      <BookPdfGeneratingOverlay visible={exporting || guestExportSubmitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BROWSE_BG,
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: BROWSE_BG,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingMid: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  bannerErr: {
    color: '#FFB4AB',
    textAlign: 'center',
    fontSize: 12,
    paddingVertical: 4,
  },
  errorText: {
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  guardText: {
    color: THEME.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 24,
    fontSize: 15,
    lineHeight: 22,
  },
  retryBtn: {
    padding: 12,
  },
  retryBtnText: {
    color: THEME.textPrimary,
    fontWeight: '500',
    fontSize: 16,
  },
  guardDeleteBtn: {
    marginTop: 4,
  },
  guardDeleteBtnText: {
    color: '#E23B3B',
    fontWeight: '600',
    fontSize: 16,
  },
  guardBackLink: {
    marginTop: 20,
    color: THEME.textMuted,
    fontWeight: '500',
    fontSize: 15,
  },
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: BROWSE_BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.familyFlowLine,
  },
  headerDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerBack: {
    color: THEME.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    color: THEME.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerCta: {
    backgroundColor: THEME.textPrimary,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  headerCtaOrange: {
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  headerCtaOutline: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.textPrimary,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  headerCtaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  headerCtaTextDark: {
    color: THEME.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  /** Équilibre le header quand le CTA Exporter est masqué (paysage). */
  headerRightSpacer: {
    minWidth: 88,
    height: 1,
  },
  list: {
    flex: 1,
  },
  editorGhRoot: {
    flex: 1,
  },
  editorModalRoot: {
    flex: 1,
    position: 'relative',
  },
  editorShell: {
    flex: 1,
    position: 'relative',
  },
  coverPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
    backgroundColor: BROWSE_BG,
  },
  editorList: {
    flex: 1,
    minHeight: 0,
  },
  browseList: {
    backgroundColor: BROWSE_BG,
  },
  browseContent: {
    paddingHorizontal: BROWSE_SIDE_PAD,
    paddingTop: BROWSE_ROW_GAP,
    paddingBottom: BROWSE_ROW_GAP * 2,
    backgroundColor: BROWSE_BG,
  },
  browseContentWithAddBar: {
    paddingBottom: BROWSE_ROW_GAP + BOTTOM_H,
  },
  browseAddBar: {
    flexShrink: 0,
    alignItems: 'center',
    backgroundColor: BROWSE_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.familyFlowLine,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 20,
    elevation: 20,
  },
  browseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: BROWSE_ROW_GAP,
  },
  browseRowSingle: {
    justifyContent: 'center',
  },
  browsePairWrap: {
    position: 'relative',
  },
  browsePairRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  /** Reliure centrale : dégradé d’ombre (les couleurs viennent du LinearGradient). */
  browseSpine: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Trait fin au creux de la reliure. */
  browseSpineLine: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  browseLeafCol: {
    alignItems: 'center',
  },
  /** Porte l’ombre : surtout PAS d’overflow:hidden ici (sinon iOS coupe l’ombre). */
  browseLeafShadow: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  /** Rogne le contenu de la page ; ne porte pas l’ombre. */
  browseLeafCard: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  browseFolio: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(60,60,67,0.5)',
    textAlign: 'center',
  },
  pageSlide: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BROWSE_BG,
  },
  /** Halo / relief de la page en éditeur (pas d’overflow:hidden — iOS coupe l’ombre sinon). */
  editorPageShadow: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  editorPageCard: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  /** Centre la page Gelato dans la slide avant zoom (parité spread `spreadZoomInner`). */
  editorZoomInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageSlideSpread: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BROWSE_BG,
  },
  /** Contenu du spread (pages + dos) zoomé ensemble, centré dans la slide paysage. */
  spreadZoomInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadCell: {
    overflow: 'hidden',
  },
  spreadPageCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadSpine: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spreadSpineHairline: {
    width: Math.max(StyleSheet.hairlineWidth, 1),
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  bottomBar: {
    flexShrink: 0,
    backgroundColor: BROWSE_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.familyFlowLine,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
    zIndex: 20,
    elevation: 20,
  },
  bottomIndicatorRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  bottomPageLabel: {
    fontSize: 11,
    color: THEME.textSecondary,
    marginTop: 4,
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  pageFraction: {
    fontSize: 11,
    color: THEME.textSecondary,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 120,
  },
  dotActive: {
    width: 14,
    height: 5,
    borderRadius: 3,
    backgroundColor: THEME.textPrimary,
  },
  dotIdle: {
    width: 5,
    height: 5,
    borderRadius: 50,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  pill: {
    backgroundColor: THEME.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.familyFlowLine,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  pillDisabled: {
    opacity: 0.35,
  },
  pillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillText: {
    fontSize: 11,
    color: THEME.textPrimary,
  },
  coverPickerRoot: {
    flex: 1,
    backgroundColor: BROWSE_BG,
  },
  coverPickerHeader: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coverPickerTitle: {
    color: THEME.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  coverPickerListHeader: {
    marginBottom: 10,
  },
  coverPickerGalleryBtn: {
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  coverPickerGalleryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  coverPickerSectionLabel: {
    color: THEME.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  coverPickerSectionHint: {
    color: THEME.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
});

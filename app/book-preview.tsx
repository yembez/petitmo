import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  BackHandler,
  Alert,
  Modal,
  Image,
  RefreshControl,
  type ListRenderItem,
} from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Pencil, Trash2, X } from 'lucide-react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildBookPages, type BookPage } from '@/src/book/BookEngine';
import MaquetteBookPages from '@/src/book/maquette/MaquetteBookPages';
import {
  mergePhotoNoteTitleBody,
  mergeVideoTitleBody,
  splitPhotoNoteTitleBody,
  splitVideoTitleBody,
} from '@/src/book/bookTextParts';
import EditTextModal from '@/components/EditTextModal';
import { BookPhotoCropModal } from '@/components/BookPhotoCropModal';
import { BookPreviewZoomWrap } from '@/components/BookPreviewZoomWrap';
import { getChildren, getOrSelectFirstChild } from '@/services/children';
import { getMemories } from '@/services/media';
import { loadBookSelectionKeys, memoryIdFromBookSelectionKey } from '@/services/bookSelection';
import { dedupeMemoryIds, getBook, upsertBook } from '@/services/books';
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
import { parseFavoritePhotoUrls, mapPhotoUrlToThumb, getAllPhotoUrls } from '@/utils/memoryPhotos';
import { runBookExportPrepInBackground } from '@/services/bookExportPrep';
import { getBookExportPrepIssues } from '@/services/bookExportPrep';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { isLocalMediaUriReadable, isProbablyStalePetitmoSandboxPath } from '@/utils/localMediaReadable';

import type { Child, Memory } from '@/types/local';
import { canExportBookPdfViaServer } from '@/lib/digitalExportPurchase';
import { setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { setPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import { supabase } from '@/lib/supabase';

const HEADER_H = 44;
const BOTTOM_H = 82;
const QR_BASE = 'https://petitmo.app/m';
const MIN_BOOK_SELECTION_KEYS = 5;
const MAX_BOOK_SELECTION_KEYS = 80;

/** Aligné sur `printFrameMmFor` — ratio largeur / hauteur de la page à l’impression. */
const BOOK_PAGE_W_MM = 154;
const BOOK_PAGE_H_MM = 216;

/**
 * Spread paysage : deux pages → même gabarit **A5 plein** (154×216 mm à l’échelle), comme un livre ouvert.
 * Page seule (couverture à droite, quatrième à gauche, dernière page impaire) : **même A5** que les demi-pages
 * du double page — la maquette (couverture incluse) attend width/height au ratio 154:216, pas un cadre 154:142.
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

  const trimA5 = { w: BOOK_PAGE_W_MM, h: BOOK_PAGE_H_MM };

  if (!left && !right) {
    return { left: null, right: null, spineWidth: 0, rowHeight: 0 };
  }

  if (!left && right) {
    const s = Math.min(availW / trimA5.w, availH / trimA5.h);
    const rw = Math.max(1, Math.floor(s * trimA5.w));
    const rh = Math.max(1, Math.floor(s * trimA5.h));
    return { left: null, right: { width: rw, height: rh }, spineWidth: 0, rowHeight: rh };
  }

  if (left && !right) {
    const s = Math.min(availW / trimA5.w, availH / trimA5.h);
    const lw = Math.max(1, Math.floor(s * trimA5.w));
    const lh = Math.max(1, Math.floor(s * trimA5.h));
    return { left: { width: lw, height: lh }, right: null, spineWidth: 0, rowHeight: lh };
  }

  const s = Math.min((availW - spineTotal) / (trimA5.w * 2), availH / trimA5.h);
  const pw = Math.max(1, Math.floor(s * trimA5.w));
  const ph = Math.max(1, Math.floor(s * trimA5.h));
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
  | {
      kind: 'memory';
      memory: Memory;
      modalTitle: string;
      fields: 'single' | 'title-body';
      /** Requis si `fields === 'title-body'` */
      textMode?: 'photo-note' | 'video';
    };

function mergeMemory(m: Memory, edits: Record<string, Partial<Memory>>): Memory {
  const e = edits[m.id];
  return e ? { ...m, ...e } : m;
}

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

  const [child, setChild] = useState<Child | null>(null);
  const [bookMemories, setBookMemories] = useState<Memory[]>([]);
  const [bookSelectionKeys, setBookSelectionKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Memory>>>({});
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const [photoCrops, setPhotoCrops] = useState<Record<string, { xPct: number; yPct: number; scale: number }>>({});
  const [imagePxCache, setImagePxCache] = useState<Record<string, { w: number; h: number }>>({});
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  /** Titre principal de la couverture (ligne complète, ex. « Journal de … »). */
  const [coverTitleLine, setCoverTitleLine] = useState<string | null>(null);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  /** Texte des pages chapitre (éditable). */
  const [chapterTitleLine, setChapterTitleLine] = useState<string | null>(null);
  const [textEditTarget, setTextEditTarget] = useState<TextEditTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [allMemories, setAllMemories] = useState<Memory[]>([]);
  const [guestExportModalVisible, setGuestExportModalVisible] = useState(false);
  const [guestExportSubmitting, setGuestExportSubmitting] = useState(false);
  const pendingGuestExportMode = useRef<'screen' | 'print'>('screen');
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [bookCropSession, setBookCropSession] = useState<{
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'cover' | 'photo-full' | 'photo-note' | 'audio';
    imgPxW: number;
    imgPxH: number;
    printMmW: number;
    printMmH: number;
  } | null>(null);

  const listRef = useRef<FlatList<any>>(null);

  const pages = useMemo(() => {
    if (!child) return [];
    return buildBookPages(child, bookMemories);
  }, [child, bookMemories]);

  // Préparation best-effort en fond: pousse les médias nécessaires + déclenche les dérivés pour l’export serveur.
  useEffect(() => {
    if (!isBookPdfServerConfigured()) return;
    if (!child || pages.length === 0) return;
    void runBookExportPrepInBackground({ pages, localEdits });
  }, [child, localEdits, pages]);

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
    if (!isLandscape) return [];
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
  }, [isLandscape, pageRows]);

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

  const signedCoverPhotoUrl = useSignedMediaUrl(coverPhotoUrl);
  const coverPhotoDisplayUri = (signedCoverPhotoUrl ?? coverPhotoUrl ?? null)?.trim() ? (signedCoverPhotoUrl ?? coverPhotoUrl ?? null) : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const childId = await getOrSelectFirstChild();
      if (!childId) {
        setError('Aucun enfant sélectionné');
        setChild(null);
        setBookMemories([]);
        setBookSelectionKeys([]);
        return;
      }
      const children = await getChildren();
      const ch = children.find(c => c.id === childId) ?? null;
      if (!ch) {
        setError('Profil enfant introuvable');
        setChild(null);
        setBookMemories([]);
        setBookSelectionKeys([]);
        return;
      }
      setChild(ch);

      let memoryIds: Set<string>;
      if (bookId) {
        const b = await getBook(bookId);
        if (!b) {
          setError('Livre introuvable');
          setBookMemories([]);
          setBookSelectionKeys([]);
          return;
        }
        // Le titre du livre sert de titre PDF/couverture dans l’aperçu.
        setCoverTitleLine(b.title);
        const rawCover = typeof b.coverPhotoUrl === 'string' ? b.coverPhotoUrl.trim() : '';
        // Réinstall / purge sandbox : un `file://...petitmo_memories/...` peut rester en base alors que le fichier n’existe plus.
        if (rawCover && isProbablyStalePetitmoSandboxPath(rawCover)) {
          const ok = await isLocalMediaUriReadable(rawCover);
          setCoverPhotoUrl(ok ? rawCover : null);
        } else {
          setCoverPhotoUrl(rawCover || null);
        }
        if (b.rotations) setRotations(b.rotations);
        if (b.photoCrops) setPhotoCrops(b.photoCrops);
        if (b.textEdits) {
          const edits: Record<string, Partial<Memory>> = {};
          for (const [id, e] of Object.entries(b.textEdits)) {
            if (e.content !== undefined) edits[id] = { content: e.content };
          }
          setLocalEdits(edits);
        }
        if (b.chapterTitle) setChapterTitleLine(b.chapterTitle);
        memoryIds = new Set(b.memoryIds);
        setBookSelectionKeys(b.memoryIds);
      } else {
        const keys = await loadBookSelectionKeys();
        setBookSelectionKeys(keys);
        memoryIds = new Set(keys.map(memoryIdFromBookSelectionKey));
      }

      const all = await getMemories(childId);
      setAllMemories(all);
      const picked = all
        .filter(m => memoryIds.has(m.id))
        .sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      setBookMemories(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-save customizations to AsyncStorage when they change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bookId || loading) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void (async () => {
        const b = await getBook(bookId);
        if (!b) return;
        const textEditsForSave: Record<string, { content?: string | null }> = {};
        for (const [id, e] of Object.entries(localEdits)) {
          if (e.content !== undefined) textEditsForSave[id] = { content: e.content ?? null };
        }
        const hasRotations = Object.keys(rotations).some(k => rotations[k] !== 0);
        const hasEdits = Object.keys(textEditsForSave).length > 0;
        const hasCrops = Object.keys(photoCrops).length > 0;
        await upsertBook({
          ...b,
          memoryIds: dedupeMemoryIds(bookMemories.map(m => m.id)),
          rotations: hasRotations ? rotations : undefined,
          photoCrops: hasCrops ? photoCrops : undefined,
          textEdits: hasEdits ? textEditsForSave : undefined,
          chapterTitle: chapterTitleLine ?? undefined,
        });
      })();
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [bookId, loading, rotations, photoCrops, localEdits, chapterTitleLine, bookMemories]);

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

  function printFrameMmFor(pageType: 'cover' | 'photo-full' | 'photo-note' | 'audio'): { w: number; h: number } {
    const pageWmm = 154;
    const pageHmm = 216;
    if (pageType === 'cover') return { w: pageWmm, h: 142 };
    if (pageType === 'photo-note' || pageType === 'audio') return { w: pageWmm, h: pageHmm * 0.6 };
    return { w: pageWmm, h: pageHmm };
  }

  const openBookCrop = useCallback(
    (payload: {
      storageKey: string;
      uri: string;
      frameW: number;
      frameH: number;
      pageType: 'cover' | 'photo-full' | 'photo-note' | 'audio';
    }) => {
      void (async () => {
        const mm = printFrameMmFor(payload.pageType);
        try {
          const px = await getImagePx(payload.uri);
          setBookCropSession({ ...payload, imgPxW: px.w, imgPxH: px.h, printMmW: mm.w, printMmH: mm.h });
        } catch {
          const id = payload.storageKey.trim();
          const mem = id && id !== 'cover' ? bookMemories.find(m => m.id === id) : null;
          const ow = mem?.original_px_w;
          const oh = mem?.original_px_h;
          if (typeof ow === 'number' && typeof oh === 'number' && ow > 0 && oh > 0) {
            setBookCropSession({ ...payload, imgPxW: ow, imgPxH: oh, printMmW: mm.w, printMmH: mm.h });
          } else {
            setBookCropSession({ ...payload, imgPxW: 0, imgPxH: 0, printMmW: mm.w, printMmH: mm.h });
          }
        }
      })();
    },
    [bookMemories, getImagePx]
  );

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
    router.replace('/(tabs)/livres');
  }, [router, unlockOrientationPortrait]);

  const unlockAndGoToFavoris = useCallback(() => {
    unlockOrientationPortrait();
    router.replace('/(tabs)/favoris');
  }, [router, unlockOrientationPortrait]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      unlockAndBack();
      return true;
    });
    return () => sub.remove();
  }, [unlockAndBack]);

  const onMemoryFieldEdit = useCallback((memoryId: string, field: keyof Memory, value: string | null) => {
    setLocalEdits(prev => ({
      ...prev,
      [memoryId]: { ...prev[memoryId], [field]: value },
    }));
  }, []);

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
      const slideCount = isLandscape ? spreadRows.length : pageRows.length;
      if (slideCount <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const ix = Math.max(0, Math.min(Math.round(x / screenWidth), slideCount - 1));
      setCurrentPageIndex(prev => (prev === ix ? prev : ix));
    },
    [isLandscape, pageRows.length, screenWidth, spreadRows.length]
  );

  const merge = useCallback((m: Memory) => mergeMemory(m, localEdits), [localEdits]);

  const renderMaquettePage = useCallback(
    (row: PageRow): ReactElement => {
      const { page, pageNum } = row;
      const m = memoryForMaquette(page, merge);
      const rot = m ? rotations[m.id] ?? 0 : 0;
      const qrUrl = m ? `${QR_BASE}/${m.id}` : '';

      const coverDisplayTitle = coverTitleLine ?? `Journal de ${child!.name}`;

      const openTextEditForThisPage = () => {
        switch (page.type) {
          case 'cover':
            setTextEditTarget({ kind: 'cover', modalTitle: 'Titre du livre' });
            break;
          case 'chapter':
            setTextEditTarget({ kind: 'chapter', modalTitle: 'Titre des chapitres' });
            break;
          case 'photo-full':
            if (m) {
              setTextEditTarget({
                kind: 'memory',
                memory: m,
                modalTitle: 'Modifier le titre',
                fields: 'single',
              });
            }
            break;
          case 'photo-note':
            if (m) {
              setTextEditTarget({
                kind: 'memory',
                memory: m,
                modalTitle: 'Titre et texte',
                fields: 'title-body',
                textMode: 'photo-note',
              });
            }
            break;
          case 'quote':
            if (m) {
              setTextEditTarget({
                kind: 'memory',
                memory: m,
                modalTitle: 'Modifier le texte',
                fields: 'single',
              });
            }
            break;
          case 'audio':
            if (m) {
              setTextEditTarget({
                kind: 'memory',
                memory: m,
                modalTitle: 'Modifier le titre',
                fields: 'single',
              });
            }
            break;
          case 'video':
            if (m) {
              setTextEditTarget({
                kind: 'memory',
                memory: m,
                modalTitle: 'Titre et description',
                fields: 'title-body',
                textMode: 'video',
              });
            }
            break;
          default:
            break;
        }
      };

      return (
        <MaquetteBookPages
          page={page}
          pageNum={pageNum}
          width={screenWidth}
          height={availHPortrait}
          child={child!}
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
          coverPhotoUri={page.type === 'cover' ? coverPhotoDisplayUri : null}
          coverPhotoCrop={photoCrops.cover}
          onRequestCoverPhoto={
            page.type === 'cover'
              ? () => {
                  setCoverPickerOpen(true);
                }
              : undefined
          }
          onRequestBookCrop={openBookCrop}
          chapterDisplayTitle={page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
          onRotate={() => {
            if (m && (page.type === 'photo-full' || page.type === 'photo-note' || page.type === 'audio')) {
              onRotateMemory(m.id);
            }
          }}
          onRequestTextEdit={openTextEditForThisPage}
          qrUrl={qrUrl}
        />
      );
    },
    [
      availHPortrait,
      child,
      coverPhotoDisplayUri,
      coverTitleLine,
      coverYearLabel,
      openBookCrop,
      chapterTitleLine,
      merge,
      onRotateMemory,
      photoCrops,
      rotations,
      screenWidth,
    ]
  );

  const favoriteCoverThumbs = useMemo(() => {
    const out: { thumb: string; source: string }[] = [];
    const seen = new Set<string>();
    for (const m of allMemories) {
      if (m.type !== 'photo') continue;
      const favUrls = parseFavoritePhotoUrls(m);
      const allUrls = favUrls.length > 0 ? favUrls : (m.is_favorite ? getAllPhotoUrls(m) : []);
      for (const u of allUrls) {
        const source = u.trim();
        if (!source) continue;
        const mapped = mapPhotoUrlToThumb(m, u).trim();
        if (!mapped) continue;
        // On déduplique par source réelle (pas par thumb), pour éviter de sauvegarder un thumbnail comme couverture.
        if (seen.has(source)) continue;
        seen.add(source);
        out.push({ thumb: mapped, source });
      }
    }
    return out;
  }, [allMemories]);

  const pickCover = useCallback(
    (uri: string) => {
      const next = uri.trim() || null;
      setCoverPhotoUrl(next);
      setCoverPickerOpen(false);
      if (!bookId || !next) return;
      void (async () => {
        const b = await getBook(bookId);
        if (!b) return;
        await upsertBook({ ...b, coverPhotoUrl: next });
      })();
    },
    [bookId]
  );

  const renderPageItem: ListRenderItem<PageRow> = useCallback(
    ({ item, index }) => (
      <View style={[styles.pageSlide, { width: screenWidth, height: availHPortrait }]}>
        <BookPreviewZoomWrap
          width={screenWidth}
          height={availHPortrait}
          isPagerActive={index === currentPageIndex}
        >
          {renderMaquettePage(item)}
        </BookPreviewZoomWrap>
      </View>
    ),
    [availHPortrait, currentPageIndex, renderMaquettePage, screenWidth]
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
              chapterDisplayTitle={row.page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
              onRotate={() => {}}
              onRequestTextEdit={() => {}}
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
            { width: screenWidth, height: availHLandscape, backgroundColor: '#000000' },
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
      currentPageIndex,
      merge,
      photoCrops,
      rotations,
      screenWidth,
    ]
  );

  const currentPage = isLandscape
    ? (spreadRows[currentPageIndex]?.right?.page ?? spreadRows[currentPageIndex]?.left?.page)
    : pageRows[currentPageIndex]?.page;

  const actionsDisabled = isLandscape;

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
    if (currentPage.type === 'cover') {
      setTextEditTarget({ kind: 'cover', modalTitle: 'Titre du livre' });
      return;
    }
    if (currentPage.type === 'chapter') {
      setTextEditTarget({ kind: 'chapter', modalTitle: 'Titre des chapitres' });
      return;
    }
    const m = merge(currentPage.memory);
    if (currentPage.type === 'quote') {
      setTextEditTarget({
        kind: 'memory',
        memory: m,
        modalTitle: 'Modifier le texte',
        fields: 'single',
      });
    } else if (currentPage.type === 'photo-full') {
      setTextEditTarget({
        kind: 'memory',
        memory: m,
        modalTitle: 'Modifier le titre',
        fields: 'single',
      });
    } else if (currentPage.type === 'photo-note') {
      setTextEditTarget({
        kind: 'memory',
        memory: m,
        modalTitle: 'Titre et texte',
        fields: 'title-body',
        textMode: 'photo-note',
      });
    } else if (currentPage.type === 'audio') {
      setTextEditTarget({
        kind: 'memory',
        memory: m,
        modalTitle: 'Modifier le titre',
        fields: 'single',
      });
    } else if (currentPage.type === 'video') {
      setTextEditTarget({
        kind: 'memory',
        memory: m,
        modalTitle: 'Titre et description',
        fields: 'title-body',
        textMode: 'video',
      });
    }
  }, [currentPage, editOk, merge]);

  const editModalSingleInitial = useMemo(() => {
    if (!textEditTarget) return '';
    if (textEditTarget.kind === 'cover') {
      return coverTitleLine ?? `Journal de ${child!.name}`;
    }
    if (textEditTarget.kind === 'chapter') {
      return chapterTitleLine ?? 'Notre histoire';
    }
    if (textEditTarget.kind === 'memory' && textEditTarget.fields === 'single') {
      return merge(textEditTarget.memory).content ?? '';
    }
    return '';
  }, [textEditTarget, coverTitleLine, chapterTitleLine, child, merge]);

  const editModalTitleBodyInitial = useMemo(() => {
    if (!textEditTarget || textEditTarget.kind !== 'memory' || textEditTarget.fields !== 'title-body') {
      return { title: '', body: '' };
    }
    const raw = merge(textEditTarget.memory).content ?? '';
    if (textEditTarget.textMode === 'photo-note') {
      if (!raw.trim()) return { title: '', body: '' };
      return splitPhotoNoteTitleBody(raw);
    }
    return splitVideoTitleBody(raw);
  }, [textEditTarget, merge]);

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
      } else if (textEditTarget.kind === 'memory' && textEditTarget.fields === 'single') {
        onMemoryFieldEdit(textEditTarget.memory.id, 'content', text);
      }
    },
    [bookId, onMemoryFieldEdit, textEditTarget]
  );

  const saveTitleBodyEdit = useCallback(
    (title: string, body: string) => {
      if (!textEditTarget || textEditTarget.kind !== 'memory' || textEditTarget.fields !== 'title-body') {
        return;
      }
      const mode = textEditTarget.textMode;
      const raw =
        mode === 'video' ? mergeVideoTitleBody(title, body) : mergePhotoNoteTitleBody(title, body);
      onMemoryFieldEdit(textEditTarget.memory.id, 'content', raw);
    },
    [textEditTarget, onMemoryFieldEdit]
  );

  const isTitleBodyModal =
    textEditTarget?.kind === 'memory' && textEditTarget.fields === 'title-body';

  const editModalKey = useMemo(() => {
    if (!textEditTarget) return 'closed';
    if (textEditTarget.kind === 'cover') return 'cover';
    if (textEditTarget.kind === 'chapter') return 'chapter';
    return `${textEditTarget.memory.id}-${textEditTarget.fields}${
      textEditTarget.fields === 'title-body' ? `-${textEditTarget.textMode}` : ''
    }`;
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
        // Contrôle qualité impression (DPI effective) : <240 warning, <200 blocage.
        const mmToIn = (mm: number) => mm / 25.4;
        const pageWmm = 154;
        const pageHmm = 216;
        const coverHmm = 142;
        const pnHmm = pageHmm * 0.6;
        const frameMmFor = (t: 'cover' | 'photo-full' | 'photo-note') => ({
          w: pageWmm,
          h: t === 'cover' ? coverHmm : t === 'photo-note' ? pnHmm : pageHmm,
        });
        const effDpi = (pxW: number, pxH: number, mmW: number, mmH: number, scale: number) => {
          const s = Math.max(1, scale);
          const dpiX = (pxW / s) / mmToIn(mmW);
          const dpiY = (pxH / s) / mmToIn(mmH);
          return Math.floor(Math.min(dpiX, dpiY));
        };
        const printUriForMemory = (m: Memory): string =>
          (m.print_url ?? m.display_url ?? m.edited_media_url ?? m.media_url ?? '').trim();

        const blocks: string[] = [];
        const warns: string[] = [];

        // Cover: photo du child (ou coverPhotoUrl du livre)
        const coverUri = (coverPhotoUrl?.trim() || child.photo_url?.trim() || '').trim();
        if (coverUri) {
          try {
            const { w, h } = await getImagePx(coverUri);
            const cropScale = Math.max(1, photoCrops.cover?.scale ?? 1);
            const { w: mmW, h: mmH } = frameMmFor('cover');
            const dpi = effDpi(w, h, mmW, mmH, cropScale);
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
            const { w: mmW, h: mmH } = frameMmFor(p.type);
            const dpi = effDpi(w, h, mmW, mmH, cropScale);
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
      const textEditsForPdf: Record<string, Partial<Memory>> = {};
      for (const [id, e] of Object.entries(localEdits)) {
        if (e.content !== undefined) textEditsForPdf[id] = { content: e.content };
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
            coverPhotoUrl,
            coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
            coverYearLabel,
            chapterTitle: chapterTitleLine ?? 'Notre histoire',
            pages,
            rotations,
            photoCrops,
            localEdits: textEditsForPdf,
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
      localEdits,
      pages,
      photoCrops,
      rotations,
      router,
      bookId,
      coverPhotoUrl,
    ]
  );

  const goToBookOrderPdf = useCallback(() => {
    if (!child || exporting || guestExportSubmitting) return;
    const textEditsForPdf: Record<string, Partial<Memory>> = {};
    for (const [id, e] of Object.entries(localEdits)) {
      if (e.content !== undefined) textEditsForPdf[id] = { content: e.content };
    }
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
      coverPhotoUrl,
      coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
      coverYearLabel,
      chapterTitle: chapterTitleLine ?? 'Notre histoire',
      pages,
      rotations,
      photoCrops,
      localEdits: textEditsForPdf,
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
    coverPhotoUrl,
    coverTitleLine,
    coverYearLabel,
    exporting,
    guestExportSubmitting,
    localEdits,
    pages,
    photoCrops,
    rotations,
    router,
  ]);

  const goToBookOrderPrint = useCallback(() => {
    if (exporting || guestExportSubmitting || !child) return;
    const textEditsForPdf: Record<string, Partial<Memory>> = {};
    for (const [id, e] of Object.entries(localEdits)) {
      if (e.content !== undefined) textEditsForPdf[id] = { content: e.content };
    }
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
      coverPhotoUrl,
      coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
      coverYearLabel,
      chapterTitle: chapterTitleLine ?? 'Notre histoire',
      pages,
      rotations,
      photoCrops,
      localEdits: textEditsForPdf,
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
    coverPhotoUrl,
    coverTitleLine,
    coverYearLabel,
    exporting,
    guestExportSubmitting,
    localEdits,
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
      const textEditsForPdf: Record<string, Partial<Memory>> = {};
      for (const [id, e] of Object.entries(localEdits)) {
        if (e.content !== undefined) textEditsForPdf[id] = { content: e.content };
      }
      try {
        const mode = pendingGuestExportMode.current;
        const { localUri } = await generateBookPdfViaServerAsGuest({
          bookId: bookId ?? `draft-${child.id}`,
          childId: child.id,
          child,
          coverPhotoUrl,
          coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
          coverYearLabel,
          chapterTitle: chapterTitleLine ?? 'Notre histoire',
          pages,
          rotations,
          photoCrops,
          localEdits: textEditsForPdf,
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
      coverPhotoUrl,
      coverTitleLine,
      coverYearLabel,
      localEdits,
      pages,
      photoCrops,
      rotations,
    ]
  );

  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm500 = fontsLoaded ? 'DMSans_500Medium' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dm700 = fontsLoaded ? 'DMSans_700Bold' : undefined;

  const showManyDots = pages.length > 28;

  if (loading && !child) {
    return (
      <View style={[styles.loadingRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
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
          {child.name} · {pages.length} pages
        </Text>
        {isLandscape ? (
          <View style={styles.headerRightSpacer} accessibilityElementsHidden />
        ) : (
          <Pressable
            onPress={() => void handleExportBook()}
            hitSlop={12}
            style={[styles.headerCta, (exporting || guestExportSubmitting) && { opacity: 0.5 }]}
            disabled={exporting || guestExportSubmitting}
            accessibilityRole="button"
          >
            <Text style={[styles.headerCtaText, dm700 && { fontFamily: dm700 }]}>
              {exporting || guestExportSubmitting ? 'Export…' : 'Exporter'}
            </Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingMid}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}

      {error ? (
        <Text style={styles.bannerErr}>{error}</Text>
      ) : null}

      <FlatList
        ref={listRef}
        key={isLandscape ? 'spread' : 'page'}
        data={isLandscape ? spreadRows : pageRows}
        keyExtractor={(_, i) => i.toString()}
        renderItem={isLandscape ? (renderSpreadItem as any) : (renderPageItem as any)}
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

      {!isLandscape ? (
        <View style={styles.bottomBar}>
          <View style={styles.bottomIndicatorRow}>
            {showManyDots ? (
              <Text style={[styles.pageFraction, dm400 && { fontFamily: dm400 }]}>
                {currentPageIndex + 1} / {Math.max(1, totalSlides)}
              </Text>
            ) : (
              <View style={styles.dotsRow}>
                {pageRows.map((_, i) => (
                  <View
                    key={i.toString()}
                    style={i === currentPageIndex ? styles.dotActive : styles.dotIdle}
                  />
                ))}
              </View>
            )}
            <Text style={[styles.bottomPageLabel, dm400 && { fontFamily: dm400 }]}>
              {pages.length > 0 ? pageLabel(currentPageIndex + 1, pages.length) : ''}
            </Text>
          </View>
          <View style={styles.bottomButtonsRow}>
            {canDeletePage ? (
              <Pressable
                style={styles.pill}
                onPress={handleDeleteCurrentPage}
                accessibilityRole="button"
              >
                <View style={styles.pillInner}>
                  <Trash2 size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />
                  <Text style={[styles.pillText, dm400 && { fontFamily: dm400 }]}>Supprimer</Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.pill, !editOk && styles.pillDisabled]}
              onPress={handleToolbarEdit}
              disabled={!editOk}
              accessibilityRole="button"
            >
              <View style={styles.pillInner}>
                <Pencil size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />
                <Text style={[styles.pillText, dm400 && { fontFamily: dm400 }]}>Modifier</Text>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      {isTitleBodyModal ? (
        <EditTextModal
          key={editModalKey}
          variant="title-body"
          visible={textEditTarget != null}
          title={textEditTarget?.modalTitle ?? ''}
          titleFieldLabel="Titre"
          bodyFieldLabel={
            textEditTarget?.kind === 'memory' && textEditTarget.textMode === 'video'
              ? 'Description'
              : 'Texte'
          }
          initialTitle={editModalTitleBodyInitial.title}
          initialBody={editModalTitleBodyInitial.body}
          onClose={() => setTextEditTarget(null)}
          onSave={saveTitleBodyEdit}
        />
      ) : (
        <EditTextModal
          key={editModalKey}
          visible={textEditTarget != null}
          initialText={editModalSingleInitial}
          title={textEditTarget?.modalTitle ?? ''}
          onClose={() => setTextEditTarget(null)}
          onSave={saveSingleEdit}
        />
      )}

      <Modal visible={coverPickerOpen} animationType="slide" onRequestClose={() => setCoverPickerOpen(false)}>
        <View style={[styles.coverPickerRoot, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.coverPickerHeader}>
            <Text style={styles.coverPickerTitle}>Choisir la couverture</Text>
            <Pressable onPress={() => setCoverPickerOpen(false)} hitSlop={12} accessibilityRole="button">
              <X size={20} color="#FFFFFF" strokeWidth={2.2} />
            </Pressable>
          </View>
          <FlatList
            data={favoriteCoverThumbs}
            keyExtractor={(it) => it.source}
            numColumns={3}
            columnWrapperStyle={{ gap: 2 }}
            contentContainerStyle={{ paddingHorizontal: 2, gap: 2 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pickCover(item.source)}
                style={({ pressed }) => [{ flex: 1 / 3, aspectRatio: 1, opacity: pressed ? 0.9 : 1 }]}
                accessibilityRole="button"
              >
                <Image source={{ uri: item.thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </Pressable>
            )}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#FFFFFF" />
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
      </Modal>

      {bookCropSession ? (
        <BookPhotoCropModal
          key={`${bookCropSession.storageKey}-${bookCropSession.uri}`}
          visible
          uri={bookCropSession.uri}
          frameW={bookCropSession.frameW}
          frameH={bookCropSession.frameH}
          imgPxW={bookCropSession.imgPxW}
          imgPxH={bookCropSession.imgPxH}
          printMmW={bookCropSession.printMmW}
          printMmH={bookCropSession.printMmH}
          onChangePhoto={
            bookCropSession.pageType === 'cover'
              ? () => {
                  setBookCropSession(null);
                  setCoverPickerOpen(true);
                }
              : undefined
          }
          initialCrop={photoCrops[bookCropSession.storageKey]}
          onCancel={() => setBookCropSession(null)}
          onConfirm={crop => {
            setBookCropSession(prev => {
              if (prev) upsertPhotoCrop(prev.storageKey, crop);
              return null;
            });
          }}
        />
      ) : null}

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
    backgroundColor: '#1C1C1E',
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: '#1C1C1E',
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
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  guardText: {
    color: 'rgba(255,255,255,0.85)',
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
    color: '#C4784A',
    fontWeight: '500',
    fontSize: 16,
  },
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,17,17,0.95)',
  },
  headerBack: {
    color: '#C4784A',
    fontSize: 15,
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerCta: {
    backgroundColor: '#C4784A',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  headerCtaText: {
    color: '#FFFFFF',
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
  pageSlide: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#1C1C1E',
  },
  pageSlideSpread: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
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
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  bottomBar: {
    backgroundColor: 'rgba(10,10,14,0.96)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  bottomIndicatorRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  bottomPageLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
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
    color: 'rgba(255,255,255,0.45)',
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
    backgroundColor: '#C4784A',
  },
  dotIdle: {
    width: 5,
    height: 5,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
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
    color: 'rgba(255,255,255,0.7)',
  },
  coverPickerRoot: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  coverPickerHeader: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coverPickerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

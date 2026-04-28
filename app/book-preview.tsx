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
  type ViewToken,
  type ListRenderItem,
} from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Pencil, Trash2, X } from 'lucide-react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
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
import { getChildren, getOrSelectFirstChild } from '@/services/children';
import { getMemories } from '@/services/media';
import { loadBookSelectionKeys, memoryIdFromBookSelectionKey } from '@/services/bookSelection';
import { dedupeMemoryIds, getBook, upsertBook } from '@/services/books';
import { generateBookPdf, shareBookPdf, type BookPdfInput } from '@/services/bookPdf';
import {
  generateBookPdfViaServer,
  generateBookPdfViaServerAsGuest,
  isBookPdfServerConfigured,
  isInitExportConfigured,
  validateGuestExportMedia,
} from '@/services/bookPdfServer';
import { GuestPdfExportModal } from '@/components/GuestPdfExportModal';
import { parseFavoritePhotoUrls, mapPhotoUrlToThumb, getAllPhotoUrls } from '@/utils/memoryPhotos';

import type { Child, Memory } from '@/types/local';
import { getUserTier } from '@/lib/userTier';
import { canExportBookPdfViaServer } from '@/lib/digitalExportPurchase';
import { setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { setPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import { supabase } from '@/lib/supabase';

const HEADER_H = 44;
const BOTTOM_H = 82;
const QR_BASE = 'https://petitmo.app/m';
const MIN_BOOK_SELECTION_KEYS = 5;
const MAX_BOOK_SELECTION_KEYS = 80;

type PageRow = { page: BookPage; pageNum: number };

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
  const [exportProgress, setExportProgress] = useState('');
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
    pageType: 'cover' | 'photo-full' | 'photo-note';
    imgPxW: number;
    imgPxH: number;
    printMmW: number;
    printMmH: number;
  } | null>(null);

  const listRef = useRef<FlatList<PageRow>>(null);

  const pages = useMemo(() => {
    if (!child) return [];
    return buildBookPages(child, bookMemories);
  }, [child, bookMemories]);

  const pageRows = useMemo(
    () => pages.map((page, i) => ({ page, pageNum: i + 1 })),
    [pages]
  );

  const coverYearLabel = useMemo(() => coverJournalPeriodLabel(bookMemories), [bookMemories]);

  const availH =
    screenHeight - HEADER_H - BOTTOM_H - insets.top - insets.bottom;

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
        setCoverPhotoUrl((b.coverPhotoUrl ?? null) ? (b.coverPhotoUrl ?? null) : null);
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
      const cached = imagePxCache[uri];
      if (cached) return cached;
      const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        Image.getSize(
          uri,
          (w, h) => resolve({ w, h }),
          err => reject(err)
        );
      });
      setImagePxCache(prev => ({ ...prev, [uri]: size }));
      return size;
    },
    [imagePxCache]
  );

  function printFrameMmFor(pageType: 'cover' | 'photo-full' | 'photo-note'): { w: number; h: number } {
    const pageWmm = 154;
    const pageHmm = 216;
    if (pageType === 'cover') return { w: pageWmm, h: 142 };
    if (pageType === 'photo-note') return { w: pageWmm, h: pageHmm * 0.6 };
    return { w: pageWmm, h: pageHmm };
  }

  const openBookCrop = useCallback(
    (payload: { storageKey: string; uri: string; frameW: number; frameH: number; pageType: 'cover' | 'photo-full' | 'photo-note' }) => {
      void (async () => {
        const mm = printFrameMmFor(payload.pageType);
        try {
          const px = await getImagePx(payload.uri);
          setBookCropSession({ ...payload, imgPxW: px.w, imgPxH: px.h, printMmW: mm.w, printMmH: mm.h });
        } catch {
          setBookCropSession({ ...payload, imgPxW: 0, imgPxH: 0, printMmW: mm.w, printMmH: mm.h });
        }
      })();
    },
    [getImagePx]
  );

  useEffect(() => {
    void (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        /* */
      }
    })();
    return () => {
      void (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } catch {
          /* */
        }
      })();
    };
  }, []);

  const unlockAndBack = useCallback(() => {
    void (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        /* */
      }
      router.replace('/(tabs)/livres');
    })();
  }, [router]);

  const unlockAndGoToFavoris = useCallback(() => {
    void (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        /* */
      }
      router.replace('/(tabs)/favoris');
    })();
  }, [router]);

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

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ix = viewableItems[0]?.index;
      if (typeof ix === 'number') setCurrentPageIndex(ix);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 55,
  }).current;

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
          height={availH}
          child={child!}
          memory={m}
          rotation={rot}
          photoCrop={
            page.type === 'photo-full' || page.type === 'photo-note' ? photoCrops[m?.id ?? ''] : undefined
          }
          truncated={false}
          coverYearLabel={coverYearLabel}
          coverDisplayTitle={page.type === 'cover' ? coverDisplayTitle : undefined}
          coverPhotoUri={page.type === 'cover' ? coverPhotoUrl : null}
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
            if (m && (page.type === 'photo-full' || page.type === 'photo-note')) {
              onRotateMemory(m.id);
            }
          }}
          onRequestTextEdit={openTextEditForThisPage}
          qrUrl={qrUrl}
        />
      );
    },
    [
      availH,
      child,
      coverPhotoUrl,
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
    ({ item }) => (
      <View style={[styles.pageSlide, { width: screenWidth, height: availH }]}>
        {renderMaquettePage(item)}
      </View>
    ),
    [availH, renderMaquettePage, screenWidth]
  );

  const currentPage = pageRows[currentPageIndex]?.page;

  const photoOk =
    currentPage?.type === 'photo-full' || currentPage?.type === 'photo-note';
  const editOk =
    currentPage?.type === 'cover' ||
    currentPage?.type === 'chapter' ||
    currentPage?.type === 'photo-full' ||
    currentPage?.type === 'photo-note' ||
    currentPage?.type === 'quote' ||
    currentPage?.type === 'audio' ||
    currentPage?.type === 'video';

  const canDeletePage =
    currentPage?.type === 'photo-full' ||
    currentPage?.type === 'photo-note' ||
    currentPage?.type === 'quote' ||
    currentPage?.type === 'audio' ||
    currentPage?.type === 'video';

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
      if (isBookPdfServerConfigured()) {
        const can = await canExportBookPdfViaServer();
        if (!can) {
          router.push({
            pathname: '/paywall',
            params: { context: 'EXPORT_DIGITAL_PDF', childName: child.name },
          });
          return;
        }
      } else if (!__DEV__) {
        const tier = await getUserTier();
        if (tier === 'free') {
          router.push({ pathname: '/paywall', params: { context: 'EXPORT_PAYWALL' } });
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

      if (isBookPdfServerConfigured()) {
        if (accessToken) {
          setExporting(true);
          setExportProgress('Génération du PDF (serveur)…');
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
            setExportProgress('');
            setExporting(false);
            await shareBookPdf(localUri);
          } catch (e) {
            setExporting(false);
            setExportProgress('');
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Export impossible');
          }
          return;
        }

        try {
          validateGuestExportMedia({
            pages,
            localEdits: textEditsForPdf,
            coverPhotoUrl,
            child,
          });
        } catch (ve) {
          Alert.alert('Export sans compte', ve instanceof Error ? ve.message : 'Médias non prêts');
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
        return;
      }

      setExporting(true);
      setExportProgress('Chargement des images…');

      try {
        let authToken: string | null = null;
        try {
          const { data } = await supabase.auth.getSession();
          authToken = data.session?.access_token ?? null;
        } catch {
          authToken = null;
        }

        const pdfInput: BookPdfInput = {
          pages,
          child,
        coverPhotoUrl,
          authToken,
          coverTitle: coverTitleLine ?? `Journal de ${child.name}`,
          coverYearLabel,
          chapterTitle: chapterTitleLine ?? 'Notre histoire',
          rotations,
          photoCrops,
          textEdits: textEditsForPdf,
          qrBaseUrl: QR_BASE,
          exportMode,
          onProgress: (cur, total) => {
            setExportProgress(`Image ${cur}/${total}…`);
          },
        };

        setExportProgress('Génération du PDF…');
        const pdfUri = await generateBookPdf(pdfInput);
        setExportProgress('');
        setExporting(false);
        await shareBookPdf(pdfUri);
      } catch (e) {
        setExporting(false);
        setExportProgress('');
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Export impossible');
      }
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

  const handleExportPdf = useCallback(() => {
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
    Alert.alert('Exporter', 'Choisis un format.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'PDF', onPress: () => void doExportPdf('screen') },
      { text: 'PDF impression', onPress: () => void doExportPdf('print') },
      {
        text: 'Commander le PDF (formulaire)',
        onPress: () => goToBookOrderPdf(),
      },
      {
        text: 'Commander l’imprimé',
        onPress: () =>
          router.push({
            pathname: '/book-order',
            params: {
              bookId: bookId ?? `draft-${child.id}`,
              childId: child.id,
              memoryPageCount: String(memoryPageCountForOrder),
              avPageCount: String(avPageCountForOrder),
              exportMode: 'print',
            },
          }),
      },
    ]);
  }, [bookId, child?.id, doExportPdf, exporting, goToBookOrderPdf, guestExportSubmitting, pages, router]);

  const onGuestExportSubmit = useCallback(
    async ({ email, marketingOptIn }: { email: string; marketingOptIn: boolean }) => {
      if (!child) return;
      setGuestExportSubmitting(true);
      setExportProgress('Génération du PDF (serveur)…');
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
        setGuestExportModalVisible(false);
        setExportProgress('');
        await setLastGuestExportEmail(email);
        await shareBookPdf(localUri);
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Export impossible');
      } finally {
        setGuestExportSubmitting(false);
        setExportProgress('');
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
        <Pressable
          onPress={() => void handleExportPdf()}
          hitSlop={12}
          style={[styles.headerCta, (exporting || guestExportSubmitting) && { opacity: 0.5 }]}
          disabled={exporting || guestExportSubmitting}
          accessibilityRole="button"
        >
          <Text style={[styles.headerCtaText, dm700 && { fontFamily: dm700 }]}>
            {exporting || guestExportSubmitting ? 'Export…' : 'Exporter PDF'}
          </Text>
        </Pressable>
      </View>

      {(loading || exporting || guestExportSubmitting) ? (
        <View style={styles.loadingMid}>
          <ActivityIndicator color="#FFFFFF" />
          {(exporting || guestExportSubmitting) && exportProgress ? (
            <Text style={styles.exportProgressText}>{exportProgress}</Text>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.bannerErr}>{error}</Text>
      ) : null}

      <FlatList
        ref={listRef}
        data={pageRows}
        keyExtractor={(_, i) => i.toString()}
        renderItem={renderPageItem}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        // IMPORTANT perf: éviter un nouvel objet `extraData` à chaque render (a-coups).
        // Les items se rerender déjà via `renderItem`/closures quand l'écran rerender.
        style={styles.list}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
      />

      <View style={styles.bottomBar}>
        <View style={styles.bottomIndicatorRow}>
          {showManyDots ? (
            <Text style={[styles.pageFraction, dm400 && { fontFamily: dm400 }]}>
              {currentPageIndex + 1} / {pages.length}
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
  exportProgressText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 4,
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
  list: {
    flex: 1,
  },
  pageSlide: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#1C1C1E',
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

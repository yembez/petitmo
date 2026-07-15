import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import {
  deleteLocalBook,
  getLocalBook,
  getLocalChild,
  getLocalMemoryById,
  listLocalBooks,
  listLocalChildren,
  updateLocalMemoryFavoritePhotoUrls,
  upsertLocalBook,
  type LocalBookRow,
} from '@/lib/localDb';
import { awaitPhotoPrintDerivativesForMemory } from '@/services/memoryLocalStore';
import { getFamilyMemories, hydrateMemoriesByIds, toggleFavorite, uploadMedia } from '@/services/media';
import { materializeCloudMediaToSandboxForMemory } from '@/services/memoryCloudMaterialize';
import { getUserTier } from '@/lib/userTier';
import { supabase } from '@/lib/supabase';
import {
  FREE_TIER_BOOK_AUDIO_MAX_COUNT,
  FREE_TIER_BOOK_VIDEO_MAX_COUNT,
  FREE_TIER_BOOK_VOICE_MAX_DURATION,
  FREE_TIER_VIDEO_MAX_DURATION,
} from '@/lib/limits';
import { Platform } from 'react-native';
import { copyAsync, documentDirectory, downloadAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  canonicalBookCoverPhotoRef,
  getAlbumCanonicalFavoriteUrls,
  getAllPhotoUrlsForFeed,
  getBookPhotoPrintUri,
  getPrimaryPhotoUriForBookPreview,
  indexOfPhotoUrlInFeed,
  isPhotoUrlFavoritedWithVariants,
  mapPhotoUrlToThumb,
  memoryPhotoMatchesUrl,
  normalizeMemoryMediaUriForDisplay,
  parseFavoritePhotoUrls,
  pickPhotoUriForOverlayPalette,
} from '@/utils/memoryPhotos';

export type BookCoverUriVariant = 'list' | 'editor' | 'print';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  isSandboxUriFromForeignContainer,
  rebaseSandboxUriToCurrentContainer,
} from '@/utils/localMediaReadable';
import type { Child, Memory } from '@/types/local';
import { peekSelectedChildIdLastKnown } from '@/services/children';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';

/** Chemin local SQLite souvent invalide après sync cloud / autre appareil — ne pas l’afficher tel quel. */
function looksLikeStaleLocalCoverRef(ref: string): boolean {
  const t = ref.trim();
  if (!t || isCloudMediaReference(t)) return false;
  return (
    t.includes('petitmo_memories/') ||
    t.startsWith('file://') ||
    isSandboxUriFromForeignContainer(t)
  );
}

function bookCoverMatchesMemory(memory: Memory, coverRef: string): boolean {
  const ref = coverRef.trim();
  if (!ref || memory.type !== 'photo') return false;
  if (memoryPhotoMatchesUrl(memory, ref)) return true;
  const favs = parseFavoritePhotoUrls(memory);
  return favs.length > 0 && isPhotoUrlFavoritedWithVariants(memory, favs, ref);
}

function freshCoverUriFromMatchedMemory(
  memory: Memory,
  coverRef: string,
  variant: BookCoverUriVariant,
): string | null {
  if (memory.type !== 'photo') return null;
  if (variant === 'list') {
    const light = mapPhotoUrlToThumb(memory, coverRef).trim();
    if (light) return normalizeMemoryMediaUriForDisplay(light);
    const palette = pickPhotoUriForOverlayPalette(memory);
    if (palette) return palette;
  }
  if (variant === 'editor') {
    const slots = getAllPhotoUrlsForFeed(memory);
    const idx = coverRef.trim() ? indexOfPhotoUrlInFeed(memory, coverRef) : 0;
    const slot = idx >= 0 ? slots[idx] : slots[0];
    if (slot) return normalizeMemoryMediaUriForDisplay(slot);
  }
  if (variant === 'print') {
    const printUri = getBookPhotoPrintUri(memory, coverRef);
    if (printUri) return printUri;
    return null;
  }
  const fallback = normalizeMemoryMediaUriForDisplay(coverRef.trim());
  return fallback || null;
}

/** URI print pour une couverture choisie (favori / galerie) — conserve le bon slot d’album. */
export function resolveCoverPrintUriFromPick(pickUri: string, memoryIds: readonly string[]): string {
  const trimmed = pickUri.trim();
  if (!trimmed) return '';
  for (const memoryId of memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (!m || m.type !== 'photo' || !bookCoverMatchesMemory(m, trimmed)) continue;
    return getBookPhotoPrintUri(m, trimmed) || normalizeMemoryMediaUriForDisplay(trimmed) || trimmed;
  }
  return normalizeMemoryMediaUriForDisplay(trimmed) || trimmed;
}

function resolveCoverFromBookFavorites(
  book: Book,
  coverRef: string,
  variant: BookCoverUriVariant,
): string | null {
  const ref = coverRef.trim();
  for (const memoryId of book.memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (!m || m.type !== 'photo') continue;
    const favs = parseFavoritePhotoUrls(m);
    const sources =
      favs.length > 0 ? favs : m.is_favorite ? getAlbumCanonicalFavoriteUrls(m) : [];
    if (sources.length === 0) continue;

    if (ref && bookCoverMatchesMemory(m, ref)) {
      const uri = freshCoverUriFromMatchedMemory(m, ref, variant);
      if (uri) return uri;
      continue;
    }

    if (!ref) {
      const first = sources[0]?.trim();
      if (first) {
        const uri = freshCoverUriFromMatchedMemory(m, first, variant);
        if (uri) return uri;
      }
    }
  }
  return null;
}

export type FreeTierBookMemoryRow = {
  id: string;
  type: string;
  duration?: number | null;
};

/**
 * Garde-fou plan gratuit : quotas audio/vidéo **dans un livre** (composition locale OK).
 * QR cloud (audio + vidéo) : upload **après paiement** commande livre ou export PDF uniquement.
 * Spec : docs/specs/free-tier-book-qr-av.md
 */
export async function validateFreeTierBookMemoryLimits(
  memories: readonly FreeTierBookMemoryRow[],
): Promise<void> {
  const tier = await getUserTier();
  if (tier !== 'free') return;

  const videos = memories.filter(m => m.type === 'video');
  if (videos.length > FREE_TIER_BOOK_VIDEO_MAX_COUNT) {
    throw new Error(
      `Avec le plan gratuit, ce livre peut contenir au maximum ${FREE_TIER_BOOK_VIDEO_MAX_COUNT} souvenirs vidéo.`,
    );
  }
  const tooLongVideo = videos.find(m => (m.duration ?? 0) > FREE_TIER_VIDEO_MAX_DURATION);
  if (tooLongVideo) {
    throw new Error(
      `Avec le plan gratuit, chaque souvenir vidéo est limité à ${FREE_TIER_VIDEO_MAX_DURATION} secondes.`,
    );
  }

  const audios = memories.filter(m => m.type === 'voice');
  if (audios.length > FREE_TIER_BOOK_AUDIO_MAX_COUNT) {
    throw new Error(
      `Avec le plan gratuit, ce livre peut contenir au maximum ${FREE_TIER_BOOK_AUDIO_MAX_COUNT} souvenirs audio.`,
    );
  }
  const tooLongAudio = audios.find(m => (m.duration ?? 0) > FREE_TIER_BOOK_VOICE_MAX_DURATION);
  if (tooLongAudio) {
    throw new Error(
      `Avec le plan gratuit, chaque souvenir audio est limité à ${FREE_TIER_BOOK_VOICE_MAX_DURATION} secondes.`,
    );
  }
}

/** Garde-fou plan gratuit : vidéo / quota audio dans un livre. */
async function assertBookMemoriesAllowedForTier(allMemoryIds: readonly string[]): Promise<void> {
  const memories = allMemoryIds
    .map(id => getLocalMemoryById(id))
    .filter(Boolean) as FreeTierBookMemoryRow[];
  await validateFreeTierBookMemoryLimits(memories);
}

export type Book = {
  id: string;
  /** Nom affiché dans les pilules / modales */
  title: string;
  createdAt: string;
  /** Souvenirs inclus dans ce livre (un souvenir peut être dans plusieurs livres) */
  memoryIds: string[];
  /** URL de la photo de couverture (sinon fallback photo enfant / souvenirs). */
  coverPhotoUrl?: string | null;
  /** Rotation appliquée à chaque photo (memoryId → degrés, multiples de 90). */
  rotations?: Record<string, number>;
  /**
   * Recadrage photo (pan + zoom) stocké en valeurs relatives.
   * - `xPct` / `yPct`: translation en % du cadre (peut être négatif/positif).
   * - `scale`: zoom (>= 1).
   *
   * Clé spéciale `cover` pour la couverture, sinon `memoryId`.
   */
  photoCrops?: Record<string, { xPct: number; yPct: number; scale: number }>;
  /** Modifications de contenu textuel (memoryId → champs modifiés). */
  textEdits?: Record<string, { content?: string | null }>;
  /** Titre personnalisé des pages chapitre (null = « Notre histoire »). */
  chapterTitle?: string | null;
};

const STORAGE_KEY = '@petitmo_books_v1';
/** Supprime côté cloud en attente (hors-ligne / échec réseau) : `restore` ignore ces ids. */
const PENDING_BOOK_DELETE_IDS_KEY = '@petitmo_pending_book_delete_ids';

function booksTable(): ReturnType<typeof supabase.from> {
  return (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from('books');
}

async function getPendingBookDeleteIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_BOOK_DELETE_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(s => s.trim()));
  } catch {
    return new Set();
  }
}

async function addPendingBookDeleteId(bookId: string): Promise<void> {
  const id = bookId.trim();
  if (!id) return;
  const s = await getPendingBookDeleteIds();
  s.add(id);
  await AsyncStorage.setItem(PENDING_BOOK_DELETE_IDS_KEY, JSON.stringify([...s]));
}

async function removePendingBookDeleteIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const s = await getPendingBookDeleteIds();
  for (const id of ids) s.delete(id.trim());
  await AsyncStorage.setItem(PENDING_BOOK_DELETE_IDS_KEY, JSON.stringify([...s]));
}

/**
 * Tente de supprimer sur Supabase les livres marqués « supprimés localement » mais pas encore retirés du cloud.
 * À appeler avant `restoreBooksFromSupabaseIfPremium` au démarrage.
 */
export async function flushPendingBookDeletesToSupabase(): Promise<void> {
  const tier = await getUserTier();
  if (tier !== 'paid') return;
  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;
  const pending = [...(await getPendingBookDeleteIds())];
  if (pending.length === 0) return;
  const removed: string[] = [];
  for (const id of pending) {
    const { error } = await booksTable().delete().eq('id', id).eq('user_id', user.id);
    if (!error) removed.push(id);
  }
  await removePendingBookDeleteIds(removed);
}

async function deleteRemoteBookIfPremium(bookId: string): Promise<void> {
  const tier = await getUserTier();
  if (tier !== 'paid') return;
  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;
  const { error } = await booksTable().delete().eq('id', bookId).eq('user_id', user.id);
  if (error) throw error;
}

function safeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBook(raw: unknown): Book | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const title = typeof r.title === 'string' ? r.title : 'Livre';
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString();
  const memoryIds = Array.isArray(r.memoryIds)
    ? (r.memoryIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  const rotations: Record<string, number> = {};
  if (r.rotations && typeof r.rotations === 'object') {
    for (const [k, v] of Object.entries(r.rotations as Record<string, unknown>)) {
      if (typeof v === 'number' && v % 90 === 0) rotations[k] = v % 360;
    }
  }

  const photoCrops: Record<string, { xPct: number; yPct: number; scale: number }> = {};
  // Nouveau format
  if (r.photoCrops && typeof r.photoCrops === 'object') {
    for (const [k, v] of Object.entries(r.photoCrops as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const entry = v as Record<string, unknown>;
      const xPct = typeof entry.xPct === 'number' ? entry.xPct : 0;
      const yPct = typeof entry.yPct === 'number' ? entry.yPct : 0;
      const scale = typeof entry.scale === 'number' ? entry.scale : 1;
      if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !Number.isFinite(scale)) continue;
      photoCrops[k] = { xPct, yPct, scale: Math.max(1, scale) };
    }
  }
  // Migration depuis l'ancien format simple (top/center/bottom)
  if (Object.keys(photoCrops).length === 0 && r.crops && typeof r.crops === 'object') {
    for (const [k, v] of Object.entries(r.crops as Record<string, unknown>)) {
      if (v === 'top') photoCrops[k] = { xPct: 0, yPct: -15, scale: 1 };
      else if (v === 'bottom') photoCrops[k] = { xPct: 0, yPct: 15, scale: 1 };
      else if (v === 'center') photoCrops[k] = { xPct: 0, yPct: 0, scale: 1 };
    }
  }

  const textEdits: Record<string, { content?: string | null }> = {};
  if (r.textEdits && typeof r.textEdits === 'object') {
    for (const [k, v] of Object.entries(r.textEdits as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const entry = v as Record<string, unknown>;
        if ('content' in entry) {
          textEdits[k] = {
            content: typeof entry.content === 'string' ? entry.content : null,
          };
        }
      }
    }
  }

  const chapterTitle =
    typeof r.chapterTitle === 'string' && r.chapterTitle.trim().length > 0
      ? r.chapterTitle.trim()
      : null;

  const coverPhotoUrl =
    typeof r.coverPhotoUrl === 'string' && r.coverPhotoUrl.trim().length > 0
      ? r.coverPhotoUrl.trim()
      : null;

  return {
    id: r.id,
    title: title.trim() || 'Livre',
    createdAt,
    memoryIds: uniq(memoryIds),
    coverPhotoUrl,
    rotations: Object.keys(rotations).length > 0 ? rotations : undefined,
    photoCrops: Object.keys(photoCrops).length > 0 ? photoCrops : undefined,
    textEdits: Object.keys(textEdits).length > 0 ? textEdits : undefined,
    chapterTitle,
  };
}

function uniq(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = x.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function readAll(): Promise<Book[]> {
  return listLocalBooks();
}

async function writeAll(books: Book[]): Promise<void> {
  // Compat: convertit vers SQLite (écriture atomique par livre)
  for (const b of books) {
    const normalized = normalizeBook(b) ?? b;
    upsertLocalBook({
      id: normalized.id,
      title: normalized.title,
      createdAt: normalized.createdAt,
      memoryIds: normalized.memoryIds,
      coverPhotoUrl: normalized.coverPhotoUrl ?? null,
      rotations: normalized.rotations,
      photoCrops: normalized.photoCrops,
      textEdits: normalized.textEdits,
      chapterTitle: normalized.chapterTitle ?? null,
    });
  }
}

/** Lecture SQLite synchrone (même tri que `listBooks`) pour préchauffe des onglets sans attendre l’auth. */
export function listBooksFromSqliteSync(): Book[] {
  const raw = listLocalBooks();
  const books: Book[] = [];
  for (const row of raw) {
    const b = normalizeBook(row);
    if (b) books.push(b);
  }
  return books.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function listBooks(): Promise<Book[]> {
  return listBooksFromSqliteSync();
}

/**
 * Résout l’URI affichable d’une couverture livre après redémarrage / changement de container iOS.
 *
 * `coverPhotoUrl` stocke souvent `local_print_path` : si ce fichier est absent ou illisible, on
 * retrouve le souvenir photo correspondant et on renvoie une variante encore présente (`display`/`thumb`
 * ou `print` pour l’aperçu). Les couvertures galerie sont persistées sous `petitmo_memories/book_covers/`.
 */
/** Chemin sandbox de la copie dédiée `petitmo_memories/book_covers/{bookId}.jpg` (rebasé sur le container courant). */
export function dedicatedBookCoverUriForBook(bookId: string): string | null {
  if (Platform.OS === 'web' || !documentDirectory) return null;
  const raw = `${documentDirectory}petitmo_memories/book_covers/${bookId}.jpg`;
  const rebased = rebaseSandboxUriToCurrentContainer(raw);
  return normalizeMemoryMediaUriForDisplay(rebased) || rebased || null;
}

/** Souvenir photo dont l’URL (ou favori) correspond à `coverRef`. */
export function findPhotoMemoryByCoverRef(
  coverRef: string,
  memoryIds: readonly string[],
): Memory | null {
  const ref = coverRef.trim();
  if (!ref) return null;
  for (const memoryId of memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (m?.type === 'photo' && bookCoverMatchesMemory(m, ref)) return m;
  }
  return null;
}

export function findBookCoverMemory(book: Book): Memory | null {
  const direct = (book.coverPhotoUrl ?? '').trim();
  if (direct) {
    for (const memoryId of book.memoryIds) {
      const m = getLocalMemoryById(memoryId);
      if (m && m.type === 'photo' && bookCoverMatchesMemory(m, direct)) return m;
    }
  }
  const photoMemories = book.memoryIds
    .map(id => getLocalMemoryById(id))
    .filter((m): m is Memory => m?.type === 'photo');
  if (photoMemories.length === 1) return photoMemories[0]!;
  return null;
}

export function resolveBookCoverDisplayUri(
  book: Book,
  { variant = 'list' }: { variant?: BookCoverUriVariant } = {},
): string | null {
  const direct = (book.coverPhotoUrl ?? '').trim();
  const legacyBookCovers = direct.includes('petitmo_memories/book_covers/');

  if (legacyBookCovers) {
    const byBookId = dedicatedBookCoverUriForBook(book.id);
    if (byBookId) return byBookId;
    // Copie `book_covers/` absente (autre appareil) → souvenirs / cloud plus bas.
  } else if (direct) {
    for (const memoryId of book.memoryIds) {
      const m = getLocalMemoryById(memoryId);
      if (!m || m.type !== 'photo' || !bookCoverMatchesMemory(m, direct)) continue;
      const fresh = freshCoverUriFromMatchedMemory(m, direct, variant);
      if (fresh) return fresh;
    }

    const fromFavorites = resolveCoverFromBookFavorites(book, direct, variant);
    if (fromFavorites) return fromFavorites;

    if (isCloudMediaReference(direct)) {
      return normalizeMemoryMediaUriForDisplay(direct) || direct;
    }

    if (variant === 'print' || variant === 'list') {
      const dedicated = dedicatedBookCoverUriForBook(book.id);
      if (dedicated) return dedicated;
    }

    if (looksLikeStaleLocalCoverRef(direct)) {
      const cloudFallback = resolveBookCoverCloudFallbackUri(book, '', variant);
      if (cloudFallback) return cloudFallback;
      const coverMem = findBookCoverMemory(book);
      if (coverMem?.type === 'photo') {
        const canon = canonicalBookCoverPhotoRef(coverMem).trim();
        const uri = freshCoverUriFromMatchedMemory(coverMem, canon || direct, variant);
        if (uri) return uri;
      }
      return null;
    }

    return normalizeMemoryMediaUriForDisplay(direct) || null;
  }

  const fromFavorites = resolveCoverFromBookFavorites(book, '', variant);
  if (fromFavorites) return fromFavorites;

  for (const memoryId of book.memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (m?.type !== 'photo') continue;
    if (variant === 'list') {
      const light = pickPhotoUriForOverlayPalette(m);
      if (light) return light;
    }
    if (variant === 'editor') {
      const slot = getAllPhotoUrlsForFeed(m)[0];
      if (slot) return normalizeMemoryMediaUriForDisplay(slot);
    }
    const uri = getPrimaryPhotoUriForBookPreview(m);
    if (uri) return uri;
  }

  return null;
}

/** URI couverture pour la **liste** des livres (petite vignette) : variante légère privilégiée. */
export function resolveBookListCoverDisplayUri(book: Book): string | null {
  return resolveBookCoverDisplayUri(book, { variant: 'list' });
}

/** URI couverture pour l’**éditeur** (recadrage = fichier display du slot choisi). */
export function resolveBookCoverEditorUri(book: Book): string | null {
  return resolveBookCoverDisplayUri(book, { variant: 'editor' });
}

/** URI couverture **print** (export PDF uniquement). */
export function resolveBookCoverPrintUri(book: Book): string | null {
  return resolveBookCoverDisplayUri(book, { variant: 'print' });
}

function firstNonEmptyUri(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = (c ?? '').trim();
    if (t) return t;
  }
  return '';
}

/** Repli cloud quand les fichiers sandbox de couverture sont absents. */
function resolveBookCoverCloudFallbackUri(
  book: Book,
  coverRef: string,
  variant: BookCoverUriVariant,
): string | null {
  const ref = coverRef.trim();
  for (const memoryId of book.memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (!m || m.type !== 'photo') continue;
    if (ref && !bookCoverMatchesMemory(m, ref)) continue;
    if (variant === 'list') {
      const u = firstNonEmptyUri(m.display_url, m.thumb_url, m.print_url, m.media_url);
      if (u) return normalizeMemoryMediaUriForDisplay(u);
    }
    if (variant === 'editor') {
      const u = firstNonEmptyUri(m.display_url, m.thumb_url, m.edited_media_url, m.media_url);
      if (u) return normalizeMemoryMediaUriForDisplay(u);
    }
    if (variant === 'print') {
      const u = firstNonEmptyUri(m.print_url, m.display_url, m.media_url);
      if (u) return normalizeMemoryMediaUriForDisplay(u);
    }
  }
  return null;
}

/** Copie une couverture dans `petitmo_memories/book_covers/{bookId}.jpg` (indépendant des fichiers souvenir). */
export async function persistBookCoverUri(bookId: string, sourceUri: string): Promise<string> {
  const src = sourceUri.trim();
  if (!src || Platform.OS === 'web' || !documentDirectory) return src;

  const dest = `${documentDirectory}petitmo_memories/book_covers/${bookId}.jpg`;
  const rebasedSrc = rebaseSandboxUriToCurrentContainer(src);

  if (
    rebasedSrc.includes(`book_covers/${bookId}.`) &&
    (await isLocalMediaUriReadable(rebasedSrc))
  ) {
    return rebasedSrc;
  }

  const dir = `${documentDirectory}petitmo_memories/book_covers/`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

  let downloadSrc = src;
  if (isCloudMediaReference(src)) {
    const signed = await getSignedMediaDisplayUrl(src);
    if (signed?.trim()) downloadSrc = signed.trim();
  }

  for (const from of [rebasedSrc, downloadSrc, src]) {
    const t = from.trim();
    if (!t) continue;
    if (
      !t.startsWith('content:') &&
      !t.startsWith('ph://') &&
      !/^https?:\/\//i.test(t) &&
      !isCloudMediaReference(t) &&
      !(await isLocalMediaUriReadable(t))
    ) {
      continue;
    }
    try {
      if (/^https?:\/\//i.test(t)) {
        const dl = await downloadAsync(t, dest);
        if (dl.status === 200) return dest;
        continue;
      }
      await copyAsync({ from: t, to: dest });
      return dest;
    } catch {
      /* variante suivante */
    }
  }

  return rebasedSrc || src;
}

/** URI éphémère (photothèque / galerie) — à ingérer en souvenir sandbox avant redémarrage. */
export function isGalleryPickUri(uri: string): boolean {
  const t = uri.trim();
  return (
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://')
  );
}

export type ApplyBookCoverResult = {
  book: Book;
  editorUri: string | null;
  /** Nouveau souvenir créé depuis la galerie (favori + ajout au livre). */
  importedMemoryId?: string;
};

/**
 * Applique un choix de couverture : favori existant ou import galerie → souvenir favori + copie `book_covers/`.
 */
export async function applyBookCoverFromUri(params: {
  bookId: string;
  childId: string;
  pickUri: string;
}): Promise<ApplyBookCoverResult> {
  const trimmed = params.pickUri.trim();
  const rawBook = getLocalBook(params.bookId);
  if (!rawBook) throw new Error('Livre introuvable');
  let book = normalizeBook(rawBook) ?? rawBook;

  if (!trimmed) {
    book = { ...book, coverPhotoUrl: null };
    await upsertBook(book);
    return { book, editorUri: null };
  }

  let coverRef = trimmed;
  let importedMemoryId: string | undefined;

  if (isGalleryPickUri(trimmed)) {
    const row = await uploadMedia({
      uri: trimmed,
      type: 'photo',
      childId: params.childId,
      suppressFeedEmit: false,
    });
    if (!row) throw new Error('Impossible d’importer la photo depuis la galerie.');
    const memoryId = row.id;
    importedMemoryId = memoryId;

    await toggleFavorite(memoryId, true);
    const mem = getLocalMemoryById(memoryId);
    if (mem?.type === 'photo') {
      const favRef = canonicalBookCoverPhotoRef(mem).trim();
      if (favRef) updateLocalMemoryFavoritePhotoUrls(memoryId, [favRef]);
      coverRef = favRef || trimmed;
    }

    const withMemory = await addMemoriesToBook(params.bookId, [memoryId]);
    if (withMemory) book = withMemory;

    await awaitPhotoPrintDerivativesForMemory(memoryId);
    const refreshed = getLocalMemoryById(memoryId);
    if (refreshed?.type === 'photo') {
      const favRef = canonicalBookCoverPhotoRef(refreshed).trim();
      if (favRef) {
        updateLocalMemoryFavoritePhotoUrls(memoryId, [favRef]);
        coverRef = favRef;
      }
    }
  } else {
    let owner = findPhotoMemoryByCoverRef(coverRef, book.memoryIds);
    if (!owner) {
      const all = await getFamilyMemories();
      owner = findPhotoMemoryByCoverRef(
        coverRef,
        all.map(m => m.id),
      );
    }
    if (owner && !book.memoryIds.includes(owner.id)) {
      const withMemory = await addMemoriesToBook(params.bookId, [owner.id]);
      if (withMemory) book = withMemory;
    }
  }

  const coverMem = findBookCoverMemory({ ...book, coverPhotoUrl: coverRef });
  if (coverMem?.type === 'photo' && !coverMem.local_print_path?.trim()) {
    await awaitPhotoPrintDerivativesForMemory(coverMem.id);
  }

  let printSrc = resolveCoverPrintUriFromPick(coverRef, book.memoryIds).trim();
  if (!printSrc && coverMem?.type === 'photo') {
    printSrc = getBookPhotoPrintUri(coverMem, coverRef).trim();
  }
  if (!printSrc) printSrc = coverRef;
  await persistBookCoverUri(params.bookId, printSrc);

  book = { ...book, coverPhotoUrl: coverRef };
  await upsertBook(book);

  DeviceEventEmitter.emit('petitmo:memories-invalidate');

  return {
    book,
    editorUri: resolveBookCoverEditorUri(book),
    importedMemoryId,
  };
}

/**
 * Si `memoryIds` a été vidé par erreur (ex. viewer livre + auto-save), tente une restauration
 * depuis le backup cloud Petitmo+ (dernière version distante encore peuplée).
 */
async function healBookMemoryIdsFromRemoteIfEmpty(book: Book): Promise<Book> {
  if ((book.memoryIds ?? []).length > 0) return book;

  const tier = await getUserTier();
  if (tier !== 'paid') return book;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return book;

  const { data, error } = await booksTable()
    .select('memory_ids')
    .eq('id', book.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return book;

  const remoteIds = safeStringArray((data as { memory_ids?: unknown }).memory_ids);
  if (remoteIds.length === 0) return book;

  const healed: Book = { ...(normalizeBook(book) ?? book), memoryIds: remoteIds };
  await upsertBook(healed);
  return healed;
}

function countResolvableBookMemoryIds(ids: readonly string[]): number {
  return ids.filter(id => getLocalMemoryById(id.trim())).length;
}

/**
 * Hydrate SQLite pour les ids du livre puis, si le cloud a une liste plus résolvable
 * (ex. après remap `loc_*` → UUID), réaligne `memoryIds` depuis le backup distant.
 */
export async function healBookMemoryIdsIfStale(book: Book): Promise<Book> {
  let b = await healBookMemoryIdsFromRemoteIfEmpty(book);
  const ids = dedupeMemoryIds(b.memoryIds ?? []);
  if (ids.length === 0) return b;

  await hydrateMemoriesByIds(ids);

  const localResolved = countResolvableBookMemoryIds(ids);
  if (localResolved === ids.length) return b;

  const tier = await getUserTier();
  if (tier !== 'paid') return b;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return b;

  const { data, error } = await booksTable()
    .select('memory_ids')
    .eq('id', b.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return b;

  const remoteIds = dedupeMemoryIds(safeStringArray((data as { memory_ids?: unknown }).memory_ids));
  if (remoteIds.length === 0) return b;

  await hydrateMemoriesByIds(remoteIds);
  const remoteResolved = countResolvableBookMemoryIds(remoteIds);

  if (remoteResolved > localResolved) {
    const healed: Book = { ...(normalizeBook(b) ?? b), memoryIds: remoteIds };
    await upsertBook(healed);
    return healed;
  }

  return b;
}

/** @deprecated alias — préférer `healBookMemoryIdsIfStale` */
export async function healBookMemoryIdsIfWiped(book: Book): Promise<Book> {
  return healBookMemoryIdsIfStale(book);
}

/**
 * Répare uniquement le **choix** de couverture déjà enregistré (rebase sandbox / bascule print).
 * Ne remplace jamais par « le premier favori » du livre (sauf couverture vide).
 */
async function materializeBookCoverMemories(book: Book): Promise<void> {
  const ids = dedupeMemoryIds(book.memoryIds ?? []);
  if (ids.length === 0) return;

  const coverMem = findBookCoverMemory(book);
  if (coverMem) {
    await materializeCloudMediaToSandboxForMemory(coverMem.id);
  }

  for (const memoryId of ids) {
    const m = getLocalMemoryById(memoryId);
    if (m?.type !== 'photo') continue;
    await materializeCloudMediaToSandboxForMemory(memoryId);
  }
}

function bookCoverPersistedChanged(before: Book, after: Book): boolean {
  return (before.coverPhotoUrl ?? '').trim() !== (after.coverPhotoUrl ?? '').trim();
}

async function persistHealedBookCoverIfChanged(before: Book, after: Book): Promise<Book> {
  if (!bookCoverPersistedChanged(before, after)) return after;
  await upsertBook(after);
  return after;
}

/** Remplace une ref couverture locale morte par une ref cloud ou canonique du souvenir photo. */
function healStaleLocalCoverPhotoRef(book: Book): Book {
  const direct = (book.coverPhotoUrl ?? '').trim();
  if (!direct || !looksLikeStaleLocalCoverRef(direct)) return book;

  const coverMem = findBookCoverMemory(book);
  if (coverMem?.type === 'photo') {
    const canon = canonicalBookCoverPhotoRef(coverMem).trim();
    if (canon && !looksLikeStaleLocalCoverRef(canon)) {
      return { ...book, coverPhotoUrl: canon };
    }
    const cloud = resolveBookCoverCloudFallbackUri(book, '', 'list');
    if (cloud && isCloudMediaReference(cloud)) {
      return { ...book, coverPhotoUrl: cloud };
    }
  }

  return book;
}

export async function healBookCoverIfNeeded(book: Book): Promise<Book> {
  const before = book;
  let current = healStaleLocalCoverPhotoRef(book);
  await hydrateMemoriesByIds(current.memoryIds ?? []);
  current = healStaleLocalCoverPhotoRef(current);
  await materializeBookCoverMemories(current);

  const direct = (current.coverPhotoUrl ?? '').trim();

  if (direct.includes('petitmo_memories/book_covers/')) {
    const rebased = rebaseSandboxUriToCurrentContainer(direct);
    if (await isLocalMediaUriReadable(rebased)) {
      return persistHealedBookCoverIfChanged(before, current);
    }
  }

  const dedicated = dedicatedBookCoverUriForBook(current.id);
  const dedicatedReadable = dedicated ? await isLocalMediaUriReadable(dedicated) : false;

  const printUri = resolveBookCoverPrintUri(current)?.trim() ?? '';
  if (printUri && (await isLocalMediaUriReadable(printUri))) {
    await persistBookCoverUri(current.id, printUri);
    return persistHealedBookCoverIfChanged(before, current);
  }

  if (dedicatedReadable && dedicated) {
    await persistBookCoverUri(current.id, dedicated);
    return persistHealedBookCoverIfChanged(before, current);
  }

  if (!direct) {
    const favList = resolveCoverFromBookFavorites(current, '', 'list');
    if (favList) {
      const persisted = await persistBookCoverUri(current.id, favList);
      if (persisted && (await isLocalMediaUriReadable(persisted))) {
        return persistHealedBookCoverIfChanged(before, {
          ...current,
          coverPhotoUrl: persisted,
        });
      }
    }
    const cloudEmpty = resolveBookCoverCloudFallbackUri(current, '', 'list');
    if (cloudEmpty) {
      const persisted = await persistBookCoverUri(current.id, cloudEmpty);
      if (persisted && (await isLocalMediaUriReadable(persisted))) {
        return persistHealedBookCoverIfChanged(before, {
          ...current,
          coverPhotoUrl: persisted,
        });
      }
      if (isCloudMediaReference(cloudEmpty)) {
        return persistHealedBookCoverIfChanged(before, {
          ...current,
          coverPhotoUrl: cloudEmpty,
        });
      }
    }
    return current;
  }

  const ref = direct;

  const coverMem = findBookCoverMemory(current);
  if (coverMem) {
    const freshPrint = getBookPhotoPrintUri(coverMem, ref).trim();
    if (freshPrint && (await isLocalMediaUriReadable(freshPrint))) {
      await persistBookCoverUri(current.id, freshPrint);
      return persistHealedBookCoverIfChanged(before, current);
    }
  }

  for (const variant of ['list', 'print', 'editor'] as const) {
    const cloud = resolveBookCoverCloudFallbackUri(current, ref, variant);
    if (!cloud) continue;
    const persisted = await persistBookCoverUri(current.id, cloud);
    if (persisted && (await isLocalMediaUriReadable(persisted))) {
      return persistHealedBookCoverIfChanged(before, {
        ...current,
        coverPhotoUrl: persisted,
      });
    }
    if (cloud && isCloudMediaReference(cloud)) {
      return persistHealedBookCoverIfChanged(before, {
        ...current,
        coverPhotoUrl: cloud,
      });
    }
  }

  if (looksLikeStaleLocalCoverRef(ref)) {
    const healedRef = healStaleLocalCoverPhotoRef(current);
    if (bookCoverPersistedChanged(current, healedRef)) {
      return persistHealedBookCoverIfChanged(before, healedRef);
    }
  }

  return current;
}

export async function healAllBookMemoryIdsIfWiped(books: readonly Book[]): Promise<Book[]> {
  const out: Book[] = [];
  for (const b of books) {
    out.push(await healBookMemoryIdsIfStale(b));
  }
  return out;
}

export async function healAllBookCovers(books: readonly Book[]): Promise<Book[]> {
  const out: Book[] = [];
  for (const b of books) {
    out.push(await healBookCoverIfNeeded(b));
  }
  return out;
}

/** URI couverture pour la liste Livres (recadrage = même fichier que l’éditeur). */
export function resolveBookListRowCoverUri(book: Book): string {
  if (book.photoCrops?.cover) return resolveBookCoverEditorUri(book) ?? '';
  return resolveBookListCoverDisplayUri(book) ?? '';
}

/** Signature stable pour éviter `setBooks` / remontage des vignettes si rien n’a changé visuellement. */
export function booksListVisualSignature(books: readonly Book[]): string {
  return books
    .map(b => {
      const cover = resolveBookListRowCoverUri(b);
      const crop = b.photoCrops?.cover;
      const cropSig = crop ? `${crop.xPct},${crop.yPct},${crop.scale}` : '';
      return [
        b.id,
        b.title,
        b.createdAt,
        b.memoryIds.join(','),
        b.coverPhotoUrl ?? '',
        cover,
        cropSig,
      ].join('|');
    })
    .join('\n');
}

export async function getBook(bookId: string): Promise<Book | null> {
  const b = getLocalBook(bookId);
  return b ? normalizeBook(b) : null;
}

export type BookPreviewLocalSnapshot = {
  child: Child;
  familyChildren: Child[];
  book: Book;
  bookMemories: Memory[];
  bookSelectionKeys: string[];
};

/**
 * Hydratation SQLite synchrone — spread visible sans spinner au retour Favoris (replace remonte l’écran).
 */
export function readBookPreviewLocalSnapshotSync(bookId: string): BookPreviewLocalSnapshot | null {
  const raw = getLocalBook(bookId);
  if (!raw) return null;
  const book = normalizeBook(raw);
  if (!book) return null;

  const childId = peekSelectedChildIdLastKnown();
  if (!childId) return null;

  const familyChildren = sortChildrenByBirthdateAsc(listLocalChildren());
  const child = getLocalChild(childId) ?? familyChildren.find(c => c.id === childId) ?? null;
  if (!child) return null;

  const bookSelectionKeys = dedupeMemoryIds(book.memoryIds ?? []);
  const bookMemories: Memory[] = [];
  for (const id of bookSelectionKeys) {
    const row = getLocalMemoryById(id);
    if (row) bookMemories.push(row as Memory);
  }
  bookMemories.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return { child, familyChildren, book, bookMemories, bookSelectionKeys };
}

export async function createBook(title?: string): Promise<Book> {
  const books = await readAll();
  const book: Book = {
    id: safeId(),
    title: (title ?? '').trim() || `Livre ${books.length + 1}`,
    createdAt: new Date().toISOString(),
    memoryIds: [],
  };
  upsertLocalBook({
    id: book.id,
    title: book.title,
    createdAt: book.createdAt,
    memoryIds: book.memoryIds,
    coverPhotoUrl: null,
    chapterTitle: null,
  });
  return book;
}

/**
 * Crée un livre et y attache les souvenirs en une seule écriture SQLite.
 * Évite les livres vides orphelins si l’app redémarre entre `createBook` et `addMemoriesToBook`.
 */
export async function createBookWithMemories(title: string | undefined, memoryIds: string[]): Promise<Book> {
  const ids = uniq(memoryIds);
  if (ids.length === 0) {
    throw new Error('Sélectionne au moins un souvenir pour créer le livre.');
  }
  await assertBookMemoriesAllowedForTier(ids);

  const books = await readAll();
  const book: Book = {
    id: safeId(),
    title: (title ?? '').trim() || `Livre ${books.length + 1}`,
    createdAt: new Date().toISOString(),
    memoryIds: ids,
  };
  await upsertBook(book);
  return book;
}

/**
 * Retire les livres vides en doublon de titre lorsqu’un autre livre du même nom contient déjà des souvenirs.
 * Corrige les orphelins laissés par d’anciennes versions (create puis crash avant add).
 */
export function pruneOrphanEmptyBookDuplicates(): number {
  const rows = listLocalBooks();
  const byTitle = new Map<string, LocalBookRow[]>();
  for (const b of rows) {
    const key = (b.title ?? '').trim().toLowerCase();
    if (!key) continue;
    const group = byTitle.get(key) ?? [];
    group.push(b);
    byTitle.set(key, group);
  }

  let removed = 0;
  for (const group of byTitle.values()) {
    const hasPopulated = group.some(b => (b.memoryIds?.length ?? 0) > 0);
    if (!hasPopulated) continue;
    for (const b of group) {
      if ((b.memoryIds?.length ?? 0) > 0) continue;
      deleteLocalBook(b.id);
      removed++;
    }
  }
  return removed;
}

export async function upsertBook(next: Book): Promise<void> {
  const normalized = normalizeBook(next) ?? next;
  upsertLocalBook({
    id: normalized.id,
    title: normalized.title,
    createdAt: normalized.createdAt,
    memoryIds: normalized.memoryIds,
    coverPhotoUrl: normalized.coverPhotoUrl ?? null,
    rotations: normalized.rotations,
    photoCrops: normalized.photoCrops,
    textEdits: normalized.textEdits,
    chapterTitle: normalized.chapterTitle ?? null,
  });
  void backupBooksToSupabaseIfPremium().catch(() => {});
}

/** Ids de souvenirs uniques, ordre conservé (pour sélection / lots). */
export function dedupeMemoryIds(ids: string[]): string[] {
  return uniq(ids);
}

/** Ajoute plusieurs souvenirs en une écriture ; jamais de doublons dans `memoryIds`. */
export async function addMemoriesToBook(bookId: string, memoryIds: string[]): Promise<Book | null> {
  const ids = uniq(memoryIds);
  const b = getLocalBook(bookId);
  if (!b) return null;
  if (ids.length === 0) return b;

  const existingIds = uniq(b.memoryIds ?? []);
  const newIds = ids.filter(id => !existingIds.includes(id));
  if (newIds.length === 0) return normalizeBook(b) ?? b;

  await assertBookMemoriesAllowedForTier(uniq([...existingIds, ...newIds]));

  const next: Book = {
    ...(normalizeBook(b) ?? b),
    memoryIds: uniq([...existingIds, ...newIds]),
  };
  await upsertBook(next);
  return next;
}

export async function addMemoryToBook(bookId: string, memoryId: string): Promise<Book | null> {
  return addMemoriesToBook(bookId, [memoryId]);
}

/** Retire plusieurs souvenirs en une écriture. */
export async function removeMemoriesFromBook(bookId: string, memoryIds: string[]): Promise<Book | null> {
  const remove = new Set(uniq(memoryIds));
  const b = getLocalBook(bookId);
  if (!b) return null;
  if (remove.size === 0) return b;
  const next: Book = { ...(normalizeBook(b) ?? b), memoryIds: (b.memoryIds ?? []).filter(id => !remove.has(id)) };
  await upsertBook(next);
  return next;
}

export async function removeMemoryFromBook(bookId: string, memoryId: string): Promise<Book | null> {
  return removeMemoriesFromBook(bookId, [memoryId]);
}

export async function deleteBook(bookId: string): Promise<void> {
  const id = bookId.trim();
  if (!id) return;
  deleteLocalBook(id);
  void addPendingBookDeleteId(id);
  void (async () => {
    try {
      await deleteRemoteBookIfPremium(id);
      await removePendingBookDeleteIds([id]);
    } catch {
      /* pending conservé : restore ignorera cet id ; flush au prochain démarrage */
    }
    await backupBooksToSupabaseIfPremium().catch(() => {});
  })();
}

/** Nombre de livres contenant chaque souvenir (clé = memoryId). */
export async function memoryIdToBookCount(): Promise<Record<string, number>> {
  const books = await readAll();
  const counts: Record<string, number> = {};
  for (const b of books) {
    for (const id of b.memoryIds) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Migration one-shot : ancien stockage AsyncStorage → SQLite.
 * IMPORTANT: garde la spec “local-first” (pas de cloud ici).
 */
export async function migrateBooksFromAsyncStorageToSqliteOnce(): Promise<void> {
  try {
    const markerKey = `${STORAGE_KEY}:migrated_to_sqlite`;
    const done = await AsyncStorage.getItem(markerKey);
    if (done === '1') return;

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const books = parsed.map(normalizeBook).filter((b): b is Book => b != null);
        for (const b of books) {
          upsertLocalBook({
            id: b.id,
            title: b.title,
            createdAt: b.createdAt,
            memoryIds: b.memoryIds,
            coverPhotoUrl: b.coverPhotoUrl ?? null,
            rotations: b.rotations,
            photoCrops: b.photoCrops,
            textEdits: b.textEdits,
            chapterTitle: b.chapterTitle ?? null,
          });
        }
      }
    }

    await AsyncStorage.setItem(markerKey, '1');
    // Optionnel : nettoyage de l'ancien store pour éviter la confusion.
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // silencieux
  }
}

/**
 * Backup cloud — uniquement premium (tier `paid` côté app).
 * On sauvegarde l’état complet (liste) dans une table Supabase.
 */
export async function backupBooksToSupabaseIfPremium(): Promise<void> {
  const tier = await getUserTier();
  if (tier !== 'paid') return;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;

  const books = listLocalBooks();
  const payload = books.map((b: LocalBookRow) => ({
    id: b.id,
    user_id: user.id,
    title: b.title,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    memory_ids: b.memoryIds,
    cover_photo_url: b.coverPhotoUrl ?? null,
    rotations: b.rotations ?? null,
    photo_crops: b.photoCrops ?? null,
    text_edits: b.textEdits ?? null,
    chapter_title: b.chapterTitle ?? null,
  }));

  // Upsert tout : robuste et idempotent.
  await booksTable().upsert(payload, { onConflict: 'id' });

  const localIds = new Set(books.map((b: LocalBookRow) => b.id));
  const { data: remoteRows, error: listErr } = await booksTable().select('id').eq('user_id', user.id);
  if (!listErr && Array.isArray(remoteRows)) {
    for (const r of remoteRows as { id?: unknown }[]) {
      const rid = typeof r.id === 'string' ? r.id : '';
      if (!rid || localIds.has(rid)) continue;
      await booksTable().delete().eq('id', rid).eq('user_id', user.id);
    }
  }
}

function safeStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(s => s.trim());
}

function safeRecordNumber(x: unknown): Record<string, number> | null {
  if (!x || typeof x !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function safePhotoCrops(
  x: unknown
): Record<string, { xPct: number; yPct: number; scale: number }> | null {
  if (!x || typeof x !== 'object') return null;
  const out: Record<string, { xPct: number; yPct: number; scale: number }> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const xPct = typeof e.xPct === 'number' ? e.xPct : 0;
    const yPct = typeof e.yPct === 'number' ? e.yPct : 0;
    const scale = typeof e.scale === 'number' ? e.scale : 1;
    if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !Number.isFinite(scale)) continue;
    out[k] = { xPct, yPct, scale: Math.max(1, scale) };
  }
  return Object.keys(out).length ? out : null;
}

function safeTextEdits(x: unknown): Record<string, { content?: string | null }> | null {
  if (!x || typeof x !== 'object') return null;
  const out: Record<string, { content?: string | null }> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if ('content' in e) {
      out[k] = { content: typeof e.content === 'string' ? e.content : null };
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Restauration cloud → SQLite (premium uniquement).
 * Règle de merge “safe” : on garde la version la plus récente (local.updatedAt vs remote.updated_at).
 */
export async function restoreBooksFromSupabaseIfPremium(): Promise<void> {
  const tier = await getUserTier();
  if (tier !== 'paid') return;

  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) return;

  const { data, error } = await booksTable()
    .select(
      'id, user_id, title, created_at, updated_at, memory_ids, cover_photo_url, rotations, photo_crops, text_edits, chapter_title'
    )
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error || !Array.isArray(data)) {
    return;
  }

  const pendingDelete = await getPendingBookDeleteIds();

  for (const row of data as Array<Record<string, unknown>>) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;
    if (pendingDelete.has(id)) continue;

    const remoteUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
    const remoteUpdatedMs = Date.parse(remoteUpdatedAt);

    const local = getLocalBook(id);
    const localUpdatedMs = local?.updatedAt ? Date.parse(local.updatedAt) : Number.NEGATIVE_INFINITY;

    // Si la version locale est plus récente, ne pas écraser.
    if (Number.isFinite(localUpdatedMs) && Number.isFinite(remoteUpdatedMs) && localUpdatedMs > remoteUpdatedMs) {
      continue;
    }

    const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
    const title = typeof row.title === 'string' ? row.title : 'Livre';
    const remoteMemoryIds = dedupeMemoryIds(safeStringArray(row.memory_ids));
    const localMemoryIds = dedupeMemoryIds(local?.memoryIds ?? []);
    await hydrateMemoriesByIds([...localMemoryIds, ...remoteMemoryIds]);
    const localResolved = countResolvableBookMemoryIds(localMemoryIds);
    const remoteResolved = countResolvableBookMemoryIds(remoteMemoryIds);
    const memoryIds =
      localMemoryIds.length > 0 && localResolved >= remoteResolved
        ? localMemoryIds
        : remoteResolved > localResolved
          ? remoteMemoryIds
          : remoteMemoryIds.length > 0
            ? remoteMemoryIds
            : localMemoryIds;
    const coverPhotoUrl = typeof row.cover_photo_url === 'string' ? row.cover_photo_url : null;
    const rotations = safeRecordNumber(row.rotations);
    const photoCrops = safePhotoCrops(row.photo_crops);
    const textEdits = safeTextEdits(row.text_edits);
    const chapterTitle = typeof row.chapter_title === 'string' ? row.chapter_title : null;

    upsertLocalBook({
      id,
      title,
      createdAt,
      memoryIds,
      coverPhotoUrl,
      rotations: rotations ?? undefined,
      photoCrops: photoCrops ?? undefined,
      textEdits: textEdits ?? undefined,
      chapterTitle,
    });
  }

  await healAllBookCovers(listBooksFromSqliteSync());
}


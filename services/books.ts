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
  FREE_TIER_BOOK_VOICE_MAX_DURATION,
  FREE_TIER_VIDEO_MAX_DURATION,
  PAID_TIER_BOOK_VOICE_MAX_DURATION,
  PAID_TIER_VIDEO_MAX_DURATION,
} from '@/lib/limits';
import { Platform } from 'react-native';
import { copyAsync, documentDirectory, downloadAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import { getSignedMediaDisplayUrl, extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import {
  canonicalBookCoverPhotoRef,
  getAlbumCanonicalFavoriteUrls,
  getAllPhotoUrlsForFeed,
  getBookPhotoPrintUri,
  getPhotoUriForBookMaquetteDisplay,
  getPrimaryPhotoUriForBookPreview,
  getVideoPosterUriForFeedAndViewer,
  getVoiceCoverUriForFeedAndViewer,
  indexOfPhotoUrlInFeed,
  isPhotoUrlFavoritedWithVariants,
  mapPhotoUrlToThumb,
  memoryPhotoMatchesUrl,
  normalizeMemoryMediaUriForDisplay,
  normalizePhotoUrlForCompare,
  parseFavoritePhotoUrls,
  pickPhotoUriForOverlayPalette,
  urlsInSamePhotoVariantGroup,
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
import { buildBookPages, type BookPageMemorySpec } from '@/src/book/BookEngine';
import { formatGelatoPrintPageCountLabel } from '@/utils/bookGelatoInnerPages';

/**
 * Ref couverture locale **morte** : uniquement fuite Bundle (`…/Petitmo.app/…`) ou chemin
 * d’un ancien container iOS (réinstall / nouveau build).
 *
 * Un `file://…/petitmo_memories/…` du container **courant** est une ref parfaitement valide :
 * la marquer « stale » faisait retomber `findBookCoverMemory` / `resolveBookCoverDisplayUri` sur
 * « 1re photo du livre », donc réécrire l’ancienne couverture juste après un changement.
 */
function looksLikeStaleLocalCoverRef(ref: string): boolean {
  const t = ref.trim();
  if (!t || isCloudMediaReference(t)) return false;
  return (
    t.includes('/Bundle/Application/') ||
    /\/[^/]+\.app\//i.test(t) ||
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
    const ref = coverRef.trim();
    let idx = 0;
    if (ref) {
      idx = indexOfPhotoUrlInFeed(memory, ref);
      // Ref hors feed : ne pas forcer le slot 0 ni renvoyer le cloud — laisser le caller
      // tenter `book_covers/` local (local-first).
      if (idx < 0) return null;
    }
    const printUri = getBookPhotoPrintUri(memory, coverRef);
    if (printUri && !isCloudMediaReference(printUri)) return printUri;
    // Même slot en display sandbox (aperçu) avant tout chemin Storage.
    const displaySlot = getPhotoUriForBookMaquetteDisplay(memory, coverRef).trim();
    if (displaySlot && !isCloudMediaReference(displaySlot)) {
      return normalizeMemoryMediaUriForDisplay(displaySlot) || displaySlot;
    }
    // Primaires locales uniquement pour le slot 0 — jamais une autre photo d’album.
    if (idx === 0) {
      const display = firstNonEmptyUri(memory.local_display_path, memory.local_print_path);
      if (display && !isCloudMediaReference(display)) {
        return normalizeMemoryMediaUriForDisplay(display) || display;
      }
    }
    return printUri ? normalizeMemoryMediaUriForDisplay(printUri) || printUri : null;
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
 * Garde-fou durées audio/vidéo **dans un livre** (gratuit + plafond sécurité Petitmo+).
 * V1 : plus de plafond 5+5 — composition libre ; facturation QR au checkout
 * (2 inclus + 0,70 €) — `lib/pricingV1.ts`, `docs/specs/pricing-v1-migration.md`.
 * QR cloud : upload **après paiement** commande livre imprimée.
 * Spec : docs/specs/free-tier-book-qr-av.md
 */
export async function validateFreeTierBookMemoryLimits(
  memories: readonly FreeTierBookMemoryRow[],
): Promise<void> {
  const tier = await getUserTier();
  const maxVideo =
    tier === 'paid' ? PAID_TIER_VIDEO_MAX_DURATION : FREE_TIER_VIDEO_MAX_DURATION;
  const maxAudio =
    tier === 'paid' ? PAID_TIER_BOOK_VOICE_MAX_DURATION : FREE_TIER_BOOK_VOICE_MAX_DURATION;

  const videos = memories.filter(m => m.type === 'video');
  const tooLongVideo = videos.find(m => (m.duration ?? 0) > maxVideo);
  if (tooLongVideo) {
    throw new Error(
      tier === 'paid'
        ? 'Chaque souvenir vidéo est limité à 3 minutes.'
        : `Avec le plan gratuit, chaque souvenir vidéo est limité à ${FREE_TIER_VIDEO_MAX_DURATION} secondes.`,
    );
  }

  const audios = memories.filter(m => m.type === 'voice');
  const tooLongAudio = audios.find(m => (m.duration ?? 0) > maxAudio);
  if (tooLongAudio) {
    throw new Error(
      tier === 'paid'
        ? 'Chaque souvenir audio est limité à 5 minutes.'
        : `Avec le plan gratuit, chaque souvenir audio est limité à ${FREE_TIER_BOOK_VOICE_MAX_DURATION} secondes.`,
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

export type BookPageEntry = {
  memoryId: string;
  /** Slot album Favoris ; absent = photo principale du souvenir. */
  photoRef?: string;
};

export type Book = {
  id: string;
  /** Nom affiché dans les pilules / modales */
  title: string;
  createdAt: string;
  /** Souvenirs distincts (dérivé de pageEntries — sync / quotas A/V). */
  memoryIds: string[];
  /**
   * Dernier slot photo par souvenir (compat). Source d’affichage = `pageEntries`.
   */
  memoryPhotoRefs?: Record<string, string>;
  /**
   * Source de vérité des pages contenu (ordre). Même memoryId + photoRefs distincts = N pages.
   */
  pageEntries?: BookPageEntry[];
  /** URL de la photo de couverture (sinon fallback photo enfant / souvenirs). */
  coverPhotoUrl?: string | null;
  /** Couleur fond couverture (`white` | `cream` | `olive` | `navy` | `charcoal` | `black`). */
  coverColorId?: string | null;
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

function isDeviceUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith('@petitmo.local');
}

function booksTable(): ReturnType<typeof supabase.from> {
  return (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from('books');
}

/** Sync cloud des livres = compte produit (gratuit ou Petitmo+), pas device-user. */
async function getRealAuthUserIdForBookCloudSync(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user?.id) return null;
  if (isDeviceUserEmail(user.email)) return null;
  return user.id;
}

/** UI livres / onglets : peindre SQLite après restore / backup sans attendre un focus. */
export const PETITMO_BOOKS_UPDATED_EVENT = 'petitmo:books-updated' as const;

export function notifyBooksUpdated(): void {
  DeviceEventEmitter.emit(PETITMO_BOOKS_UPDATED_EVENT);
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
 * Compte produit uniquement (gratuit inclus — V2).
 */
export async function flushPendingBookDeletesToSupabase(): Promise<void> {
  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return;
  const pending = [...(await getPendingBookDeleteIds())];
  if (pending.length === 0) return;
  const removed: string[] = [];
  for (const id of pending) {
    const { error } = await booksTable().delete().eq('id', id).eq('user_id', userId);
    if (!error) removed.push(id);
  }
  await removePendingBookDeleteIds(removed);
}

async function deleteRemoteBookIfPremium(bookId: string): Promise<void> {
  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return;
  const { error } = await booksTable().delete().eq('id', bookId).eq('user_id', userId);
  if (error) throw error;
}

function safeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Identité d’une page contenu : `(memoryId, slot photo)`.
 * Même souvenir + autre photo Favoris = autre page (APPEND, jamais REPLACE).
 * Clé stricte (persist / logs) — pour l’égalité UI / dédup, préférer `bookPageEntriesEquivalent`.
 */
export function bookPageEntryKey(entry: BookPageEntry): string {
  const mid = entry.memoryId.trim();
  if (!mid) return '';
  const pr = entry.photoRef?.trim() ?? '';
  return pr ? `${mid}::${normalizePhotoUrlForCompare(pr)}` : `${mid}::`;
}

/**
 * Résout une photoRef absente = photo principale du souvenir (legacy pages sans slot).
 */
function resolveBookPagePhotoRef(entry: BookPageEntry, memory: Memory | null | undefined): string {
  const pr = entry.photoRef?.trim() ?? '';
  if (pr) return pr;
  if (memory?.type === 'photo') {
    return getAllPhotoUrlsForFeed(memory)[0]?.trim() || '';
  }
  return '';
}

/**
 * True si deux entrées désignent la même page (même souvenir + même slot photo),
 * en tenant compte des variantes display/print/thumb et des pages legacy sans photoRef.
 */
export function bookPageEntriesEquivalent(
  a: BookPageEntry,
  b: BookPageEntry,
  memory?: Memory | null,
): boolean {
  const midA = a.memoryId.trim();
  const midB = b.memoryId.trim();
  if (!midA || midA !== midB) return false;

  const prA = a.photoRef?.trim() ?? '';
  const prB = b.photoRef?.trim() ?? '';
  if (!prA && !prB) return true;

  const mem = memory === undefined ? getLocalMemoryById(midA) : memory;
  if (mem && mem.type !== 'photo') {
    // Vidéo / audio / texte : une page = le souvenir entier (photoRef ignoré).
    return true;
  }

  const resolvedA = resolveBookPagePhotoRef(a, mem);
  const resolvedB = resolveBookPagePhotoRef(b, mem);
  if (!resolvedA && !resolvedB) return true;
  if (!resolvedA || !resolvedB) return false;

  if (mem) {
    return urlsInSamePhotoVariantGroup(mem, resolvedA, resolvedB);
  }
  return normalizePhotoUrlForCompare(resolvedA) === normalizePhotoUrlForCompare(resolvedB);
}

/** Dédup pages sur (memoryId, photoRef) — conserve l’ordre ; ne fusionne plus deux photos d’album. */
export function dedupeBookPageEntries(
  entries: readonly BookPageEntry[],
  memoryPhotoRefs?: Record<string, string>,
): BookPageEntry[] {
  const out: BookPageEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const mid = e.memoryId.trim();
    if (!mid) continue;
    const photoRef =
      e.photoRef?.trim() || memoryPhotoRefs?.[mid]?.trim() || undefined;
    const next: BookPageEntry = photoRef ? { memoryId: mid, photoRef } : { memoryId: mid };
    const key = bookPageEntryKey(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

/** Dérive `memoryIds` + `memoryPhotoRefs` (dernier slot par id, compat) depuis les pages. */
function deriveBookIdsAndRefsFromEntries(entries: readonly BookPageEntry[]): {
  memoryIds: string[];
  memoryPhotoRefs: Record<string, string> | undefined;
} {
  const memoryIds = uniq(entries.map(e => e.memoryId));
  const memoryPhotoRefs: Record<string, string> = {};
  for (const e of entries) {
    const mid = e.memoryId.trim();
    const pr = e.photoRef?.trim();
    if (mid && pr) memoryPhotoRefs[mid] = pr;
  }
  return {
    memoryIds,
    memoryPhotoRefs: Object.keys(memoryPhotoRefs).length > 0 ? memoryPhotoRefs : undefined,
  };
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

  const coverColorId =
    typeof (r as { coverColorId?: unknown }).coverColorId === 'string' &&
    ((r as { coverColorId: string }).coverColorId).trim().length > 0
      ? (r as { coverColorId: string }).coverColorId.trim()
      : null;

  const memoryPhotoRefs: Record<string, string> = {};
  if (r.memoryPhotoRefs && typeof r.memoryPhotoRefs === 'object') {
    for (const [k, v] of Object.entries(r.memoryPhotoRefs as Record<string, unknown>)) {
      const id = k.trim();
      const ref = typeof v === 'string' ? v.trim() : '';
      if (id && ref) memoryPhotoRefs[id] = ref;
    }
  }

  const pageEntries: BookPageEntry[] = [];
  const rawEntries = (r as { pageEntries?: unknown }).pageEntries;
  if (Array.isArray(rawEntries)) {
    for (const e of rawEntries) {
      if (!e || typeof e !== 'object') continue;
      const mid =
        typeof (e as { memoryId?: unknown }).memoryId === 'string'
          ? (e as { memoryId: string }).memoryId.trim()
          : '';
      if (!mid) continue;
      const pr =
        typeof (e as { photoRef?: unknown }).photoRef === 'string'
          ? (e as { photoRef: string }).photoRef.trim()
          : '';
      pageEntries.push(pr ? { memoryId: mid, photoRef: pr } : { memoryId: mid });
    }
  }

  const uniqueIds = uniq(memoryIds);
  // Source de vérité = pageEntries (1 entrée = 1 page, multi-photos album OK).
  // Migration livres anciens : si pas de pageEntries, 1 page par memoryId.
  let resolvedEntries: BookPageEntry[];
  if (pageEntries.length > 0) {
    resolvedEntries = dedupeBookPageEntries(pageEntries, memoryPhotoRefs);
    // Ids présents en mémoire mais absents des entries (données partielles) → append.
    const inEntries = new Set(resolvedEntries.map(e => e.memoryId.trim()));
    for (const id of uniqueIds) {
      if (inEntries.has(id)) continue;
      const ref = memoryPhotoRefs[id]?.trim();
      resolvedEntries.push(ref ? { memoryId: id, photoRef: ref } : { memoryId: id });
      inEntries.add(id);
    }
  } else {
    resolvedEntries = uniqueIds.map(id => {
      const ref = memoryPhotoRefs[id]?.trim();
      return ref ? { memoryId: id, photoRef: ref } : { memoryId: id };
    });
  }

  const derived = deriveBookIdsAndRefsFromEntries(resolvedEntries);

  return {
    id: r.id,
    title: title.trim() || 'Livre',
    createdAt,
    memoryIds: derived.memoryIds,
    memoryPhotoRefs: derived.memoryPhotoRefs,
    pageEntries: resolvedEntries,
    coverPhotoUrl,
    coverColorId,
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
      memoryPhotoRefs: normalized.memoryPhotoRefs,
      pageEntries: normalized.pageEntries,
      coverPhotoUrl: normalized.coverPhotoUrl ?? null,
      coverColorId: normalized.coverColorId ?? null,
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

function visualCoverRefForMemory(m: Memory): string {
  if (m.type === 'video') return getVideoPosterUriForFeedAndViewer(m).trim();
  if (m.type === 'voice') return getVoiceCoverUriForFeedAndViewer(m).trim();
  return '';
}

/** Souvenir vidéo/audio dont le poster / cover correspond à `coverRef`. */
export function findVisualCoverMemoryByRef(
  coverRef: string,
  memoryIds: readonly string[],
): Memory | null {
  const refNorm = normalizePhotoUrlForCompare(coverRef);
  if (!refNorm) return null;
  for (const memoryId of memoryIds) {
    const m = getLocalMemoryById(memoryId);
    if (!m || (m.type !== 'video' && m.type !== 'voice')) continue;
    const visual = visualCoverRefForMemory(m);
    if (visual && normalizePhotoUrlForCompare(visual) === refNorm) return m;
  }
  return null;
}

export function findBookCoverMemory(book: Book): Memory | null {
  const direct = (book.coverPhotoUrl ?? '').trim();
  // Match strict d’abord — y compris ref sandbox : c’est le choix explicite de l’utilisatrice.
  if (direct) {
    for (const memoryId of book.memoryIds) {
      const m = getLocalMemoryById(memoryId);
      if (m && m.type === 'photo' && bookCoverMatchesMemory(m, direct)) return m;
    }
  }

  // Ref vide ou fichier sandbox mort (réinstall) : 1re page photo, sinon 1er souvenir photo.
  for (const e of bookPageEntries(book)) {
    const m = getLocalMemoryById(e.memoryId);
    if (m?.type === 'photo') return m;
  }
  const photoMemories = book.memoryIds
    .map(id => getLocalMemoryById(id))
    .filter((m): m is Memory => m?.type === 'photo');
  if (photoMemories.length === 1) return photoMemories[0]!;
  if (!direct || looksLikeStaleLocalCoverRef(direct)) {
    if (photoMemories.length > 0) return photoMemories[0]!;
  }
  return null;
}

export function resolveBookCoverDisplayUri(
  book: Book,
  { variant = 'list' }: { variant?: BookCoverUriVariant } = {},
): string | null {
  const direct = (book.coverPhotoUrl ?? '').trim();
  const legacyBookCovers = direct.includes('petitmo_memories/book_covers/');

  if (legacyBookCovers) {
    // Ref legacy = chemin dédié : print OK ; UI → souvenir / cloud (évite cache file:// figé).
    if (variant === 'print') {
      const byBookId = dedicatedBookCoverUriForBook(book.id);
      if (byBookId) return byBookId;
    }
    // Copie `book_covers/` absente (autre appareil) → souvenirs / cloud plus bas.
  } else if (direct) {
    let cloudFromMemory: string | null = null;
    for (const memoryId of book.memoryIds) {
      const m = getLocalMemoryById(memoryId);
      if (!m || m.type !== 'photo' || !bookCoverMatchesMemory(m, direct)) continue;
      const fresh = freshCoverUriFromMatchedMemory(m, direct, variant);
      if (!fresh) continue;
      // Local-first : fichier sandbox avant chemin Storage / URL signée.
      if (!isCloudMediaReference(fresh)) return fresh;
      if (!cloudFromMemory) cloudFromMemory = fresh;
    }

    const fromFavorites = resolveCoverFromBookFavorites(book, direct, variant);
    if (fromFavorites && !isCloudMediaReference(fromFavorites)) return fromFavorites;

    /**
     * `book_covers/{id}.jpg` est une copie print écrasée sur place.
     * Liste / éditeur / browse : ne jamais s’y fier (cache Image + URI stable = vignette stale / écrasée).
     * Print / PDF uniquement.
     */
    if (variant === 'print') {
      const dedicated = dedicatedBookCoverUriForBook(book.id);
      if (dedicated) return dedicated;
    }

    if (fromFavorites) return fromFavorites;
    if (cloudFromMemory) return cloudFromMemory;

    if (isCloudMediaReference(direct)) {
      return normalizeMemoryMediaUriForDisplay(direct) || direct;
    }

    if (looksLikeStaleLocalCoverRef(direct)) {
      const cloudFallback =
        resolveBookCoverCloudFallbackUri(book, direct, variant) ??
        resolveBookCoverCloudFallbackUri(book, '', variant);
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
    const clearedCrops = { ...(book.photoCrops ?? {}) };
    delete clearedCrops.cover;
    book = {
      ...book,
      coverPhotoUrl: null,
      photoCrops: Object.keys(clearedCrops).length > 0 ? clearedCrops : undefined,
    };
    await upsertBook(book);
    notifyBooksUpdated();
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
      owner = findVisualCoverMemoryByRef(coverRef, book.memoryIds);
    }
    if (!owner) {
      const all = await getFamilyMemories();
      const allIds = all.map(m => m.id);
      owner =
        findPhotoMemoryByCoverRef(coverRef, allIds) ??
        findVisualCoverMemoryByRef(coverRef, allIds);
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

  // Nouveau visuel → invalider le recadrage couverture (sinon maquette / liste « écrasées »).
  const nextCrops = { ...(book.photoCrops ?? {}) };
  delete nextCrops.cover;
  book = {
    ...book,
    coverPhotoUrl: coverRef,
    photoCrops: Object.keys(nextCrops).length > 0 ? nextCrops : undefined,
  };
  await upsertBook(book);

  notifyBooksUpdated();
  // Pas de `memories-invalidate` : évite un heal async qui course avec le choix utilisateur.

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

  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return book;

  const { data, error } = await booksTable()
    .select('memory_ids')
    .eq('id', book.id)
    .eq('user_id', userId)
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

  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return b;

  const { data, error } = await booksTable()
    .select('memory_ids')
    .eq('id', b.id)
    .eq('user_id', userId)
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
  if (!direct) return book;

  // Chemin Storage résolu à tort sous Bundle/…/Petitmo.app/ → récupérer le chemin bucket.
  const bundleLeak = direct.match(
    /\.app\/((?:guest\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/).+)$/i,
  );
  if (bundleLeak?.[1] && extractMediaBucketPath(bundleLeak[1])) {
    return { ...book, coverPhotoUrl: bundleLeak[1] };
  }

  if (!looksLikeStaleLocalCoverRef(direct)) return book;

  const coverMem = findBookCoverMemory(book);
  if (coverMem?.type === 'photo') {
    const canon = canonicalBookCoverPhotoRef(coverMem).trim();
    if (canon && !looksLikeStaleLocalCoverRef(canon)) {
      return { ...book, coverPhotoUrl: canon };
    }
    const cloud =
      resolveBookCoverCloudFallbackUri(book, direct, 'list') ??
      resolveBookCoverCloudFallbackUri(book, '', 'list');
    if (cloud && isCloudMediaReference(cloud)) {
      return { ...book, coverPhotoUrl: cloud };
    }
    const fromMemory = firstNonEmptyUri(
      coverMem.display_url,
      coverMem.thumb_url,
      coverMem.print_url,
      coverMem.media_url,
    );
    if (fromMemory && isCloudMediaReference(fromMemory)) {
      return { ...book, coverPhotoUrl: fromMemory };
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
  /** Ref sandbox morte ne matche aucun souvenir — ne pas la passer au filtre cloud. */
  const refForCloudMatch = looksLikeStaleLocalCoverRef(ref) ? '' : ref;

  const coverMem = findBookCoverMemory(current);
  if (coverMem) {
    const freshPrint = getBookPhotoPrintUri(coverMem, refForCloudMatch || ref).trim();
    if (freshPrint && (await isLocalMediaUriReadable(freshPrint))) {
      await persistBookCoverUri(current.id, freshPrint);
      return persistHealedBookCoverIfChanged(before, current);
    }
  }

  for (const variant of ['list', 'print', 'editor'] as const) {
    const cloud = resolveBookCoverCloudFallbackUri(current, refForCloudMatch, variant);
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
  if (book.photoCrops?.cover) {
    const editor = resolveBookCoverEditorUri(book) ?? '';
    // Après réinstall : crop OK mais fichier éditeur mort → ne pas renvoyer '' (cover invisible).
    if (editor.trim()) return editor;
  }
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
        String(bookPageEntries(b).length),
        b.coverPhotoUrl ?? '',
        b.coverColorId ?? '',
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
export async function createBookWithMemories(
  title: string | undefined,
  memoryIds: string[],
  opts?: AddMemoriesToBookOptions,
): Promise<Book> {
  const pageEntries: BookPageEntry[] = dedupeBookPageEntries(
    opts?.pageEntries && opts.pageEntries.length > 0
      ? opts.pageEntries.filter(e => e.memoryId.trim())
      : uniq(memoryIds).map(id => {
          const ref = opts?.memoryPhotoRefs?.[id]?.trim();
          return ref ? { memoryId: id, photoRef: ref } : { memoryId: id };
        }),
    opts?.memoryPhotoRefs,
  );
  if (pageEntries.length === 0) {
    throw new Error('Sélectionne au moins un souvenir pour créer le livre.');
  }
  const derived = deriveBookIdsAndRefsFromEntries(pageEntries);
  await assertBookMemoriesAllowedForTier(derived.memoryIds);

  const books = await readAll();
  const book: Book = {
    id: safeId(),
    title: (title ?? '').trim() || `Livre ${books.length + 1}`,
    createdAt: new Date().toISOString(),
    memoryIds: derived.memoryIds,
    pageEntries,
    memoryPhotoRefs: derived.memoryPhotoRefs,
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
    memoryPhotoRefs: normalized.memoryPhotoRefs,
    pageEntries: normalized.pageEntries,
    coverPhotoUrl: normalized.coverPhotoUrl ?? null,
    coverColorId: normalized.coverColorId ?? null,
    rotations: normalized.rotations,
    photoCrops: normalized.photoCrops,
    textEdits: normalized.textEdits,
    chapterTitle: normalized.chapterTitle ?? null,
  });
  scheduleBooksCloudBackup();
}

/** Retire les pages dont le souvenir est introuvable en local. */
export function pruneOrphanBookMemoryIds(book: Book): Book {
  const prevEntries = bookPageEntries(book);
  const entries = dedupeBookPageEntries(
    prevEntries.filter(e => !!getLocalMemoryById(e.memoryId.trim())),
  );
  const derived = deriveBookIdsAndRefsFromEntries(entries);
  const entriesUnchanged =
    entries.length === prevEntries.length &&
    entries.every((e, i) => {
      const p = prevEntries[i];
      return p && bookPageEntryKey(p) === bookPageEntryKey(e);
    });
  const idsUnchanged =
    derived.memoryIds.length === (book.memoryIds ?? []).length &&
    derived.memoryIds.every((id, i) => id === book.memoryIds[i]);
  if (idsUnchanged && entriesUnchanged) return book;
  return {
    ...book,
    memoryIds: derived.memoryIds,
    pageEntries: entries,
    memoryPhotoRefs: derived.memoryPhotoRefs,
  };
}

/**
 * Livre cible du flux Favoris → spread (lecture SQLite, sans mutation).
 * Aligné sur les pages affichables : ids orphelins exclus (comme le prune preview).
 */
export function getBookForFavorisAddTarget(bookId: string): Book | null {
  const raw = getLocalBook(bookId.trim());
  if (!raw) return null;
  const b = normalizeBook(raw);
  if (!b) return null;
  return pruneOrphanBookMemoryIds(b);
}

function mergeBookMemoryPhotoRefs(
  book: Book,
  incoming?: Record<string, string>,
  finalMemoryIds?: string[],
): Record<string, string> | undefined {
  const ids = new Set(finalMemoryIds ?? book.memoryIds ?? []);
  const merged = { ...(book.memoryPhotoRefs ?? {}), ...(incoming ?? {}) };
  const out: Record<string, string> = {};
  for (const [id, ref] of Object.entries(merged)) {
    const mid = id.trim();
    const url = ref.trim();
    if (!mid || !url || !ids.has(mid)) continue;
    out[mid] = url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pages contenu d’un livre — source de vérité `pageEntries`
 * (plusieurs pages possibles pour le même memoryId, slots photo distincts).
 */
export function bookPageEntries(book: Book): BookPageEntry[] {
  if (book.pageEntries && book.pageEntries.length > 0) {
    return dedupeBookPageEntries(book.pageEntries, book.memoryPhotoRefs);
  }
  // Migration : livres sans pageEntries persistées.
  return dedupeBookPageEntries(
    (book.memoryIds ?? []).map(id => {
      const ref = book.memoryPhotoRefs?.[id]?.trim();
      return ref ? { memoryId: id, photoRef: ref } : { memoryId: id };
    }),
  );
}

/**
 * Compteur catalogue Gelato pour la liste Livres — même chiffre que spread / éditeur
 * (`formatGelatoPrintPageCountLabel`), pas le nombre de souvenirs.
 */
export function formatBookListGelatoPageCountLabel(book: Book): string {
  const entries = bookPageEntries(book);
  if (entries.length === 0) {
    return formatGelatoPrintPageCountLabel([]);
  }

  const specs: BookPageMemorySpec[] = [];
  for (const e of entries) {
    const m = getLocalMemoryById(e.memoryId.trim());
    if (!m) continue;
    const photoRef = e.photoRef?.trim();
    specs.push(photoRef ? { memory: m, photoRef } : { memory: m });
  }
  if (specs.length === 0) {
    return formatGelatoPrintPageCountLabel([]);
  }

  const child = listLocalChildren()[0];
  if (!child) {
    // Sans profil : contenu seul (pas de chapitres), pad pair Gelato.
    const n = specs.length;
    return formatGelatoPrintPageCountLabel(
      Array.from({ length: n }, () => ({ type: 'photo-full' as const })),
    );
  }

  return formatGelatoPrintPageCountLabel(buildBookPages(child, specs));
}

/** True si le souvenir (memoryId) a au moins une page. */
export function bookHasMemoryPage(book: Book, memoryId: string): boolean {
  const id = memoryId.trim();
  if (!id) return false;
  return bookPageEntries(book).some(e => e.memoryId.trim() === id);
}

/** True si cette page précise (souvenir + slot photo) est déjà dans le livre. */
export function bookHasPageEntry(
  book: Book,
  entry: BookPageEntry,
  memory?: Memory | null,
): boolean {
  const mid = entry.memoryId.trim();
  if (!mid) return false;
  const mem = memory === undefined ? getLocalMemoryById(mid) : memory;
  return bookPageEntries(book).some(e => bookPageEntriesEquivalent(e, entry, mem));
}

export type AddMemoriesToBookOptions = {
  memoryPhotoRefs?: Record<string, string>;
  /** Pages à ajouter (APPEND). Même memoryId + autre photoRef = nouvelle page. */
  pageEntries?: BookPageEntry[];
};

/** Plafond pages contenu (pas le nombre de memoryIds uniques). */
export const MAX_BOOK_PAGE_ENTRIES = 80;

/** Ids de souvenirs uniques, ordre conservé (pour sélection / lots). */
export function dedupeMemoryIds(ids: string[]): string[] {
  return uniq(ids);
}

/**
 * Ajoute des pages au livre — **toujours APPEND**.
 * Ne remplace jamais une page existante. Doublon exact (même memoryId + même photoRef) ignoré.
 */
export async function addMemoriesToBook(
  bookId: string,
  memoryIds: string[],
  opts?: AddMemoriesToBookOptions,
): Promise<Book | null> {
  const b = getLocalBook(bookId);
  if (!b) return null;

  const normalized = normalizeBook(b) ?? b;
  const current = bookPageEntries(normalized);
  const toAppend: BookPageEntry[] = [];

  const isAlreadyPresent = (candidate: BookPageEntry, mem: Memory | null) => {
    if (current.some(e => bookPageEntriesEquivalent(e, candidate, mem))) return true;
    if (toAppend.some(e => bookPageEntriesEquivalent(e, candidate, mem))) return true;
    return false;
  };

  const pushEntry = (raw: BookPageEntry) => {
    const mid = raw.memoryId.trim();
    if (!mid) return;
    const photoRef = raw.photoRef?.trim() || undefined;
    const next: BookPageEntry = photoRef ? { memoryId: mid, photoRef } : { memoryId: mid };
    const mem = getLocalMemoryById(mid);
    if (isAlreadyPresent(next, mem)) return;
    toAppend.push(next);
  };

  if (opts?.pageEntries && opts.pageEntries.length > 0) {
    for (const pe of opts.pageEntries) pushEntry(pe);
  } else {
    for (const id of uniq(memoryIds)) {
      const ref = opts?.memoryPhotoRefs?.[id]?.trim();
      pushEntry(ref ? { memoryId: id, photoRef: ref } : { memoryId: id });
    }
  }

  if (toAppend.length === 0) {
    return normalized;
  }

  const entries = [...current, ...toAppend];
  if (entries.length > MAX_BOOK_PAGE_ENTRIES) {
    throw new Error(
      `Un livre peut contenir au maximum ${MAX_BOOK_PAGE_ENTRIES} pages (actuellement ${current.length}).`,
    );
  }

  const derived = deriveBookIdsAndRefsFromEntries(entries);
  await assertBookMemoriesAllowedForTier(derived.memoryIds);

  const next: Book = {
    ...normalized,
    memoryIds: derived.memoryIds,
    pageEntries: entries,
    memoryPhotoRefs: derived.memoryPhotoRefs,
  };
  await upsertBook(next);
  return next;
}

export async function addMemoryToBook(bookId: string, memoryId: string): Promise<Book | null> {
  return addMemoriesToBook(bookId, [memoryId]);
}

/** Retire toutes les pages des souvenirs donnés (memoryIds). */
export async function removeMemoriesFromBook(bookId: string, memoryIds: string[]): Promise<Book | null> {
  const remove = new Set(uniq(memoryIds));
  const b = getLocalBook(bookId);
  if (!b) return null;
  if (remove.size === 0) return b;
  const normalized = normalizeBook(b) ?? b;
  const entries = bookPageEntries(normalized).filter(e => !remove.has(e.memoryId.trim()));
  const derived = deriveBookIdsAndRefsFromEntries(entries);
  const next: Book = {
    ...normalized,
    memoryIds: derived.memoryIds,
    pageEntries: entries,
    memoryPhotoRefs: derived.memoryPhotoRefs,
  };
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
    // Suppression = irréversible : pousser tout de suite, sans attendre le debounce.
    flushBooksCloudBackupNow();
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
 * Backup cloud — compte produit (gratuit ou Petitmo+). Noms historiques `IfPremium` conservés.
 * On upsert l’état local vers Supabase.
 *
 * Ne jamais « mirroir-supprimer » le cloud quand le local est vide (nouveau device / avant restore) :
 * sinon un login TestFlight efface tous les livres distants.
 * Les suppressions cloud passent uniquement par `flushPendingBookDeletesToSupabase`.
 */
/** Ref couverture durable pour le cloud (jamais un `file://` / book_covers sandbox). */
function coverPhotoUrlForCloudBackup(b: LocalBookRow): string | null {
  const book = normalizeBook({
    id: b.id,
    title: b.title,
    createdAt: b.createdAt,
    memoryIds: b.memoryIds ?? [],
    pageEntries: b.pageEntries,
    memoryPhotoRefs: b.memoryPhotoRefs,
    coverPhotoUrl: b.coverPhotoUrl,
    rotations: b.rotations,
    photoCrops: b.photoCrops,
    textEdits: b.textEdits,
    chapterTitle: b.chapterTitle,
  });
  if (!book) {
    const raw = (b.coverPhotoUrl ?? '').trim();
    return raw && isCloudMediaReference(raw) && !looksLikeStaleLocalCoverRef(raw) ? raw : null;
  }
  const healed = healStaleLocalCoverPhotoRef(book);
  const url = (healed.coverPhotoUrl ?? '').trim();
  if (url && isCloudMediaReference(url) && !looksLikeStaleLocalCoverRef(url)) return url;
  /**
   * Ref locale : remonter l’équivalent cloud **du souvenir choisi**.
   * Un repli ref vide renverrait la 1re photo du livre — au prochain restore Supabase
   * écrasait la couverture locale par l’ancienne.
   */
  const cloud =
    (url ? resolveBookCoverCloudFallbackUri(healed, url, 'list') : null) ??
    (url ? null : resolveBookCoverCloudFallbackUri(healed, '', 'list'));
  if (cloud && isCloudMediaReference(cloud)) return cloud;
  return null;
}

export async function backupBooksToSupabaseIfPremium(): Promise<void> {
  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return;

  const books = listLocalBooks();
  if (books.length === 0) return;

  const payload = books.map((b: LocalBookRow) => ({
    id: b.id,
    user_id: userId,
    title: b.title,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    memory_ids: b.memoryIds,
    page_entries: b.pageEntries ?? null,
    memory_photo_refs: b.memoryPhotoRefs ?? null,
    cover_photo_url: coverPhotoUrlForCloudBackup(b),
    cover_color_id: b.coverColorId ?? null,
    rotations: b.rotations ?? null,
    photo_crops: b.photoCrops ?? null,
    text_edits: b.textEdits ?? null,
    chapter_title: b.chapterTitle ?? null,
  }));

  // Upsert tout : robuste et idempotent.
  const { error: upsertErr } = await booksTable().upsert(payload, { onConflict: 'id' });
  if (!upsertErr) return;

  /**
   * Repli progressif si une migration manque en prod : ne retirer que le strict nécessaire,
   * sinon un simple `cover_color_id` absent ferait aussi perdre `page_entries` dans le cloud.
   */
  const withoutColor = payload.map(({ cover_color_id: _cc, ...rest }) => rest);
  const { error: noColorErr } = await booksTable().upsert(withoutColor, { onConflict: 'id' });
  if (!noColorErr) return;

  const legacy = payload.map(
    ({ page_entries: _pe, memory_photo_refs: _mr, cover_color_id: _cc, ...rest }) => rest,
  );
  await booksTable().upsert(legacy, { onConflict: 'id' });
}

/**
 * Backup cloud **groupé**. L’utilisatrice essaie plusieurs couleurs de couverture avant de
 * choisir : SQLite est écrit à chaque tap (source de vérité, instantané), mais le push
 * Supabase — qui envoie tous les livres — est coalescé.
 *
 * Fond uniquement : aucun `await` sur un chemin d’affichage, aucune erreur remontée à l’UI.
 */
const BOOKS_CLOUD_BACKUP_DEBOUNCE_MS = 2500;
let booksBackupTimer: ReturnType<typeof setTimeout> | null = null;
let booksBackupRunning = false;
let booksBackupDirty = false;

async function runBooksCloudBackup(): Promise<void> {
  // Un push est déjà en vol : marquer sale plutôt que d’en lancer un concurrent.
  if (booksBackupRunning) {
    booksBackupDirty = true;
    return;
  }
  booksBackupRunning = true;
  try {
    do {
      booksBackupDirty = false;
      await backupBooksToSupabaseIfPremium();
    } while (booksBackupDirty);
  } catch {
    /* réessai au prochain upsert / retour au premier plan */
  } finally {
    booksBackupRunning = false;
  }
}

/** Écriture locale faite → planifier le push cloud (coalescé). */
export function scheduleBooksCloudBackup(): void {
  if (booksBackupTimer) clearTimeout(booksBackupTimer);
  booksBackupTimer = setTimeout(() => {
    booksBackupTimer = null;
    void runBooksCloudBackup();
  }, BOOKS_CLOUD_BACKUP_DEBOUNCE_MS);
}

/** Mise en arrière-plan / suppression : pousser sans attendre le debounce. */
export function flushBooksCloudBackupNow(): void {
  if (booksBackupTimer) {
    clearTimeout(booksBackupTimer);
    booksBackupTimer = null;
  }
  void runBooksCloudBackup();
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

function safeMemoryPhotoRefs(x: unknown): Record<string, string> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const id = k.trim();
    const ref = typeof v === 'string' ? v.trim() : '';
    if (id && ref) out[id] = ref;
  }
  return Object.keys(out).length ? out : undefined;
}

function safePageEntries(x: unknown): BookPageEntry[] {
  if (!Array.isArray(x)) return [];
  const out: BookPageEntry[] = [];
  for (const e of x) {
    if (!e || typeof e !== 'object') continue;
    const mid =
      typeof (e as { memoryId?: unknown }).memoryId === 'string'
        ? (e as { memoryId: string }).memoryId.trim()
        : '';
    if (!mid) continue;
    const pr =
      typeof (e as { photoRef?: unknown }).photoRef === 'string'
        ? (e as { photoRef: string }).photoRef.trim()
        : '';
    out.push(pr ? { memoryId: mid, photoRef: pr } : { memoryId: mid });
  }
  return out;
}

/**
 * Restauration cloud → SQLite (compte produit : gratuit ou Petitmo+).
 * Règle de merge “safe” : on garde la version la plus récente (local.updatedAt vs remote.updated_at).
 */
export async function restoreBooksFromSupabaseIfPremium(): Promise<void> {
  const userId = await getRealAuthUserIdForBookCloudSync();
  if (!userId) return;

  let { data, error } = await booksTable()
    .select(
      'id, user_id, title, created_at, updated_at, memory_ids, page_entries, memory_photo_refs, cover_photo_url, cover_color_id, rotations, photo_crops, text_edits, chapter_title'
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    ({ data, error } = await booksTable()
      .select(
        'id, user_id, title, created_at, updated_at, memory_ids, page_entries, memory_photo_refs, cover_photo_url, rotations, photo_crops, text_edits, chapter_title'
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }));
  }

  if (error) {
    ({ data, error } = await booksTable()
      .select(
        'id, user_id, title, created_at, updated_at, memory_ids, cover_photo_url, rotations, photo_crops, text_edits, chapter_title'
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }));
  }

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
    /**
     * Le backup ne peut pousser qu’une ref **cloud** : une couverture encore local-only
     * remonte `null`. Ne jamais effacer la ref locale dans ce cas (sinon la liste
     * retombe sur la 1re photo du livre juste après un changement de couverture).
     */
    const remoteCoverPhotoUrl = typeof row.cover_photo_url === 'string' ? row.cover_photo_url : null;
    const coverPhotoUrl = remoteCoverPhotoUrl ?? local?.coverPhotoUrl ?? null;
    /**
     * `cover_color_id` peut manquer côté serveur (colonne pas encore déployée → le backup
     * retombe sur le payload legacy, et le `select` sur la variante sans la colonne).
     * Le choix local est la source de vérité : ne jamais l’effacer avec un remote absent.
     */
    const remoteCoverColorId =
      typeof row.cover_color_id === 'string' && row.cover_color_id.trim().length > 0
        ? row.cover_color_id.trim()
        : null;
    const coverColorId = remoteCoverColorId ?? local?.coverColorId ?? null;
    const rotations = safeRecordNumber(row.rotations);
    const photoCrops = safePhotoCrops(row.photo_crops);
    const textEdits = safeTextEdits(row.text_edits);
    const chapterTitle = typeof row.chapter_title === 'string' ? row.chapter_title : null;

    const remotePageEntries = safePageEntries(row.page_entries);
    const remoteMemoryPhotoRefs = safeMemoryPhotoRefs(row.memory_photo_refs);
    const localPageEntries = local?.pageEntries ?? [];
    const localMemoryPhotoRefs = local?.memoryPhotoRefs;

    // Jamais écraser des pageEntries APPEND locales plus riches par un remote sans pages.
    const pageEntries =
      remotePageEntries.length > 0
        ? localPageEntries.length > remotePageEntries.length
          ? localPageEntries
          : remotePageEntries
        : localPageEntries.length > 0
          ? localPageEntries
          : undefined;
    const memoryPhotoRefs =
      remoteMemoryPhotoRefs && Object.keys(remoteMemoryPhotoRefs).length > 0
        ? remoteMemoryPhotoRefs
        : localMemoryPhotoRefs;

    upsertLocalBook({
      id,
      title,
      createdAt,
      memoryIds,
      pageEntries,
      memoryPhotoRefs,
      coverPhotoUrl,
      coverColorId,
      rotations: rotations ?? undefined,
      photoCrops: photoCrops ?? undefined,
      textEdits: textEdits ?? undefined,
      chapterTitle,
    });
  }

  await healAllBookCovers(listBooksFromSqliteSync());
  notifyBooksUpdated();
}


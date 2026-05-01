import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteLocalBook, getLocalBook, listLocalBooks, upsertLocalBook, type LocalBookRow } from '@/lib/localDb';
import { getLocalMemoryById } from '@/lib/localDb';
import { getUserTier } from '@/lib/userTier';
import { supabase } from '@/lib/supabase';
import { FREE_TIER_BOOK_AUDIO_MAX_COUNT, FREE_TIER_BOOK_VOICE_MAX_DURATION } from '@/lib/limits';

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

export async function listBooks(): Promise<Book[]> {
  const books = await readAll();
  return books.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getBook(bookId: string): Promise<Book | null> {
  const b = getLocalBook(bookId);
  return b ? normalizeBook(b) : null;
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

  // Garde-fou produit : sur le plan gratuit, on limite les médias QR dans un livre dès l’ajout.
  const tier = await getUserTier();
  if (tier === 'free') {
    const existingIds = uniq(b.memoryIds ?? []);
    const allIds = uniq([...existingIds, ...ids]);
    const memories = allIds
      .map(id => getLocalMemoryById(id))
      .filter(Boolean) as Array<{ id: string; type: string; duration?: number | null }>;

    if (memories.some(m => m.type === 'video')) {
      throw new Error("Les vidéos ne sont pas disponibles dans les livres avec le plan gratuit.");
    }

    const audios = memories.filter(m => m.type === 'voice');
    if (audios.length > FREE_TIER_BOOK_AUDIO_MAX_COUNT) {
      throw new Error(
        `Avec le plan gratuit, ce livre peut contenir au maximum ${FREE_TIER_BOOK_AUDIO_MAX_COUNT} souvenirs audio.`
      );
    }
    const tooLong = audios.find(m => (m.duration ?? 0) > FREE_TIER_BOOK_VOICE_MAX_DURATION);
    if (tooLong) {
      throw new Error(
        `Avec le plan gratuit, chaque souvenir audio est limité à ${FREE_TIER_BOOK_VOICE_MAX_DURATION} secondes.`
      );
    }
  }

  const next: Book = { ...(normalizeBook(b) ?? b), memoryIds: uniq([...(b.memoryIds ?? []), ...ids]) };
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
  deleteLocalBook(bookId);
  void backupBooksToSupabaseIfPremium().catch(() => {});
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
  // NOTE: `books` doit exister dans `types/database.ts` (généré depuis Supabase) sinon TS échoue.
  await (supabase as unknown as { from: (t: string) => any }).from('books').upsert(payload, { onConflict: 'id' });
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

  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from('books')
    .select(
      'id, user_id, title, created_at, updated_at, memory_ids, cover_photo_url, rotations, photo_crops, text_edits, chapter_title'
    )
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error || !Array.isArray(data)) {
    return;
  }

  for (const row of data as Array<Record<string, unknown>>) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;

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
    const memoryIds = safeStringArray(row.memory_ids);
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
}


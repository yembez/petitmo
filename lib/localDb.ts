import * as SQLite from 'expo-sqlite'
import type { Child, Memory, MemorySyncStatus, UploadStatus } from '@/types/local'

const db = SQLite.openDatabaseSync('petitmo_local.db')

export function initLocalDb(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      local_media_path TEXT,
      local_original_path TEXT,
      local_thumb_path TEXT,
      local_display_path TEXT,
      local_print_path TEXT,
      original_px_w INTEGER,
      original_px_h INTEGER,
      print_px_w INTEGER,
      print_px_h INTEGER,
      media_url TEXT,
      thumb_url TEXT,
      display_url TEXT,
      print_url TEXT,
      poster_url TEXT,
      thumbnail_url TEXT,
      voice_cover_url TEXT,
      edited_media_url TEXT,
      extra_photo_urls TEXT,
      favorite_photo_urls TEXT,
      extra_thumb_urls TEXT,
      extra_display_urls TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      file_size INTEGER,
      location TEXT,
      created_at TEXT NOT NULL,
      inserted_at TEXT,
      updated_at TEXT,
      upload_status TEXT NOT NULL DEFAULT 'pending',
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      memoryIds TEXT NOT NULL DEFAULT '[]',
      coverPhotoUrl TEXT,
      rotations TEXT,
      photoCrops TEXT,
      textEdits TEXT,
      chapterTitle TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      birthdate TEXT,
      photo_url TEXT,
      local_photo_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_child_created
      ON memories(child_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memories_favorite
      ON memories(child_id, is_favorite, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memories_upload_status
      ON memories(upload_status);

    CREATE INDEX IF NOT EXISTS idx_books_created
      ON books(createdAt DESC);
  `)

  // Backfill schema for existing installs (CREATE TABLE IF NOT EXISTS ne rajoute pas de colonnes).
  // SQLite: ADD COLUMN est idempotent seulement si on teste la présence via PRAGMA.
  try {
    const cols = db.getAllSync(`PRAGMA table_info(memories)`, []) as { name?: string }[];
    const names = new Set(cols.map(c => (c?.name ?? '').trim()).filter(Boolean));
    const add = (name: string, type: string) => {
      if (names.has(name)) return;
      db.execSync(`ALTER TABLE memories ADD COLUMN ${name} ${type};`);
    };
    add('local_original_path', 'TEXT');
    add('local_thumb_path', 'TEXT');
    add('local_display_path', 'TEXT');
    add('local_print_path', 'TEXT');
    add('original_px_w', 'INTEGER');
    add('original_px_h', 'INTEGER');
    add('print_px_w', 'INTEGER');
    add('print_px_h', 'INTEGER');
    add('sync_status', "TEXT DEFAULT 'synced'");
  } catch {
    // Silencieux (ne doit pas empêcher l’app de démarrer)
  }
}

export function getLocalMemories(childId: string): Memory[] {
  const rows = db.getAllSync(
    `SELECT * FROM memories 
     WHERE child_id = ? 
     ORDER BY created_at DESC`,
    [childId]
  ) as Record<string, unknown>[]
  return rows.map(deserializeMemory)
}

export type LocalBookRow = {
  id: string
  title: string
  createdAt: string
  memoryIds: string[]
  coverPhotoUrl?: string | null
  rotations?: Record<string, number>
  photoCrops?: Record<string, { xPct: number; yPct: number; scale: number }>
  textEdits?: Record<string, { content?: string | null }>
  chapterTitle?: string | null
  updatedAt: string
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function uniq(xs: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of xs) {
    const t = (x ?? '').trim()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function deserializeLocalBook(row: Record<string, unknown>): LocalBookRow {
  const createdAt = (row.createdAt as string) ?? new Date().toISOString()
  const updatedAt = (row.updatedAt as string) ?? createdAt
  const memoryIds = uniq(safeJsonParse(row.memoryIds as string, [] as string[]))

  const rotations = safeJsonParse(row.rotations as string, {} as Record<string, number>)
  const photoCrops = safeJsonParse(
    row.photoCrops as string,
    {} as Record<string, { xPct: number; yPct: number; scale: number }>
  )
  const textEdits = safeJsonParse(row.textEdits as string, {} as Record<string, { content?: string | null }>)

  return {
    id: row.id as string,
    title: (row.title as string) ?? 'Livre',
    createdAt,
    updatedAt,
    memoryIds,
    coverPhotoUrl: (row.coverPhotoUrl as string | null) ?? null,
    rotations: Object.keys(rotations).length ? rotations : undefined,
    photoCrops: Object.keys(photoCrops).length ? photoCrops : undefined,
    textEdits: Object.keys(textEdits).length ? textEdits : undefined,
    chapterTitle:
      typeof row.chapterTitle === 'string' && row.chapterTitle.trim().length > 0 ? (row.chapterTitle as string) : null,
  }
}

export function listLocalBooks(): LocalBookRow[] {
  const rows = db.getAllSync(`SELECT * FROM books ORDER BY createdAt DESC`, []) as Record<string, unknown>[]
  return rows.map(deserializeLocalBook)
}

export function getLocalBook(bookId: string): LocalBookRow | null {
  const row = db.getFirstSync(`SELECT * FROM books WHERE id = ? LIMIT 1`, [bookId]) as
    | Record<string, unknown>
    | undefined
  return row ? deserializeLocalBook(row) : null
}

export function upsertLocalBook(book: Omit<LocalBookRow, 'updatedAt'>): void {
  const now = new Date().toISOString()
  const memoryIds = uniq(book.memoryIds ?? [])
  db.runSync(
    `INSERT OR REPLACE INTO books (
      id, title, createdAt, memoryIds, coverPhotoUrl,
      rotations, photoCrops, textEdits, chapterTitle,
      updatedAt
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      book.id,
      (book.title ?? '').trim() || 'Livre',
      book.createdAt ?? now,
      JSON.stringify(memoryIds),
      book.coverPhotoUrl ?? null,
      book.rotations ? JSON.stringify(book.rotations) : null,
      book.photoCrops ? JSON.stringify(book.photoCrops) : null,
      book.textEdits ? JSON.stringify(book.textEdits) : null,
      book.chapterTitle ?? null,
      now,
    ]
  )
}

export function deleteLocalBook(bookId: string): void {
  db.runSync(`DELETE FROM books WHERE id = ?`, [bookId])
}

export function getLocalMemoryById(id: string): Memory | null {
  const row = db.getFirstSync(
    `SELECT * FROM memories
     WHERE id = ?
     LIMIT 1`,
    [id]
  ) as Record<string, unknown> | undefined
  return row ? deserializeMemory(row) : null
}

export function upsertLocalMemory(memory: Memory, uploadStatus?: UploadStatus): void {
  const resolvedUpload = uploadStatus ?? memory.upload_status ?? 'full'
  const syncStatus: MemorySyncStatus =
    memory.sync_status === 'local' || memory.sync_status === 'pending' || memory.sync_status === 'synced'
      ? memory.sync_status
      : 'synced'

  db.runSync(
    `INSERT OR REPLACE INTO memories (
      id, child_id, type, content,
      local_media_path, local_original_path, local_thumb_path, local_display_path, local_print_path,
      original_px_w, original_px_h, print_px_w, print_px_h,
      media_url, thumb_url, display_url,
      print_url, poster_url, thumbnail_url, voice_cover_url,
      edited_media_url, extra_photo_urls, favorite_photo_urls,
      extra_thumb_urls, extra_display_urls,
      is_favorite, duration, file_size, location,
      created_at, inserted_at, updated_at,
      upload_status, sync_status, synced_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )`,
    [
      memory.id,
      memory.child_id,
      memory.type,
      memory.content ?? null,
      memory.local_media_path ?? null,
      memory.local_original_path ?? null,
      memory.local_thumb_path ?? null,
      memory.local_display_path ?? null,
      memory.local_print_path ?? null,
      memory.original_px_w ?? null,
      memory.original_px_h ?? null,
      memory.print_px_w ?? null,
      memory.print_px_h ?? null,
      memory.media_url ?? null,
      memory.thumb_url ?? null,
      memory.display_url ?? null,
      memory.print_url ?? null,
      memory.poster_url ?? null,
      memory.thumbnail_url ?? null,
      memory.voice_cover_url ?? null,
      memory.edited_media_url ?? null,
      JSON.stringify(memory.extra_photo_urls ?? []),
      JSON.stringify(memory.favorite_photo_urls ?? []),
      JSON.stringify(safeJsonArrayToStringArray(memory.extra_thumb_urls)),
      JSON.stringify(safeJsonArrayToStringArray(memory.extra_display_urls)),
      memory.is_favorite ? 1 : 0,
      memory.duration ?? null,
      memory.file_size ?? null,
      memory.location ?? null,
      memory.created_at,
      memory.inserted_at,
      memory.updated_at ?? null,
      resolvedUpload,
      syncStatus,
      memory.synced_at ?? new Date().toISOString(),
    ]
  )
}

export function upsertLocalMemories(
  memories: Memory[],
  uploadStatus?: UploadStatus
): void {
  // Transaction pour la performance — évite N commits séparés
  db.withTransactionSync(() => {
    for (const m of memories) {
      upsertLocalMemory(m, uploadStatus)
    }
  })
}

export function updateLocalMemoryUrls(
  id: string,
  urls: {
    media_url?: string
    thumb_url?: string
    display_url?: string
    print_url?: string
    poster_url?: string
    upload_status?: UploadStatus
  }
): void {
  const fields = Object.entries(urls)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`)
    .join(', ')
  const values = Object.values(urls).filter(v => v !== undefined)
  if (!fields) return
  db.runSync(
    `UPDATE memories SET ${fields}, synced_at = ? WHERE id = ?`,
    [...values, new Date().toISOString(), id]
  )
}

export function deleteLocalMemory(id: string): void {
  db.runSync('DELETE FROM memories WHERE id = ?', [id])
}

export function updateLocalMemoryFavorite(
  id: string,
  isFavorite: boolean
): void {
  db.runSync(
    `UPDATE memories 
     SET is_favorite = ?, synced_at = ? 
     WHERE id = ?`,
    [isFavorite ? 1 : 0, new Date().toISOString(), id]
  )
}

export function updateLocalMemoryContent(
  id: string,
  newContent: string
): void {
  db.runSync(
    `UPDATE memories SET content = ?, updated_at = ? WHERE id = ?`,
    [newContent, new Date().toISOString(), id]
  )
}

export function updateLocalMemoryLocation(id: string, location: string | null): void {
  const next = location?.trim() ? location.trim() : null
  db.runSync(
    `UPDATE memories SET location = ?, updated_at = ? WHERE id = ?`,
    [next, new Date().toISOString(), id]
  )
}

export function updateLocalMemoryFavoritePhotoUrls(id: string, urls: string[]): void {
  db.runSync(
    `UPDATE memories SET favorite_photo_urls = ?, synced_at = ? WHERE id = ?`,
    [JSON.stringify(urls), new Date().toISOString(), id]
  )
}

export function getLocalPendingMemories(): Memory[] {
  const rows = db.getAllSync(
    `SELECT * FROM memories 
     WHERE upload_status IN ('pending', 'thumb_only', 'print_only')
     ORDER BY created_at ASC`,
    []
  ) as Record<string, unknown>[]
  return rows.map(deserializeMemory)
}

export function getLocalMemoriesPendingCloudSync(): Memory[] {
  const rows = db.getAllSync(
    `SELECT * FROM memories
     WHERE sync_status IN ('local', 'pending')
        OR (sync_status IS NULL AND upload_status IN ('pending', 'thumb_only', 'print_only'))
     ORDER BY created_at ASC`,
    []
  ) as Record<string, unknown>[]
  return rows.map(deserializeMemory)
}

export function listLocalChildren(): Child[] {
  const rows = db.getAllSync(`SELECT * FROM children ORDER BY created_at DESC`, []) as Record<string, unknown>[]
  return rows.map(deserializeChild)
}

export function upsertLocalChild(child: Child): void {
  db.runSync(
    `INSERT OR REPLACE INTO children
     (id, user_id, name, birthdate, photo_url, local_photo_path, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      child.id,
      child.user_id,
      child.name,
      child.birthdate ?? null,
      child.photo_url ?? null,
      child.local_photo_path ?? null,
      child.created_at,
      child.updated_at ?? null,
    ]
  )
}

export function getLocalChild(childId: string): Child | null {
  const row = db.getFirstSync(
    'SELECT * FROM children WHERE id = ?',
    [childId]
  ) as Record<string, unknown> | undefined
  return row ? deserializeChild(row) : null
}

export function getFirstLocalChild(): Child | null {
  const row = db.getFirstSync(
    'SELECT * FROM children ORDER BY created_at ASC LIMIT 1',
    []
  ) as Record<string, unknown> | undefined
  return row ? deserializeChild(row) : null
}

function deserializeMemory(row: Record<string, unknown>): Memory {
  const createdAt = (row.created_at as string) ?? new Date().toISOString()
  const insertedAt = (row.inserted_at as string) ?? createdAt
  const updatedAt = (row.updated_at as string | null) ?? insertedAt

  return {
    // Champs Supabase
    id: row.id as string,
    child_id: row.child_id as string,
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    type: row.type as Memory['type'],
    content: row.content as string | null,
    media_url: row.media_url as string | null,
    media_path: row.media_path as string | null,
    extra_photo_urls: safeJsonParse(row.extra_photo_urls as string, []),
    extra_photo_paths: safeJsonParse(row.extra_photo_paths as string, []),
    extra_thumb_urls: safeJsonParse(row.extra_thumb_urls as string, []),
    extra_display_urls: safeJsonParse(row.extra_display_urls as string, []),
    favorite_photo_urls: safeJsonParse(row.favorite_photo_urls as string, []),
    voice_cover_url: row.voice_cover_url as string | null,
    voice_cover_path: row.voice_cover_path as string | null,
    edited_media_url: row.edited_media_url as string | null,
    is_favorite: row.is_favorite === 1,
    duration: row.duration as number | null,
    thumbnail_url: row.thumbnail_url as string | null,
    thumbnail_path: row.thumbnail_path as string | null,
    file_size: row.file_size as number | null,
    location: row.location as string | null,
    inserted_at: insertedAt,
    captured_overlay_ink: row.captured_overlay_ink as string | null,
    thumb_url: row.thumb_url as string | null,
    display_url: row.display_url as string | null,
    print_url: row.print_url as string | null,
    poster_url: row.poster_url as string | null,
    poster_print_url: row.poster_print_url as string | null,
    upload_status: (row.upload_status as UploadStatus) ?? 'pending',
    created_at: createdAt,
    updated_at: updatedAt,

    // Champs locaux
    local_media_path: row.local_media_path as string | null,
    local_original_path: (row.local_original_path as string | null) ?? null,
    local_thumb_path: (row.local_thumb_path as string | null) ?? null,
    local_display_path: (row.local_display_path as string | null) ?? null,
    local_print_path: (row.local_print_path as string | null) ?? null,
    original_px_w: (row.original_px_w as number | null) ?? null,
    original_px_h: (row.original_px_h as number | null) ?? null,
    print_px_w: (row.print_px_w as number | null) ?? null,
    print_px_h: (row.print_px_h as number | null) ?? null,
    synced_at: row.synced_at as string | null,
    sync_status:
      row.sync_status === 'local' || row.sync_status === 'pending' || row.sync_status === 'synced'
        ? row.sync_status
        : null,
  }
}

function deserializeChild(row: Record<string, unknown>): Child {
  const createdAt = (row.created_at as string) ?? new Date().toISOString()
  const updatedAt = (row.updated_at as string | null) ?? createdAt

  return {
    id: row.id as string,
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    name: row.name as string,
    birthdate: typeof row.birthdate === 'string' ? row.birthdate : '',
    photo_url: (row.photo_url as string | null) ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    local_photo_path: (row.local_photo_path as string | null) ?? null,
  }
}

// NOTE: safeJsonParse est défini plus haut (utilisé aussi par les livres)

function safeJsonArrayToStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(s => s.trim())
}


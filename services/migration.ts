import { getLocalMemoryById, getLocalMemoriesPendingCloudSync, upsertLocalMemory } from '@/lib/localDb';
import { setUserTier } from '@/lib/userTier';
import { remapLegacyEntityIdsForCloudSync, type LegacyIdRemapReport } from '@/services/cloudIdRemap';
import {
  ensureLocalChildrenSyncedToSupabase,
  type ChildrenSyncReport,
} from '@/services/children';
import {
  persistVoiceCoverToCloudForPdfExport,
  pushPhotoAlbumMemoryToCloud,
  resumePetitmoPlusCloudCaptureOrMerge,
  uploadFileToSupabase,
  uploadVoiceCoverToSupabaseFromLocal,
} from '@/services/media';
import { getUserMode } from '@/lib/userMode';
import { getUserTier } from '@/lib/userTier';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { Memory } from '@/types/local';
import { withLocalFields } from '@/services/memoryRowMapping';
import {
  collectPhotoCloudSyncUriCandidates,
  collectPhotoLocalUploadUriCandidates,
  collectVideoCloudSyncUriCandidates,
  collectVoiceCoverLocalUploadUriCandidates,
  getVoiceCoverUriForBookPreview,
} from '@/utils/memoryPhotos';
import { pickFirstReadableLocalMediaUri } from '@/utils/localMediaReadable';

export type MigrationProgress = {
  total: number;
  done: number;
  current: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
};

type ProgressCallback = (progress: MigrationProgress) => void;

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === '23505') return true;
  const msg = String((error as { message?: string }).message ?? '');
  return /duplicate key|unique constraint/i.test(msg);
}

function jsonStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function memoryHasAlbumExtras(memory: Memory): boolean {
  if (jsonStringArray(memory.extra_photo_paths).length > 0) return true;
  return jsonStringArray(memory.extra_photo_urls).some(u => !/^https?:\/\//i.test(u));
}

async function resolveReadableLocalPath(
  candidates: (string | null | undefined)[],
): Promise<string | null> {
  return pickFirstReadableLocalMediaUri(candidates);
}

async function describeUnsyncedReason(memory: Memory): Promise<string> {
  const after = getLocalMemoryById(memory.id) ?? memory;
  if (after.sync_status === 'synced' || /^https?:\/\//i.test((after.media_url ?? '').trim())) {
    return '';
  }

  let candidates: (string | null | undefined)[] = [];
  if (memory.type === 'photo') {
    candidates = collectPhotoCloudSyncUriCandidates(memory);
  } else if (memory.type === 'video') {
    candidates = collectVideoCloudSyncUriCandidates(memory);
  } else if (memory.type === 'voice') {
    candidates = [memory.local_original_path, memory.local_media_path];
  }

  if (candidates.some(c => (c ?? '').trim())) {
    const readable = await pickFirstReadableLocalMediaUri(candidates);
    if (!readable) {
      const hint = candidates
        .map(c => (c ?? '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p.slice(-48))
        .join(' | ');
      return `fichier local introuvable (testé: ${hint || '—'})`;
    }
  }

  return 'upload ou insert Supabase n’a pas abouti';
}

async function invokeProcessMemory(memoryId: string): Promise<void> {
  try {
    await supabase.functions.invoke('process-memory', { body: { memoryId } });
  } catch {
    /* best-effort */
  }
}

function isTextTitleSchemaError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error);
  return /text_title/i.test(msg) && /schema cache|could not find the/i.test(msg);
}

async function insertOrMergeMemoryOnce(
  row: Database['public']['Tables']['memories']['Insert']
): Promise<Memory> {
  const { data, error } = await supabase.from('memories').insert(row).select('*').single();
  if (!error && data) {
    return withLocalFields(data);
  }
  if (!isDuplicateKeyError(error) || !row.id) {
    throw new Error(error?.message ?? 'insert memories a échoué');
  }
  const { id, ...patch } = row;
  const { data: updated, error: upErr } = await supabase
    .from('memories')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (upErr || !updated) {
    throw new Error(upErr?.message ?? 'update memories a échoué');
  }
  return withLocalFields(updated);
}

async function insertOrMergeMemory(
  row: Database['public']['Tables']['memories']['Insert']
): Promise<Memory> {
  try {
    return await insertOrMergeMemoryOnce(row);
  } catch (e) {
    if (!('text_title' in row) || !isTextTitleSchemaError(e)) throw e;
    const { text_title: _ignored, ...withoutTitle } = row;
    if (__DEV__) {
      console.warn('[migration] text_title absent côté Supabase — insert sans titre (migration SQL à appliquer)');
    }
    return await insertOrMergeMemoryOnce(withoutTitle);
  }
}

const MIGRATION_UPLOAD_OPTS = { upsert: true } as const;

async function migrateText(memory: Memory, userId: string): Promise<void> {
  const insert: Database['public']['Tables']['memories']['Insert'] = {
    id: memory.id,
    child_id: memory.child_id,
    user_id: userId,
    type: 'text',
    content: memory.content,
    text_title: memory.text_title ?? null,
    location: memory.location,
    inserted_at: memory.inserted_at ?? memory.created_at,
    created_at: memory.created_at,
    updated_at: memory.updated_at ?? memory.created_at,
  };
  const merged = await insertOrMergeMemory(insert);
  if (merged) {
    upsertLocalMemory({ ...merged, sync_status: 'synced' });
  }
}

function voiceMemoryHasCloudMedia(m: Memory): boolean {
  const p = (m.media_path ?? '').trim();
  const u = (m.media_url ?? '').trim();
  return !!p && /^https:\/\//i.test(u);
}

const BARE_MEDIA_PATH_RE =
  /^(guest\/exports\/|exports\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)/i;

/**
 * Lors de la création d’un livre / PDF : assure vocal + cover en Supabase/Storage pour les QR.
 * Les vocaux 100 % locaux (plan gratuit) sont poussés ici, pas à la capture.
 * Si l’audio est déjà cloud mais la cover encore locale (souvent Petitmo+), on pousse la cover seule.
 */
export async function ensureVoiceMemoryCloudForBookExport(memory: Memory, userId: string): Promise<void> {
  if (memory.type !== 'voice') return;
  if ((memory.user_id ?? '').trim() && memory.user_id !== userId) return;

  if (!voiceMemoryHasCloudMedia(memory)) {
    const audioUri = await resolveReadableLocalPath([
      memory.local_original_path,
      memory.local_media_path,
    ]);
    if (!audioUri) return;
    await migrateVoice(memory, userId);
  }

  const refreshed = getLocalMemoryById(memory.id) ?? memory;
  const cand = getVoiceCoverUriForBookPreview(refreshed).trim();
  const coverReadable = await resolveReadableLocalPath([
    cand,
    ...collectVoiceCoverLocalUploadUriCandidates(refreshed),
  ]);
  if (
    coverReadable &&
    !/^https?:\/\//i.test(coverReadable) &&
    !BARE_MEDIA_PATH_RE.test(coverReadable)
  ) {
    await persistVoiceCoverToCloudForPdfExport(refreshed.id, refreshed.child_id, coverReadable);
  }
}

async function migrateVoice(memory: Memory, userId: string): Promise<void> {
  const audioUri = await resolveReadableLocalPath([
    memory.local_original_path,
    memory.local_media_path,
  ]);
  if (!audioUri) return;

  const noQuery = audioUri.split('?')[0] ?? '';
  const extFromUri = noQuery.includes('.') ? (noQuery.split('.').pop() ?? 'm4a').toLowerCase() : 'm4a';
  const ext = ['m4a', 'mp3', 'aac', 'wav', 'caf'].includes(extFromUri) ? extFromUri : 'm4a';
  const pathRel = `${userId}/${memory.child_id}/voice/${memory.id}.${ext}`;
  const mediaUrl = await uploadFileToSupabase(audioUri, `media/${pathRel}`, MIGRATION_UPLOAD_OPTS);

  let voiceCoverUrl: string | null = null;
  let voiceCoverPath: string | null = null;
  const coverLocal = await resolveReadableLocalPath([
    memory.voice_cover_path,
    ...collectVoiceCoverLocalUploadUriCandidates(memory),
  ]);
  if (coverLocal && !/^https?:\/\//i.test(coverLocal)) {
    try {
      const up = await uploadVoiceCoverToSupabaseFromLocal(userId, memory.child_id, coverLocal);
      voiceCoverUrl = up?.publicUrl ?? null;
      voiceCoverPath = up?.path ?? null;
    } catch {
      voiceCoverUrl = null;
      voiceCoverPath = null;
    }
  } else if (memory.voice_cover_url?.trim() && /^https?:\/\//i.test(memory.voice_cover_url)) {
    voiceCoverUrl = memory.voice_cover_url.trim();
    voiceCoverPath = memory.voice_cover_path;
  }

  const insert: Database['public']['Tables']['memories']['Insert'] = {
    id: memory.id,
    child_id: memory.child_id,
    user_id: userId,
    type: 'voice',
    media_url: mediaUrl,
    media_path: pathRel,
    duration: memory.duration,
    file_size: memory.file_size,
    location: memory.location,
    voice_cover_url: voiceCoverUrl,
    voice_cover_path: voiceCoverPath,
    inserted_at: memory.inserted_at ?? memory.created_at,
    created_at: memory.created_at,
    updated_at: memory.updated_at ?? memory.created_at,
    upload_status: 'full',
  };

  const merged = await insertOrMergeMemory(insert);
  if (merged) {
    upsertLocalMemory({ ...merged, sync_status: 'synced' });
    void invokeProcessMemory(memory.id);
  }
}

async function migratePhoto(memory: Memory, userId: string): Promise<void> {
  const src = await resolveReadableLocalPath(collectPhotoCloudSyncUriCandidates(memory));
  if (!src) {
    throw new Error('aucun fichier photo local lisible');
  }

  const storagePath = `${userId}/${memory.child_id}/photo/${memory.id}_migrate.jpg`;
  const mediaUrl = await uploadFileToSupabase(src, `media/${storagePath}`, MIGRATION_UPLOAD_OPTS);

  let thumbUrl: string | null = null;
  let displayUrl: string | null = null;
  const thumbLocal = await resolveReadableLocalPath([
    memory.local_thumb_path,
    memory.local_media_path,
  ]);
  if (thumbLocal) {
    const tPath = `${userId}/${memory.child_id}/photo/${memory.id}_thumb.jpg`;
    try {
      thumbUrl = await uploadFileToSupabase(thumbLocal, `media/${tPath}`, MIGRATION_UPLOAD_OPTS);
      displayUrl = thumbUrl;
    } catch {
      thumbUrl = null;
      displayUrl = null;
    }
  }

  const insert: Database['public']['Tables']['memories']['Insert'] = {
    id: memory.id,
    child_id: memory.child_id,
    user_id: userId,
    type: 'photo',
    media_url: mediaUrl,
    media_path: storagePath,
    thumb_url: thumbUrl,
    display_url: displayUrl ?? thumbUrl,
    print_url: null,
    extra_photo_urls: memory.extra_photo_urls ?? [],
    extra_photo_paths: memory.extra_photo_paths ?? [],
    extra_thumb_urls: memory.extra_thumb_urls ?? [],
    extra_display_urls: memory.extra_display_urls ?? [],
    favorite_photo_urls: memory.favorite_photo_urls ?? [],
    file_size: memory.file_size,
    location: memory.location,
    inserted_at: memory.inserted_at ?? memory.created_at,
    created_at: memory.created_at,
    updated_at: memory.updated_at ?? memory.created_at,
    upload_status: thumbUrl ? 'full' : 'pending',
    is_favorite: memory.is_favorite,
  };

  const merged = await insertOrMergeMemory(insert);
  if (merged) {
    upsertLocalMemory({ ...merged, sync_status: 'synced' });
    void invokeProcessMemory(memory.id);
  }
}

async function migrateVideo(memory: Memory, userId: string): Promise<void> {
  const src = await resolveReadableLocalPath(collectVideoCloudSyncUriCandidates(memory));
  if (!src) {
    throw new Error('aucun fichier vidéo local lisible');
  }

  const noQuery = src.split('?')[0] ?? '';
  const extFromUri = noQuery.includes('.') ? (noQuery.split('.').pop() ?? 'mp4').toLowerCase() : 'mp4';
  const ext = ['mp4', 'mov', 'm4v', 'webm'].includes(extFromUri) ? extFromUri : 'mp4';
  const storagePath = `${userId}/${memory.child_id}/video/${memory.id}.${ext}`;
  const mediaUrl = await uploadFileToSupabase(src, `media/${storagePath}`, MIGRATION_UPLOAD_OPTS);

  const insert: Database['public']['Tables']['memories']['Insert'] = {
    id: memory.id,
    child_id: memory.child_id,
    user_id: userId,
    type: 'video',
    media_url: mediaUrl,
    media_path: storagePath,
    duration: memory.duration,
    file_size: memory.file_size,
    location: memory.location,
    thumbnail_url: memory.thumbnail_url,
    poster_url: memory.poster_url,
    inserted_at: memory.inserted_at ?? memory.created_at,
    created_at: memory.created_at,
    updated_at: memory.updated_at ?? memory.created_at,
    upload_status: 'pending',
    is_favorite: memory.is_favorite,
  };

  const merged = await insertOrMergeMemory(insert);
  if (merged) {
    upsertLocalMemory({ ...merged, sync_status: 'synced' });
    void invokeProcessMemory(memory.id);
  }
}

/** Ligne déjà poussée (URL distante) : marquer SQLite en `synced`. */
function markSyncedIfRemote(memory: Memory): boolean {
  const remote = (memory.media_url ?? '').trim();
  if (memory.type === 'text') return false;
  if (!remote.startsWith('http')) return false;
  upsertLocalMemory({ ...memory, sync_status: 'synced' });
  return true;
}

/** Ancien flux « pending » : ligne Supabase existante, compléter `media_url`. */
async function legacyPatchMediaUrl(memory: Memory): Promise<void> {
  const candidates =
    memory.type === 'photo'
      ? collectPhotoCloudSyncUriCandidates(memory)
      : memory.type === 'video'
        ? collectVideoCloudSyncUriCandidates(memory)
        : [memory.local_media_path, memory.local_original_path];
  const localPath = await resolveReadableLocalPath(candidates);
  if (!localPath) {
    throw new Error('aucun fichier local lisible pour legacyPatchMediaUrl');
  }

  let mediaUrl: string | null = null;
  if (memory.type === 'photo') {
    mediaUrl = await uploadFileToSupabase(localPath, `media/${memory.id}/original.jpg`, MIGRATION_UPLOAD_OPTS);
  } else if (memory.type === 'video') {
    mediaUrl = await uploadFileToSupabase(localPath, `media/${memory.id}/video.mp4`, MIGRATION_UPLOAD_OPTS);
  } else {
    return;
  }
  if (!mediaUrl) return;

  const { error } = await supabase.from('memories').update({ media_url: mediaUrl }).eq('id', memory.id);
  if (!error) {
    upsertLocalMemory({
      ...memory,
      media_url: mediaUrl,
      upload_status: 'full',
      sync_status: 'synced',
    });
    void invokeProcessMemory(memory.id);
  }
}

/**
 * Pousse un souvenir local vers Supabase (insert/merge + upload Storage) au besoin.
 * Ne modifie pas le tier utilisateur : utile pour préparer un export livre.
 */
export async function ensureMemoryUploadedForCloud(
  memory: Memory,
  opts?: { forceCloud?: boolean },
): Promise<void> {
  const { data: { user: initialUser } } = await supabase.auth.getUser();
  if (!initialUser) {
    const session = await ensureSupabaseSession();
    if (!session.ok) return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Mode gratuit : souvenirs 100 % locaux — pas de push mémoires vers Supabase (règle d’or).
  if (!opts?.forceCloud && (await getUserMode()) === 'local') return;

  if (markSyncedIfRemote(memory)) return;

  if (
    memory.type === 'text' &&
    (memory.sync_status === 'local' || memory.sync_status === 'pending')
  ) {
    await migrateText(memory, user.id);
    return;
  }

  if (
    memory.type === 'photo' &&
    (memory.sync_status === 'local' || memory.sync_status === 'pending')
  ) {
    const paid = (await getUserTier()) === 'paid';
    if (memoryHasAlbumExtras(memory)) {
      await pushPhotoAlbumMemoryToCloud(memory, user.id, paid);
    } else if (memory.sync_status === 'local') {
      await migratePhoto(memory, user.id);
    } else {
      await resumePetitmoPlusCloudCaptureOrMerge(memory, user.id, paid);
    }
    return;
  }

  const isStrictLocal = memory.sync_status === 'local';

  if (isStrictLocal) {
    if (memory.type === 'voice') {
      await migrateVoice(memory, user.id);
      return;
    }
    if (memory.type === 'video') {
      await migrateVideo(memory, user.id);
      return;
    }
    return;
  }

  await legacyPatchMediaUrl(memory);
}

/** Compte-rendu diagnostic de la migration gratuit → cloud. */
export type CloudMigrationReport = {
  hasUser: boolean;
  userId: string | null;
  idRemap: LegacyIdRemapReport;
  children: ChildrenSyncReport;
  memTotal: number;
  memUploaded: number;
  memSkipped: number;
  memErrors: string[];
};

/** Une ligne est-elle réellement montée côté cloud après tentative ? */
function memoryLooksSynced(memory: Memory): boolean {
  const after = getLocalMemoryById(memory.id) ?? memory;
  if (after.sync_status === 'synced') return true;
  return /^https?:\/\//i.test((after.media_url ?? '').trim());
}

export async function upgradeToFullCloud(onProgress?: ProgressCallback): Promise<CloudMigrationReport> {
  await setUserTier('paid');

  const idRemap = await remapLegacyEntityIdsForCloudSync();
  const childrenReport = await ensureLocalChildrenSyncedToSupabase();

  const report: CloudMigrationReport = {
    hasUser: childrenReport.hasUser,
    userId: childrenReport.userId,
    idRemap,
    children: childrenReport,
    memTotal: 0,
    memUploaded: 0,
    memSkipped: 0,
    memErrors: [],
  };

  const pending = getLocalMemoriesPendingCloudSync();

  const total = pending.length;
  report.memTotal = total;
  onProgress?.({
    total,
    done: 0,
    current: null,
    status: 'running',
  });

  let done = 0;

  for (const memory of pending) {
    const label = memory.content?.trim().slice(0, 30) ?? 'Souvenir';

    onProgress?.({
      total,
      done,
      current: label,
      status: 'running',
    });

    try {
      await ensureMemoryUploadedForCloud(memory, { forceCloud: true });
      if (memoryLooksSynced(memory)) {
        report.memUploaded += 1;
      } else {
        report.memSkipped += 1;
        const reason = await describeUnsyncedReason(memory);
        report.memErrors.push(
          `${memory.type} ${memory.id.slice(0, 8)}: non synchronisé${reason ? ` (${reason})` : ''}.`,
        );
      }
    } catch (e) {
      report.memErrors.push(
        `${memory.type} ${memory.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    done += 1;

    await new Promise<void>(r => setTimeout(r, 150));
  }

  onProgress?.({
    total,
    done,
    current: null,
    status: 'done',
  });

  if (__DEV__) {
    console.log('[upgradeToFullCloud] report', JSON.stringify(report, null, 2));
  }

  return report;
}

export async function retryFailedMigrations(): Promise<void> {
  await upgradeToFullCloud();
}

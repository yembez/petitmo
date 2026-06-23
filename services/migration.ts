import { getInfoAsync } from 'expo-file-system/legacy';
import { getLocalMemoryById, getLocalMemoriesPendingCloudSync, upsertLocalMemory } from '@/lib/localDb';
import { setUserTier } from '@/lib/userTier';
import { ensureLocalChildrenSyncedToSupabase } from '@/services/children';
import {
  persistVoiceCoverToCloudForPdfExport,
  pushPhotoAlbumMemoryToCloud,
  resumePetitmoPlusCloudCaptureOrMerge,
  uploadFileToSupabase,
  uploadVoiceCoverToSupabaseFromLocal,
} from '@/services/media';
import { getUserMode } from '@/lib/userMode';
import { getUserTier } from '@/lib/userTier';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { Memory } from '@/types/local';
import { withLocalFields } from '@/services/memoryRowMapping';
import { getVoiceCoverUriForBookPreview } from '@/utils/memoryPhotos';

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

function memoryHasAlbumExtras(memory: Memory): boolean {
  if ((memory.extra_photo_paths?.length ?? 0) > 0) return true;
  return (memory.extra_photo_urls ?? []).some(u => {
    const t = (u ?? '').trim();
    return t.length > 0 && !/^https?:\/\//i.test(t);
  });
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri);
    return info.exists && !info.isDirectory;
  } catch {
    return false;
  }
}

async function invokeProcessMemory(memoryId: string): Promise<void> {
  try {
    await supabase.functions.invoke('process-memory', { body: { memoryId } });
  } catch {
    /* best-effort */
  }
}

async function insertOrMergeMemory(
  row: Database['public']['Tables']['memories']['Insert']
): Promise<Memory | null> {
  const { data, error } = await supabase.from('memories').insert(row).select('*').single();
  if (!error && data) {
    return withLocalFields(data);
  }
  if (!isDuplicateKeyError(error) || !row.id) {
    return null;
  }
  const { id, ...patch } = row;
  const { data: updated, error: upErr } = await supabase
    .from('memories')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (upErr || !updated) return null;
  return withLocalFields(updated);
}

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
    const audioUri = (memory.local_original_path ?? memory.local_media_path ?? '').trim();
    if (!audioUri || !(await fileExists(audioUri))) return;
    await migrateVoice(memory, userId);
  }

  const refreshed = getLocalMemoryById(memory.id) ?? memory;
  const cand = getVoiceCoverUriForBookPreview(refreshed).trim();
  if (
    cand &&
    !/^https:\/\//i.test(cand) &&
    !BARE_MEDIA_PATH_RE.test(cand) &&
    (await fileExists(cand))
  ) {
    await persistVoiceCoverToCloudForPdfExport(refreshed.id, refreshed.child_id, cand);
  }
}

async function migrateVoice(memory: Memory, userId: string): Promise<void> {
  const audioUri = (memory.local_original_path ?? memory.local_media_path ?? '').trim();
  if (!audioUri || !(await fileExists(audioUri))) return;

  const noQuery = audioUri.split('?')[0] ?? '';
  const extFromUri = noQuery.includes('.') ? (noQuery.split('.').pop() ?? 'm4a').toLowerCase() : 'm4a';
  const ext = ['m4a', 'mp3', 'aac', 'wav', 'caf'].includes(extFromUri) ? extFromUri : 'm4a';
  const pathRel = `${userId}/${memory.child_id}/voice/${memory.id}.${ext}`;
  const mediaUrl = await uploadFileToSupabase(audioUri, `media/${pathRel}`);

  let voiceCoverUrl: string | null = null;
  let voiceCoverPath: string | null = null;
  const coverLocal = (memory.voice_cover_path ?? memory.voice_cover_url ?? '').trim();
  if (coverLocal && !/^https?:\/\//i.test(coverLocal) && (await fileExists(coverLocal))) {
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
  const src = (memory.local_original_path ?? memory.local_print_path ?? memory.local_media_path ?? '').trim();
  if (!src || !(await fileExists(src))) return;

  const storagePath = `${userId}/${memory.child_id}/photo/${memory.id}_migrate.jpg`;
  const mediaUrl = await uploadFileToSupabase(src, `media/${storagePath}`);

  let thumbUrl: string | null = null;
  let displayUrl: string | null = null;
  const thumbLocal = (memory.local_thumb_path ?? '').trim();
  if (thumbLocal && (await fileExists(thumbLocal))) {
    const tPath = `${userId}/${memory.child_id}/photo/${memory.id}_thumb.jpg`;
    try {
      thumbUrl = await uploadFileToSupabase(thumbLocal, `media/${tPath}`);
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
  const src = (memory.local_original_path ?? memory.local_media_path ?? '').trim();
  if (!src || !(await fileExists(src))) return;

  const noQuery = src.split('?')[0] ?? '';
  const extFromUri = noQuery.includes('.') ? (noQuery.split('.').pop() ?? 'mp4').toLowerCase() : 'mp4';
  const ext = ['mp4', 'mov', 'm4v', 'webm'].includes(extFromUri) ? extFromUri : 'mp4';
  const storagePath = `${userId}/${memory.child_id}/video/${memory.id}.${ext}`;
  const mediaUrl = await uploadFileToSupabase(src, `media/${storagePath}`);

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
  const localPath = (memory.local_media_path ?? '').trim();
  if (!localPath || !(await fileExists(localPath))) return;

  let mediaUrl: string | null = null;
  if (memory.type === 'photo') {
    mediaUrl = await uploadFileToSupabase(localPath, `media/${memory.id}/original.jpg`);
  } else if (memory.type === 'video') {
    mediaUrl = await uploadFileToSupabase(localPath, `media/${memory.id}/video.mp4`);
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
export async function ensureMemoryUploadedForCloud(memory: Memory): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Mode gratuit : souvenirs 100 % locaux — pas de push mémoires vers Supabase (règle d’or).
  if ((await getUserMode()) === 'local') return;

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

export async function upgradeToFullCloud(onProgress?: ProgressCallback): Promise<void> {
  await setUserTier('paid');
  await ensureLocalChildrenSyncedToSupabase();

  const pending = getLocalMemoriesPendingCloudSync();

  const total = pending.length;
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
      await ensureMemoryUploadedForCloud(memory);
    } catch {
      /* on continue */
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
}

export async function retryFailedMigrations(): Promise<void> {
  await upgradeToFullCloud();
}

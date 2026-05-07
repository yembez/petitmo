import type { Database } from '@/types/database'
import type { Memory, UploadStatus } from '@/types/local'

export type MemoryRowDb = Database['public']['Tables']['memories']['Row']

export type WithLocalFieldsOpts = {
  clientUploadStatus?: UploadStatus
}

export function inferUploadStatusFromRow(row: MemoryRowDb): UploadStatus {
  const u = row.upload_status
  if (u === 'pending' || u === 'thumb_only' || u === 'print_only' || u === 'full') return u
  if (row.type === 'text') return 'full'
  if (row.media_url && String(row.media_url).trim() !== '') return 'full'
  if (row.media_path && String(row.media_path).trim() !== '') return 'full'
  if (
    row.print_url &&
    String(row.print_url).trim() !== '' &&
    row.thumb_url &&
    String(row.thumb_url).trim() !== ''
  ) {
    return 'print_only'
  }
  if (row.thumb_url && String(row.thumb_url).trim() !== '') return 'thumb_only'
  return 'pending'
}

export function withLocalFields(row: MemoryRowDb, opts?: WithLocalFieldsOpts): Memory {
  return {
    ...row,
    upload_status: opts?.clientUploadStatus ?? inferUploadStatusFromRow(row),
    local_media_path: null,
    local_original_path: null,
    local_thumb_path: null,
    local_display_path: null,
    local_print_path: null,
    original_px_w: null,
    original_px_h: null,
    print_px_w: null,
    print_px_h: null,
    synced_at: null,
    import_asset_id: null,
    import_source_fingerprint: null,
  }
}

function nonEmptyTrimmed(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return t ? t : null
}

/** Pull encore incomplet (dérivés worker) : ne pas écraser les URLs déjà présentes en local. */
function preferRemoteElseLocal(
  remote: string | null | undefined,
  local: string | null | undefined,
): string | null {
  const r = nonEmptyTrimmed(remote)
  if (r) return remote!.trim()
  const l = nonEmptyTrimmed(local)
  return l ? local!.trim() : null
}

function preferJsonArray(remote: unknown, local: unknown): unknown {
  const rr = Array.isArray(remote) ? remote.filter(Boolean) : []
  if (rr.length > 0) return remote
  const lr = Array.isArray(local) ? local.filter(Boolean) : []
  return lr.length > 0 ? local : remote
}

/**
 * Le serveur ne stocke pas les fichiers sandbox ; après un pull, on **conserve** les pointeurs
 * déjà en SQLite pour rester local-first (affichage fil / offline) tant que l’appareil les a.
 */
export function mergeServerMemoryRowWithExistingLocal(
  row: MemoryRowDb,
  existing: Memory | null | undefined,
  opts?: WithLocalFieldsOpts,
): Memory {
  const base = withLocalFields(row, opts)
  if (!existing) return base

  const pickPath = (loc: string | null | undefined) => nonEmptyTrimmed(loc) ?? null

  const mergedExtraPaths = (() => {
    const ex = existing.extra_photo_paths
    if (
      Array.isArray(ex) &&
      ex.some(e => typeof e === 'string' && e.trim().length > 0)
    ) {
      return ex
    }
    return base.extra_photo_paths
  })()

  return {
    ...base,
    media_url: preferRemoteElseLocal(base.media_url, existing.media_url),
    media_path: preferRemoteElseLocal(base.media_path, existing.media_path),
    thumb_url: preferRemoteElseLocal(base.thumb_url, existing.thumb_url),
    display_url: preferRemoteElseLocal(base.display_url, existing.display_url),
    print_url: preferRemoteElseLocal(base.print_url, existing.print_url),
    edited_media_url: preferRemoteElseLocal(base.edited_media_url, existing.edited_media_url),
    poster_url: preferRemoteElseLocal(base.poster_url, existing.poster_url),
    poster_print_url: preferRemoteElseLocal(base.poster_print_url, existing.poster_print_url),
    thumbnail_url: preferRemoteElseLocal(base.thumbnail_url, existing.thumbnail_url),
    thumbnail_path: preferRemoteElseLocal(base.thumbnail_path, existing.thumbnail_path),
    voice_cover_url: preferRemoteElseLocal(base.voice_cover_url, existing.voice_cover_url),
    extra_photo_urls: preferJsonArray(base.extra_photo_urls, existing.extra_photo_urls) as Memory['extra_photo_urls'],
    extra_thumb_urls: preferJsonArray(base.extra_thumb_urls, existing.extra_thumb_urls) as Memory['extra_thumb_urls'],
    extra_display_urls: preferJsonArray(base.extra_display_urls, existing.extra_display_urls) as Memory['extra_display_urls'],
    local_media_path: pickPath(existing.local_media_path) ?? base.local_media_path,
    local_original_path: pickPath(existing.local_original_path) ?? base.local_original_path,
    local_thumb_path: pickPath(existing.local_thumb_path) ?? base.local_thumb_path,
    local_display_path: pickPath(existing.local_display_path) ?? base.local_display_path,
    local_print_path: pickPath(existing.local_print_path) ?? base.local_print_path,
    original_px_w: existing.original_px_w ?? base.original_px_w,
    original_px_h: existing.original_px_h ?? base.original_px_h,
    print_px_w: existing.print_px_w ?? base.print_px_w,
    print_px_h: existing.print_px_h ?? base.print_px_h,
    voice_cover_path: pickPath(existing.voice_cover_path) ?? base.voice_cover_path,
    import_asset_id: existing.import_asset_id ?? base.import_asset_id,
    import_source_fingerprint: existing.import_source_fingerprint ?? base.import_source_fingerprint,
    extra_photo_paths: mergedExtraPaths,
  }
}

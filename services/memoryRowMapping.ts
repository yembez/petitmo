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

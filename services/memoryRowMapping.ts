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

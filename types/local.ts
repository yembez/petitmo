import type { Database } from './database'

export type UploadStatus = 'pending' | 'thumb_only' | 'print_only' | 'full'

/** Sync nuage : `local` = jamais poussé (gratuit strict), `pending` = upgrade en cours, `synced` = ligne Supabase alignée. */
export type MemorySyncStatus = 'local' | 'pending' | 'synced'

type SupabaseMemory = Database['public']['Tables']['memories']['Row']

export type LocalFields = {
  local_media_path: string | null
  /** Copie durable dans le sandbox de l’app (offline-first). */
  local_original_path?: string | null
  /** Dérivés locaux (offline) */
  local_thumb_path?: string | null
  local_display_path?: string | null
  local_print_path?: string | null
  /** Métadonnées pixels (pour DPI impression) */
  original_px_w?: number | null
  original_px_h?: number | null
  print_px_w?: number | null
  print_px_h?: number | null
  upload_status: UploadStatus
  synced_at: string | null
  sync_status?: MemorySyncStatus | null
}

export type Memory = SupabaseMemory & LocalFields

export type Child = Database['public']['Tables']['children']['Row'] & {
  local_photo_path: string | null
}


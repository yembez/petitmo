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
  /** Poster vidéo impression (`poster_print.jpg`) — distinct du poster fil (`poster.jpg`). */
  local_poster_print_path?: string | null
  /** Métadonnées pixels (pour DPI impression) */
  original_px_w?: number | null
  original_px_h?: number | null
  print_px_w?: number | null
  print_px_h?: number | null
  upload_status: UploadStatus
  synced_at: string | null
  sync_status?: MemorySyncStatus | null
  /** Id photothèque (expo-image-picker `assetId`) — dédoublonnage import par enfant. */
  import_asset_id?: string | null
  /** Empreinte stable pour un post-album (plusieurs `assetId` triés). */
  import_source_fingerprint?: string | null
  /** Token QR stable (`public_media_tokens`) — cache local SQLite, définitif par souvenir. */
  public_media_token?: string | null
}

export type Memory = SupabaseMemory & LocalFields

export type Child = Database['public']['Tables']['children']['Row'] & {
  local_photo_path: string | null
  /** Coordonnées du visage détecté (normalisées 0-1 par rapport aux dimensions de l'image). */
  face_cx?: number | null
  face_cy?: number | null
  face_h?: number | null
  /** Ratio largeur/hauteur de l'image source (pour recalculer les dimensions à l'affichage). */
  face_img_aspect?: number | null
}


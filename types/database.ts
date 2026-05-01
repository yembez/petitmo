export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      children: {
        Row: {
          id: string
          user_id: string
          name: string
          birthdate: string
          photo_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          birthdate: string
          photo_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          [key: string]: unknown
        }
        Relationships: []
      }
      memories: {
        Row: {
          id: string
          child_id: string
          user_id: string
          type: 'text' | 'voice' | 'photo' | 'video'
          content: string | null
          media_url: string | null
          /** Chemin Storage (bucket media) de `media_url` */
          media_path: string | null
          /** Albums : URLs des photos 2..n (JSON array) */
          extra_photo_urls: Json
          /** Albums : chemins Storage (JSON array) correspondant à extra_photo_urls */
          extra_photo_paths: Json
          /** Albums : URLs dérivées légères (thumb) des photos 2..n */
          extra_thumb_urls: Json
          /** Albums : URLs dérivées (display) des photos 2..n */
          extra_display_urls: Json
          /** Photos de l’album ajoutées une à une aux favoris (JSON array d’URLs) */
          favorite_photo_urls: Json
          voice_cover_url: string | null
          voice_cover_path: string | null
          /** Début de lecture (s) si le média est la prise complète ; null = fichier déjà rogné ou entier. */
          voice_playback_start_sec?: number | null
          edited_media_url: string | null
          is_favorite: boolean
          duration: number | null
          thumbnail_url: string | null
          thumbnail_path: string | null
          file_size: number | null
          location: string | null
          /** Date d'ajout dans l'app (ordre du fil) */
          inserted_at: string
          /** Couleur recommandée pour le texte overlay (date de prise) */
          captured_overlay_ink: string | null
          /** URL dérivée légère pour le feed (thumb) */
          thumb_url: string | null
          /** URL dérivée pour affichage plein écran (display) */
          display_url: string | null
          /** URL dérivée haute qualité (print) */
          print_url: string | null
          /** Poster vidéo (image) dérivé côté serveur */
          poster_url: string | null
          /** Poster vidéo HD (print) dérivé côté serveur */
          poster_print_url: string | null
          /** État d’upload (stratégie gratuit/payant) — optionnel tant que la migration n’est pas appliquée côté Supabase */
          upload_status?: 'pending' | 'thumb_only' | 'print_only' | 'full'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          child_id: string
          user_id: string
          type: 'text' | 'voice' | 'photo' | 'video'
          content?: string | null
          media_url?: string | null
          media_path?: string | null
          extra_photo_urls?: Json
          extra_photo_paths?: Json
          extra_thumb_urls?: Json
          extra_display_urls?: Json
          favorite_photo_urls?: Json
          voice_cover_url?: string | null
          voice_cover_path?: string | null
          voice_playback_start_sec?: number | null
          edited_media_url?: string | null
          is_favorite?: boolean
          duration?: number | null
          thumbnail_url?: string | null
          thumbnail_path?: string | null
          file_size?: number | null
          location?: string | null
          inserted_at?: string
          captured_overlay_ink?: string | null
          thumb_url?: string | null
          display_url?: string | null
          print_url?: string | null
          poster_url?: string | null
          poster_print_url?: string | null
          upload_status?: 'pending' | 'thumb_only' | 'print_only' | 'full'
          created_at?: string
          updated_at?: string
        }
        Update: {
          [key: string]: unknown
        }
        Relationships: []
      }
      crm_contacts: {
        Row: {
          id: string
          email: string
          full_name: string | null
          address_json: Json | null
          marketing_opt_in: boolean
          gdpr_consent_at: string
          last_seen_at: string
        }
        Insert: { [key: string]: unknown }
        Update: { [key: string]: unknown }
        Relationships: []
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}
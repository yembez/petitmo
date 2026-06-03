/**
 * Sous-ensemble des colonnes `memories` utilisé pour le rendu PDF serveur.
 */
export type MemoryRow = {
  id: string;
  child_id: string;
  /** Vérifié côté route (cohérence avec le JWT). */
  user_id: string;
  type: 'text' | 'voice' | 'photo' | 'video';
  content: string | null;
  media_url: string | null;
  /** Chemin bucket `media` pour téléchargement service role. */
  media_path: string | null;
  edited_media_url: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  display_url: string | null;
  print_url: string | null;
  poster_url: string | null;
  poster_print_url: string | null;
  /** Image de fond optionnelle pour une page vocal. */
  voice_cover_url: string | null;
  /** Chemin bucket `media` (souvent renseigné alors que `voice_cover_url` est encore null ou expiré). */
  voice_cover_path: string | null;
  /** Lieu affiché dans le livre (PDF / aperçu). */
  location: string | null;
  created_at: string;
};

export type ChildRow = {
  id: string;
  user_id: string;
  name: string;
  photo_url: string | null;
  /** Date de naissance (ISO) — sert au calcul de l'âge sous chaque souvenir. */
  birthdate?: string | null;
};

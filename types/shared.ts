/**
 * Contrats partagés app Expo ↔ service PDF (server/).
 * Ne pas importer React Native / expo ici.
 */

export type BookPageType =
  | 'cover'
  | 'photo-full'
  | 'photo-note'
  | 'quote'
  | 'audio'
  | 'video'
  | 'chapter'
  | 'back-cover';

export type BookPageServer = {
  type: BookPageType;
  memoryId?: string;
  month?: string;
  chapterNum?: number;
  rotation?: number;
  crop?: { xPct: number; yPct: number; scale: number };
  textOverride?: string;
  /** Gabarit photo pleine page — rendu CSS Phase 2. */
  variant?: 'FP' | 'M';
  /** Slot photo album (URL favorite) — parité aperçu livre / `memoryPhotoRefs`. */
  photoRef?: string;
};

export type SubscriptionTier = 'free' | 'premium';

/** Souvenirs inline pour export PDF avec ticket (sans compte). */
export type GuestMemoryForPdfPayload = {
  id: string;
  type: 'voice' | 'video' | 'photo' | 'text';
  content?: string | null;
  /** Titre optionnel sur souvenir texte (page livre avec titre). */
  text_title?: string | null;
  /** Lieu brut (optionnel) affiché si présent dans le livre. */
  location?: string | null;
  media_url?: string | null;
  media_path?: string | null;
  edited_media_url?: string | null;
  duration?: number | null;
  thumbnail_url?: string | null;
  display_url?: string | null;
  print_url?: string | null;
  poster_url?: string | null;
  poster_print_url?: string | null;
  /** Photo de fond optionnelle sur une page vocal (aligné `voice_cover_url` / maquette). */
  voice_cover_url?: string | null;
  /**
   * Date de prise / événement (alignée `memories.created_at` + maquette). **Requis** pour un PDF
   * cohérent avec l’aperçu ; sinon le serveur tombait sur « maintenant » (date d’export).
   */
  created_at?: string;
};

export type GenerateBookPdfPayload = {
  bookId: string;
  childId: string;
  /** Photo de couverture (URL HTTPS). Sinon `children.photo_url`. */
  coverPhotoUrl?: string | null;
  /** Pixels source couverture — recadrage `coverMode` (parité aperçu ↔ PDF). */
  coverPhotoImgPxW?: number;
  coverPhotoImgPxH?: number;
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  /**
   * Origine publique du service PDF (sans slash final), ex. `https://xxx.up.railway.app`.
   * Les QR médias utilisent `${qrBaseUrl}/q/${token}`.
   */
  qrBaseUrl: string;
  /** digital = Gelato 210×280 mm ; print = trim + fond perdu 4 mm (218×288 mm page PDF) */
  exportMode: 'digital' | 'print';
  pages: BookPageServer[];
  /** Tier effectif (doit refléter abonnement / achat côté app ; le serveur applique les règles). */
  subscriptionTier: SubscriptionTier;
  /**
   * Free : requis si pas premium — achat export digital à l’acte (4,99 €) validé côté app.
   * TODO: remplacer par validation serveur (reçu / Edge Function) quand l’IAP est branché.
   */
  digitalExportPaid?: boolean;
  /** Flux ticket : enfant inline (pas de ligne `children`). */
  guestChild?: { name: string; photo_url?: string | null; birthdate?: string | null };
  guestMemories?: GuestMemoryForPdfPayload[];
};

/** Réponse `POST /v1/books/generate-pdf` (spec). */
export type GenerateBookPdfResponse = {
  pdfUrlSigned: string;
  /** `books/...` dans bucket `books-pdf` si premium ; null si free (pas de rétention longue). */
  pdfStoragePath: string | null;
  /** Tokens QR stables par `memoryId` — à persister en SQLite local après export. */
  qrTokensByMemoryId?: Record<string, string>;
  /** Résultat envoi Gelato (flux impression `print_order` uniquement). */
  gelato?: {
    ok: boolean;
    skipped?: boolean;
    orderId?: string;
    orderType?: 'order' | 'draft';
    message?: string;
  };
};

/** Ligne attendue dans public.qr_links (migration Supabase). */
export type QrLinkRow = {
  id: string;
  token: string;
  child_id: string;
  memory_id: string;
  book_id: string;
  storage_bucket: string;
  media_path: string;
  kind: 'audio' | 'video';
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

/** Ligne `public.qr_links_exports` (export sans compte / ticket). */
export type QrLinkExportRow = {
  id: string;
  token: string;
  export_request_id: string;
  book_id: string;
  memory_client_id: string;
  storage_bucket: string;
  media_path: string;
  kind: 'audio' | 'video';
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

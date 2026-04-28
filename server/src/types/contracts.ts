/**
 * Aligné avec /types/shared.ts (dupliqué ici pour isoler le build server/).
 * Toute modification doit être reflétée des deux côtés.
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
};

export type SubscriptionTier = 'free' | 'premium';

/** Souvenirs inline pour export PDF avec ticket (sans lignes Supabase memories). */
export type GuestMemoryForPdfPayload = {
  id: string;
  type: 'voice' | 'video' | 'photo' | 'text';
  content?: string | null;
  media_url?: string | null;
  media_path?: string | null;
  edited_media_url?: string | null;
  duration?: number | null;
  thumbnail_url?: string | null;
  display_url?: string | null;
  print_url?: string | null;
  poster_url?: string | null;
  poster_print_url?: string | null;
};

export type GenerateBookPdfPayload = {
  bookId: string;
  childId: string;
  coverPhotoUrl?: string | null;
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  qrBaseUrl: string;
  exportMode: 'digital' | 'print';
  pages: BookPageServer[];
  subscriptionTier: SubscriptionTier;
  digitalExportPaid?: boolean;
  /**
   * Flux ticket (`init-export`) : enfant et médias hors table `children` / `memories`.
   * Requis si l’auth est un JWT ticket `export_pdf`.
   */
  guestChild?: { name: string; photo_url?: string | null };
  guestMemories?: GuestMemoryForPdfPayload[];
};

export type GenerateBookPdfResponse = {
  pdfUrlSigned: string;
  pdfStoragePath: string | null;
};

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

/** Ligne `public.qr_links_exports` (migration 20260427200000). */
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

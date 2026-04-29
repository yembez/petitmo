import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PDF_SIGNED_URL_SECONDS } from '../constants/spec';

export type SaveBookPdfParams = {
  userId: string;
  childId: string;
  bookId: string;
  exportMode: 'digital' | 'print';
  subscriptionTier: 'free' | 'premium';
  pdfBytes: Buffer;
};

export type SaveBookPdfResult = {
  pdfUrlSigned: string;
  pdfStoragePath: string | null;
};

/**
 * Premium : chemin persistant. Free : fichier temporaire (pas de chemin « livre » retourné).
 */
export async function saveBookPdfAndSign(
  supabase: SupabaseClient,
  params: SaveBookPdfParams
): Promise<SaveBookPdfResult> {
  const { userId, childId, bookId, exportMode, subscriptionTier, pdfBytes } = params;
  const modeSeg = exportMode === 'print' ? 'print' : 'digital';

  let storagePath: string;
  let persistentPath: string | null;

  if (subscriptionTier === 'premium') {
    storagePath = `books/${userId}/${childId}/${bookId}/${modeSeg}.pdf`;
    persistentPath = storagePath;
  } else {
    storagePath = `_tmp/${userId}/${bookId}-${modeSeg}-${randomUUID()}.pdf`;
    persistentPath = null;
  }

  const { error: upErr } = await supabase.storage.from('books-pdf').upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: subscriptionTier === 'premium',
  });

  if (upErr) {
    throw new Error(`books-pdf upload failed: ${upErr.message}`);
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from('books-pdf')
    .createSignedUrl(storagePath, PDF_SIGNED_URL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    throw new Error(signErr?.message ?? 'sign pdf failed');
  }

  return {
    pdfUrlSigned: signed.signedUrl,
    pdfStoragePath: persistentPath,
  };
}

export type SaveExportRequestPdfParams = {
  exportRequestId: string;
  bookId: string;
  exportMode: 'digital' | 'print';
  /** `paid` sur la ligne export = stockage persistant type premium. */
  subscriptionPaid: boolean;
  pdfBytes: Buffer;
};

/**
 * PDF pour une ligne `export_requests`.
 * - Si payé: chemin persistant par livre `books/{bookId}/pdf/{mode}.pdf`
 * - Sinon: chemin temporaire `_tmp/exports/...`
 */
export async function saveBookPdfForExportRequest(
  supabase: SupabaseClient,
  params: SaveExportRequestPdfParams
): Promise<SaveBookPdfResult> {
  const { exportRequestId, bookId, exportMode, subscriptionPaid, pdfBytes } = params;
  const modeSeg = exportMode === 'print' ? 'print' : 'digital';

  let storagePath: string;
  let persistentPath: string | null;

  if (subscriptionPaid) {
    storagePath = `books/${bookId}/pdf/${modeSeg}.pdf`;
    persistentPath = storagePath;
  } else {
    storagePath = `_tmp/exports/${exportRequestId}/${bookId}-${modeSeg}-${randomUUID()}.pdf`;
    persistentPath = null;
  }

  const { error: upErr } = await supabase.storage.from('books-pdf').upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: subscriptionPaid,
  });

  if (upErr) {
    throw new Error(`books-pdf upload failed: ${upErr.message}`);
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from('books-pdf')
    .createSignedUrl(storagePath, PDF_SIGNED_URL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    throw new Error(signErr?.message ?? 'sign pdf failed');
  }

  return {
    pdfUrlSigned: signed.signedUrl,
    pdfStoragePath: persistentPath,
  };
}

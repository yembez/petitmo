/**
 * Slot `guest-upload-urls` pour QR audio/vidéo livre.
 * Pas d’import vers la file d’upload (évite cycle avec `pendingRawGuestUploads`).
 *
 * Règle d’or : exception cloud ciblée après commande / export payé uniquement.
 */
import { postGuestUploadUrls } from '@/services/initExportApi';
import {
  ensureFreshExportUploadTicket,
  getPendingExportUploadTicketRecord,
} from '@/lib/pendingExportUploadTicket';
import type { Memory } from '@/types/local';

export type BookQrAvKind = 'audio' | 'video';

export type GuestAvUploadRow = {
  kind?: string;
  memoryId?: string | null;
  signedUrl?: string;
  alreadyReady?: boolean;
  token?: string;
  path?: string;
  bucket?: string;
};

export function bookQrAvKey(kind: BookQrAvKind, memoryId: string): string {
  return `${kind}:${memoryId.trim()}`;
}

export function bookQrAvKindForMemory(m: Memory): BookQrAvKind | null {
  if (m.type === 'voice') return 'audio';
  if (m.type === 'video') return 'video';
  return null;
}

/** Réponse `guest-upload-urls` : QR déjà matérialisé → rien à uploader. */
export function isGuestAvUploadAlreadyReady(row: GuestAvUploadRow | null | undefined): boolean {
  if (!row) return false;
  if (row.alreadyReady === true) return true;
  // Edge renvoie token + path ready sans signedUrl.
  if (!row.signedUrl?.trim() && !!row.token?.trim()) return true;
  return false;
}

function errorFromGuestUploadJson(json: Record<string, unknown>): string {
  if (typeof json.error === 'string' && json.error.trim()) return json.error.trim();
  if (typeof json.message === 'string' && json.message.trim()) return json.message.trim();
  return '';
}

function parseUploadRow(json: Record<string, unknown>): GuestAvUploadRow | null {
  const uploads = json.uploads;
  if (!Array.isArray(uploads) || uploads.length < 1) return null;
  return uploads[0] as GuestAvUploadRow;
}

/**
 * Demande un slot d’upload (ou confirme `alreadyReady`).
 * Sur 401 : renouvelle le ticket une fois (même commande / QR stable).
 * Le caller propage `pdfTicketUsed` à la file si besoin.
 */
export async function requestGuestAvUploadSlot(params: {
  pdfTicket: string;
  kind: BookQrAvKind;
  memoryId: string;
}): Promise<{
  status: number;
  row: GuestAvUploadRow | null;
  error: string;
  pdfTicketUsed: string;
}> {
  let pdfTicketUsed = params.pdfTicket.trim();
  const memoryId = params.memoryId.trim();
  if (!pdfTicketUsed || !memoryId) {
    return { status: 0, row: null, error: 'missing ticket or memoryId', pdfTicketUsed };
  }

  const call = (ticket: string) =>
    postGuestUploadUrls({
      pdfTicket: ticket,
      assets: [{ kind: params.kind, memoryId }],
    });

  let { status, json } = await call(pdfTicketUsed);
  let row = parseUploadRow(json);
  let error = errorFromGuestUploadJson(json);

  if (status === 401) {
    const rec = await getPendingExportUploadTicketRecord();
    const fresh = await ensureFreshExportUploadTicket({
      email: rec?.email,
      exportRequestId: rec?.exportRequestId,
    });
    if (fresh && fresh !== pdfTicketUsed) {
      pdfTicketUsed = fresh;
      ({ status, json } = await call(fresh));
      row = parseUploadRow(json);
      error = errorFromGuestUploadJson(json);
    }
  }

  return { status, row, error, pdfTicketUsed };
}

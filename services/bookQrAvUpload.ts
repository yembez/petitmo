/**
 * Préparation unifiée QR audio/vidéo livre (après commande / export payé).
 *
 * Contrat :
 * 1. Token déjà `ready` → skip (même QR, pas de re-upload).
 * 2. Sinon + fichier local → enqueue file `finalize_only` / `auto`.
 * 3. Ticket JWT : refresh auto si 401 (via `requestGuestAvUploadSlot`).
 *
 * Spec : `docs/specs/free-tier-book-qr-av.md`, `docs/specs/qr-media-permanence.md`.
 */
import type { Memory } from '@/types/local';
import {
  bookQrAvKey,
  bookQrAvKindForMemory,
  isGuestAvUploadAlreadyReady,
  requestGuestAvUploadSlot,
  type BookQrAvKind,
} from '@/services/bookQrAvUploadSlot';
import {
  enqueueGuestRawUpload,
  markGuestRawUploadDone,
  refreshAllPendingGuestRawUploadTickets,
} from '@/services/pendingRawGuestUploads';

export {
  bookQrAvKey,
  bookQrAvKindForMemory,
  isGuestAvUploadAlreadyReady,
  requestGuestAvUploadSlot,
  type BookQrAvKind,
  type GuestAvUploadRow,
} from '@/services/bookQrAvUploadSlot';

function localUriForAv(m: Memory): string {
  const fromLocal = (m.local_original_path ?? m.local_media_path ?? '').trim();
  if (fromLocal) return fromLocal;
  const fallback = (m.media_url ?? m.edited_media_url ?? '').trim();
  if (fallback.toLowerCase().startsWith('file:')) return fallback;
  return '';
}

function mimeForKind(kind: BookQrAvKind, localUri: string): string {
  if (kind === 'audio') return 'audio/mp4';
  const u = localUri.toLowerCase();
  if (u.endsWith('.mov') || u.includes('.mov?')) return 'video/quicktime';
  return 'video/mp4';
}

export type PrepareBookQrAvItemResult =
  | { key: string; outcome: 'already_ready' }
  | { key: string; outcome: 'enqueued' }
  | { key: string; outcome: 'skipped_no_local' }
  | { key: string; outcome: 'error'; message: string };

/**
 * Prépare tous les A/V d’un livre :
 * ready → skip ; sinon fichier local → file d’upload.
 */
export async function prepareBookQrAvUploads(params: {
  pdfTicket: string;
  memories: readonly Memory[];
  policy?: 'finalize_only' | 'auto';
}): Promise<{
  pdfTicketUsed: string;
  items: PrepareBookQrAvItemResult[];
  keys: string[];
  alreadyReadyCount: number;
  enqueuedCount: number;
  skippedNoLocalCount: number;
  errorCount: number;
}> {
  let pdfTicketUsed = params.pdfTicket.trim();
  const policy = params.policy ?? 'finalize_only';
  const items: PrepareBookQrAvItemResult[] = [];
  const keys: string[] = [];

  for (const m of params.memories) {
    const kind = bookQrAvKindForMemory(m);
    if (!kind) continue;
    const key = bookQrAvKey(kind, m.id);
    keys.push(key);

    const slot = await requestGuestAvUploadSlot({
      pdfTicket: pdfTicketUsed,
      kind,
      memoryId: m.id,
    });
    if (slot.pdfTicketUsed !== pdfTicketUsed) {
      pdfTicketUsed = slot.pdfTicketUsed;
      await refreshAllPendingGuestRawUploadTickets(pdfTicketUsed);
    }

    if (slot.status === 200 && isGuestAvUploadAlreadyReady(slot.row)) {
      await markGuestRawUploadDone(key);
      items.push({ key, outcome: 'already_ready' });
      continue;
    }

    const local = localUriForAv(m);
    if (!local) {
      await markGuestRawUploadDone(key);
      items.push({ key, outcome: 'skipped_no_local' });
      continue;
    }

    await enqueueGuestRawUpload({
      pdfTicket: pdfTicketUsed,
      kind,
      memoryId: m.id,
      localUri: local,
      mimeType: mimeForKind(kind, local),
      policy,
    });
    items.push({ key, outcome: 'enqueued' });
  }

  return {
    pdfTicketUsed,
    items,
    keys,
    alreadyReadyCount: items.filter(i => i.outcome === 'already_ready').length,
    enqueuedCount: items.filter(i => i.outcome === 'enqueued').length,
    skippedNoLocalCount: items.filter(i => i.outcome === 'skipped_no_local').length,
    errorCount: items.filter(i => i.outcome === 'error').length,
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { postInitExport } from '@/services/initExportApi';

/**
 * JWT `exportTicket` / `pdfTicket` pour upload QR A/V (`guest-upload-urls`).
 * Ne pas passer uniquement en query expo-router : JWT long, risque de troncature.
 */
const KEY = 'petitmo_pending_export_upload_ticket_v2';
const LEGACY_KEY = 'petitmo_pending_export_upload_ticket_v1';

export type PendingExportUploadTicketRecord = {
  ticket: string;
  exportRequestId: string;
  email: string;
};

function looksLikeJwt(t: string): boolean {
  const parts = t.split('.');
  return parts.length === 3 && parts.every(p => p.length > 0);
}

/** Décode le payload JWT sans vérifier la signature (exp / export_request_id). */
export function peekExportTicketClaims(ticket: string): {
  export_request_id?: string;
  petitmo_ticket?: string;
  exp?: number;
} | null {
  const t = ticket.trim();
  if (!looksLikeJwt(t)) return null;
  try {
    const payloadB64 = t.split('.')[1]!;
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded + pad)
        : '';
    if (!json) return null;
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      export_request_id: typeof o.export_request_id === 'string' ? o.export_request_id : undefined,
      petitmo_ticket: typeof o.petitmo_ticket === 'string' ? o.petitmo_ticket : undefined,
      exp: typeof o.exp === 'number' ? o.exp : undefined,
    };
  } catch {
    return null;
  }
}

export function isExportTicketExpired(ticket: string, skewSec = 60): boolean {
  const claims = peekExportTicketClaims(ticket);
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSec * 1000;
}

export async function setPendingExportUploadTicket(
  ticket: string,
  meta?: { exportRequestId?: string; email?: string },
): Promise<void> {
  const t = ticket.trim();
  if (!t || !looksLikeJwt(t)) {
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY]);
    return;
  }
  const claims = peekExportTicketClaims(t);
  const rec: PendingExportUploadTicketRecord = {
    ticket: t,
    exportRequestId: (meta?.exportRequestId ?? claims?.export_request_id ?? '').trim(),
    email: (meta?.email ?? '').trim().toLowerCase(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(rec));
  await AsyncStorage.removeItem(LEGACY_KEY);
}

export async function getPendingExportUploadTicketRecord(): Promise<PendingExportUploadTicketRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw?.trim()) {
      const parsed = JSON.parse(raw) as PendingExportUploadTicketRecord;
      if (parsed && typeof parsed.ticket === 'string' && looksLikeJwt(parsed.ticket)) {
        return {
          ticket: parsed.ticket.trim(),
          exportRequestId: (parsed.exportRequestId ?? '').trim(),
          email: (parsed.email ?? '').trim().toLowerCase(),
        };
      }
    }
    // Migration legacy (string JWT seul).
    const legacy = (await AsyncStorage.getItem(LEGACY_KEY))?.trim() ?? '';
    if (legacy && looksLikeJwt(legacy)) {
      const claims = peekExportTicketClaims(legacy);
      return {
        ticket: legacy,
        exportRequestId: (claims?.export_request_id ?? '').trim(),
        email: '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getPendingExportUploadTicket(): Promise<string | null> {
  const rec = await getPendingExportUploadTicketRecord();
  return rec?.ticket ?? null;
}

export async function clearPendingExportUploadTicket(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY]);
  } catch {
    /* ignore */
  }
}

/**
 * Si le JWT est expiré / invalide : renouvelle via `init-export` `refresh_upload_ticket`
 * (même commande / export_request — QR stable).
 */
export async function ensureFreshExportUploadTicket(params?: {
  email?: string;
  exportRequestId?: string;
}): Promise<string | null> {
  const rec = await getPendingExportUploadTicketRecord();
  let ticket = rec?.ticket ?? '';
  let exportRequestId = (params?.exportRequestId || rec?.exportRequestId || '').trim();
  const email = (params?.email || rec?.email || '').trim().toLowerCase();

  if (ticket && !isExportTicketExpired(ticket) && looksLikeJwt(ticket)) {
    return ticket;
  }

  if (!exportRequestId && ticket) {
    exportRequestId = peekExportTicketClaims(ticket)?.export_request_id?.trim() ?? '';
  }
  if (!exportRequestId || !email) {
    return ticket && looksLikeJwt(ticket) ? ticket : null;
  }

  const { status, json } = await postInitExport({
    type: 'refresh_upload_ticket',
    export_request_id: exportRequestId,
    email,
  });
  if (status !== 200) {
    if (__DEV__) {
      console.warn('[ensureFreshExportUploadTicket]', status, json);
    }
    return null;
  }
  const fresh =
    (typeof json.exportTicket === 'string' && json.exportTicket) ||
    (typeof json.pdfTicket === 'string' && json.pdfTicket) ||
    '';
  if (!fresh.trim() || !looksLikeJwt(fresh)) return null;
  await setPendingExportUploadTicket(fresh, { exportRequestId, email });
  return fresh.trim();
}

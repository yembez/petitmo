import AsyncStorage from '@react-native-async-storage/async-storage';
import { getInfoAsync } from 'expo-file-system/legacy';
import { uploadAsync as uploadAsyncLegacy } from 'expo-file-system/legacy';
import {
  isIosBackgroundSignedPutUploadAvailable,
  uploadFileToSignedPutUrlIosBackground,
} from '@/services/signedUrlIosBackgroundUpload';
import { postGuestUploadUrls } from '@/services/initExportApi';
import {
  ensureFreshExportUploadTicket,
  getPendingExportUploadTicketRecord,
} from '@/lib/pendingExportUploadTicket';

type GuestRawKind = 'audio' | 'video';

type PendingGuestRawUpload = {
  /** Clé stable : `${kind}:${memoryId}` */
  key: string;
  kind: GuestRawKind;
  memoryId: string;
  localUri: string;
  mimeType: string;
  /**
   * Token bearer côté PDF server (guest). Sert à autoriser `guest-upload-urls` pour regénérer une signed URL.
   * Peut expirer : on retente best-effort, sinon l’item reste pending.
   */
  pdfTicket: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /**
   * `finalize_only` = ne pas envoyer en fond ; uniquement lors d’une étape utilisateur (“Dernière étape”).
   * `auto` = peut être traité silencieusement.
   */
  policy?: 'auto' | 'finalize_only';
};

const STORAGE_KEY = 'petitmo_pending_guest_raw_uploads_v1';
const SOFT_CTA_AFTER_FAILS = 2;
const SOFT_CTA_AFTER_MS = 10 * 60_000;
/** En finalize forcée : abandonner un item après N échecs dans la fenêtre. */
const FORCE_MAX_ATTEMPTS = 6;

let processing = false;
let processingWaiters: Array<() => void> = [];

function now(): number {
  return Date.now();
}

function backoffMs(attempts: number): number {
  // 0 → 0s, 1 → 10s, 2 → 30s, 3 → 60s, puis 5 min max.
  if (attempts <= 0) return 0;
  if (attempts === 1) return 10_000;
  if (attempts === 2) return 30_000;
  if (attempts === 3) return 60_000;
  return 5 * 60_000;
}

async function readAll(): Promise<PendingGuestRawUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PendingGuestRawUpload[];
  } catch {
    return [];
  }
}

export async function getPendingGuestRawUploadsCount(): Promise<number> {
  const list = await readAll();
  return list.length;
}

export async function getPendingGuestRawUploadsCountForKeys(keys: string[]): Promise<number> {
  if (!keys || keys.length === 0) return 0;
  const set = new Set(keys);
  const list = await readAll();
  return list.filter(x => set.has(x.key)).length;
}

/** Dernière erreur connue (debug / UI finalize). */
export async function getPendingGuestRawUploadLastErrors(
  keys?: string[],
): Promise<Array<{ key: string; lastError: string; attempts: number }>> {
  const list = await readAll();
  const set = keys && keys.length > 0 ? new Set(keys) : null;
  return list
    .filter(x => (set ? set.has(x.key) : true) && (x.lastError ?? '').trim())
    .map(x => ({
      key: x.key,
      lastError: (x.lastError ?? '').trim(),
      attempts: x.attempts ?? 0,
    }));
}

async function writeAll(list: PendingGuestRawUpload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function needsUserAttention(item: PendingGuestRawUpload): boolean {
  if ((item.attempts ?? 0) >= SOFT_CTA_AFTER_FAILS) return true;
  if (now() - (item.createdAt ?? 0) >= SOFT_CTA_AFTER_MS) return true;
  return false;
}

export async function getGuestRawUploadsAttentionRequired(): Promise<boolean> {
  const list = await readAll();
  return list.some(needsUserAttention);
}

async function localUriExists(uri: string): Promise<boolean> {
  const t = uri.trim();
  if (!t) return false;
  try {
    const info = await getInfoAsync(t);
    return !!info.exists;
  } catch {
    return false;
  }
}

async function putUploadToSignedUrl(params: {
  signedUrl: string;
  localUri: string;
  mimeType: string;
}): Promise<void> {
  if (isIosBackgroundSignedPutUploadAvailable()) {
    await uploadFileToSignedPutUrlIosBackground(params);
    return;
  }
  const res = await uploadAsyncLegacy(params.signedUrl, params.localUri, {
    httpMethod: 'PUT',
    uploadType: 0 as unknown as number, // BINARY_CONTENT (legacy enum value)
    headers: { 'Content-Type': params.mimeType },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`SIGNED_UPLOAD_FAILED (${res.status}) ${res.body || ''}`.trim());
  }
}

function releaseProcessingLock(): void {
  processing = false;
  const waiters = processingWaiters;
  processingWaiters = [];
  for (const w of waiters) w();
}

async function waitForProcessingSlot(maxWaitMs: number): Promise<boolean> {
  if (!processing) return true;
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      processingWaiters = processingWaiters.filter(w => w !== onFree);
      resolve(false);
    }, maxWaitMs);
    const onFree = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    processingWaiters.push(onFree);
  });
}

export async function enqueueGuestRawUpload(params: {
  pdfTicket: string;
  kind: GuestRawKind;
  memoryId: string;
  localUri: string;
  mimeType: string;
  policy?: 'auto' | 'finalize_only';
}): Promise<void> {
  const key = `${params.kind}:${params.memoryId}`;
  const list = await readAll();
  const existingIdx = list.findIndex(x => x.key === key);
  const policy =
    params.policy ?? (existingIdx >= 0 ? list[existingIdx]!.policy : undefined) ?? 'auto';
  const item: PendingGuestRawUpload = {
    key,
    kind: params.kind,
    memoryId: params.memoryId,
    localUri: params.localUri,
    mimeType: params.mimeType,
    pdfTicket: params.pdfTicket,
    createdAt: now(),
    attempts: existingIdx >= 0 ? list[existingIdx]!.attempts : 0,
    nextAttemptAt: now(),
    lastError: existingIdx >= 0 ? list[existingIdx]!.lastError : undefined,
    policy,
  };
  const next = existingIdx >= 0 ? list.map(x => (x.key === key ? item : x)) : [...list, item];
  await writeAll(next);
  // Ne pas lancer le worker fond pour finalize_only (évite course avec l’écran « Dernière étape »).
  if (policy !== 'finalize_only') {
    void processPendingGuestRawUploads();
  }
}

export async function markGuestRawUploadDone(key: string): Promise<void> {
  const list = await readAll();
  const next = list.filter(x => x.key !== key);
  if (next.length !== list.length) {
    await writeAll(next);
  }
}

/** Remplace le JWT sur toute la file (ticket frais après commande / AsyncStorage). */
export async function refreshAllPendingGuestRawUploadTickets(pdfTicket: string): Promise<void> {
  const t = pdfTicket.trim();
  if (!t) return;
  const list = await readAll();
  if (list.length === 0) return;
  await writeAll(
    list.map(x => ({
      ...x,
      pdfTicket: t,
      nextAttemptAt: now(),
      attempts: 0,
      lastError: undefined,
    })),
  );
}

/**
 * À appeler au démarrage / retour au premier plan / écran finalize (`force: true`).
 * - Regénère une signed URL via `guest-upload-urls` (car les signed URLs expirent)
 * - Puis upload PUT vers Supabase Storage
 */
export async function processPendingGuestRawUploads(opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force === true;
  if (processing) {
    if (!force) return;
    const gotSlot = await waitForProcessingSlot(120_000);
    if (!gotSlot || processing) {
      if (__DEV__) {
        console.warn('[pendingRawGuestUploads] force: worker déjà occupé (timeout attente)');
      }
      return;
    }
  }
  processing = true;
  try {
    const list = await readAll();
    if (list.length === 0) return;

    // Traitement séquentiel (évite plusieurs gros uploads en parallèle).
    for (const item of list) {
      if (!force && item.policy === 'finalize_only') {
        continue;
      }
      if (!force && needsUserAttention(item)) {
        // UX: après seuil (2 échecs ou 10 min), on évite de boucler en silence.
        continue;
      }
      // En finalize forcée : ignorer le backoff (sinon l’UI tourne dans le vide des minutes).
      if (!force && item.nextAttemptAt > now()) continue;
      if (force && (item.attempts ?? 0) >= FORCE_MAX_ATTEMPTS) {
        if (__DEV__) {
          console.warn(
            '[pendingRawGuestUploads] force: abandon item',
            item.key,
            item.lastError,
          );
        }
        continue;
      }

      try {
        const exists = await localUriExists(item.localUri);
        if (!exists) {
          throw new Error(`LOCAL_FILE_MISSING ${item.localUri.slice(0, 120)}`);
        }

        if (__DEV__) {
          console.log('[pendingRawGuestUploads] upload start', item.key, {
            force,
            attempts: item.attempts,
          });
        }

        const { status, json } = await postGuestUploadUrls({
          pdfTicket: item.pdfTicket,
          assets: [{ kind: item.kind, memoryId: item.memoryId }],
        });
        let row = (json as {
          uploads?: Array<{ signedUrl?: string; alreadyReady?: boolean; token?: string }>;
        })?.uploads?.[0];
        let statusEff = status;
        let jsonEff = json;

        // Ticket expiré / invalide → renouveler (même export_request, QR inchangé) puis retenter 1×.
        if (statusEff === 401) {
          const rec = await getPendingExportUploadTicketRecord();
          const fresh = await ensureFreshExportUploadTicket({
            email: rec?.email,
            exportRequestId: rec?.exportRequestId,
          });
          if (fresh && fresh !== item.pdfTicket) {
            await refreshAllPendingGuestRawUploadTickets(fresh);
            const retry = await postGuestUploadUrls({
              pdfTicket: fresh,
              assets: [{ kind: item.kind, memoryId: item.memoryId }],
            });
            statusEff = retry.status;
            jsonEff = retry.json;
            row = (jsonEff as {
              uploads?: Array<{ signedUrl?: string; alreadyReady?: boolean; token?: string }>;
            })?.uploads?.[0];
          }
        }

        // Token QR déjà ready (souvenir cloud depuis longtemps) : pas de PUT à faire.
        if (statusEff === 200 && (row?.alreadyReady === true || (!row?.signedUrl && !!row?.token))) {
          await markGuestRawUploadDone(item.key);
          if (__DEV__) {
            console.log('[pendingRawGuestUploads] already ready, skip upload', item.key);
          }
          continue;
        }

        if (statusEff !== 200 || !row?.signedUrl) {
          const errMsg =
            typeof (jsonEff as { error?: unknown })?.error === 'string'
              ? (jsonEff as { error: string }).error
              : typeof (jsonEff as { message?: unknown })?.message === 'string'
                ? (jsonEff as { message: string }).message
                : '';
          throw new Error(
            `SIGNED_URL_REFRESH_FAILED (${statusEff})${errMsg ? ` ${errMsg}` : ''}`.trim(),
          );
        }

        await putUploadToSignedUrl({
          signedUrl: row.signedUrl,
          localUri: item.localUri,
          mimeType: item.mimeType,
        });
        await markGuestRawUploadDone(item.key);
        if (__DEV__) {
          console.log('[pendingRawGuestUploads] upload ok', item.key);
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        if (__DEV__) {
          console.warn('[pendingRawGuestUploads] upload fail', item.key, err);
        }
        // Fichier introuvable : retirer de la file (retry inutile).
        if (err.startsWith('LOCAL_FILE_MISSING')) {
          await markGuestRawUploadDone(item.key);
          continue;
        }
        const latest = await readAll();
        const idx = latest.findIndex(x => x.key === item.key);
        if (idx < 0) continue;
        const cur = latest[idx]!;
        const attempts = (cur.attempts ?? 0) + 1;
        latest[idx] = {
          ...cur,
          attempts,
          lastError: err,
          nextAttemptAt: now() + (force ? 2_000 : backoffMs(attempts)),
        };
        await writeAll(latest);
      }
    }
  } finally {
    releaseProcessingLock();
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAsync as uploadAsyncLegacy } from 'expo-file-system/legacy';
import { isIosBackgroundSignedPutUploadAvailable, uploadFileToSignedPutUrlIosBackground } from '@/services/signedUrlIosBackgroundUpload';
import { postGuestUploadUrls } from '@/services/initExportApi';

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

let processing = false;

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

async function putUploadToSignedUrl(params: { signedUrl: string; localUri: string; mimeType: string }): Promise<void> {
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
    policy: params.policy ?? (existingIdx >= 0 ? list[existingIdx]!.policy : undefined) ?? 'auto',
  };
  const next = existingIdx >= 0 ? list.map(x => (x.key === key ? item : x)) : [...list, item];
  await writeAll(next);
  // Best-effort : lance un traitement immédiat (sans await).
  void processPendingGuestRawUploads();
}

export async function markGuestRawUploadDone(key: string): Promise<void> {
  const list = await readAll();
  const next = list.filter(x => x.key !== key);
  if (next.length !== list.length) {
    await writeAll(next);
  }
}

/**
 * À appeler au démarrage / retour au premier plan.
 * - Regénère une signed URL via `guest-upload-urls` (car les signed URLs expirent)
 * - Puis upload PUT vers Supabase Storage
 */
export async function processPendingGuestRawUploads(opts?: { force?: boolean }): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const list = await readAll();
    if (list.length === 0) return;

    // Traitement séquentiel (évite plusieurs gros uploads en parallèle).
    for (const item of list) {
      if (!opts?.force && item.policy === 'finalize_only') {
        continue;
      }
      if (!opts?.force && needsUserAttention(item)) {
        // UX: après seuil (2 échecs ou 10 min), on évite de boucler en silence.
        continue;
      }
      if (item.nextAttemptAt > now()) continue;

      try {
        const { status, json } = await postGuestUploadUrls({
          pdfTicket: item.pdfTicket,
          assets: [{ kind: item.kind, memoryId: item.memoryId }],
        });
        const row = (json as { uploads?: Array<{ signedUrl?: string }> })?.uploads?.[0];
        if (status !== 200 || !row?.signedUrl) {
          throw new Error(`SIGNED_URL_REFRESH_FAILED (${status})`);
        }

        await putUploadToSignedUrl({ signedUrl: row.signedUrl, localUri: item.localUri, mimeType: item.mimeType });
        await markGuestRawUploadDone(item.key);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const latest = await readAll();
        const idx = latest.findIndex(x => x.key === item.key);
        if (idx < 0) continue;
        const cur = latest[idx]!;
        const attempts = (cur.attempts ?? 0) + 1;
        latest[idx] = {
          ...cur,
          attempts,
          lastError: err,
          nextAttemptAt: now() + backoffMs(attempts),
        };
        await writeAll(latest);
      }
    }
  } finally {
    processing = false;
  }
}


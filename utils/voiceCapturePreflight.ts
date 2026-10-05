import { Directory, File, Paths } from 'expo-file-system';
import { getOrSelectFirstChild } from '@/services/children';
import { getLocalChild } from '@/lib/localDb';
import {
  checkMemoryLimit,
  FREE_TIER_VOICE_MAX_DURATION,
  PAID_TIER_VOICE_MAX_DURATION,
} from '@/lib/limits';
import { getUserTier } from '@/lib/userTier';
import { getCachedUserMode } from '@/lib/userMode';
import { supabase } from '@/lib/supabase';
import { isDeviceStorageFullError } from '@/utils/deviceStorageFull';

/**
 * expo-av HIGH_QUALITY ≈ AAC 128 kbps.
 * Avant le micro : 3 exemplaires (cache + prise durable + sandbox) + marge.
 * Une voix déjà en main : une copie sandbox + marge.
 */
const AAC_BYTES_PER_SEC = 16_000;
const MARGIN_BYTES = 2 * 1024 * 1024;

export function voiceCaptureReserveBytes(maxDurationSec: number): number {
  const sec = Math.max(1, maxDurationSec);
  return Math.ceil(sec * AAC_BYTES_PER_SEC * 3 + MARGIN_BYTES);
}

export function voiceKeepReserveBytes(fileBytes: number): number {
  return Math.ceil(Math.max(0, fileBytes) + MARGIN_BYTES);
}

export function estimatedVoiceFileBytes(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) * AAC_BYTES_PER_SEC);
}

export function releaseVoiceCaptureSlot(uri: string | null | undefined): void {
  const path = uri?.trim();
  if (!path) return;
  try {
    const file = new File(path);
    if (file.exists) file.delete();
  } catch {
    /* ignore */
  }
}

/**
 * Crée le dossier d’accueil et écrit un fichier de la taille max de la prise.
 * Si ça échoue, le micro ne doit pas s’ouvrir : on ne peut pas garder la voix.
 */
export function allocateVoiceCaptureSlot(bytes: number): string {
  const folder = new Directory(Paths.document, 'petitmo_pending_voice');
  if (!folder.exists) {
    folder.create();
  }
  const file = new File(folder, `slot_${Date.now()}.m4a`);
  file.create();
  file.write(new Uint8Array(Math.max(1, bytes)));
  if (!file.exists) {
    throw new Error('voice_slot_missing');
  }
  return file.uri;
}

export function readFreeDiskBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    if (typeof free === 'number' && Number.isFinite(free) && free >= 0) return free;
  } catch {
    /* API absente */
  }
  return null;
}

export type VoiceCapturePreflightFailReason =
  | 'no_child'
  | 'limit'
  | 'capture_locked'
  | 'storage'
  | 'write'
  | 'auth'
  | 'unknown';

export type VoiceCapturePreflightResult =
  | { ok: true; childId: string; reserveUri?: string }
  | { ok: false; reason: VoiceCapturePreflightFailReason; detail?: string };

/**
 * Tout ce qui empêcherait d’écrire le souvenir, vérifié avant d’armer le micro
 * (et rejoué avant d’afficher une voix comme « à sauvegarder »).
 * Local-first : quota SQLite, pas de pull réseau.
 *
 * `reserveBytes` : octets libres exigés. Défaut = pire cas du palier
 * (1 min gratuit / 5 min Petit Cœur, trois copies).
 */
export async function preflightVoiceCapture(opts?: {
  reserveBytes?: number;
  /** Avant le micro : écrit réellement le fichier d’accueil (taille max de la prise). */
  allocateSlot?: boolean;
}): Promise<VoiceCapturePreflightResult> {
  try {
    const childId = await getOrSelectFirstChild();
    if (!childId) return { ok: false, reason: 'no_child' };

    const memLimit = await checkMemoryLimit(childId, { skipRemotePull: true });
    if (!memLimit.canCreate) {
      return {
        ok: false,
        reason: memLimit.reason === 'capture_locked' ? 'capture_locked' : 'limit',
        detail: memLimit.reason ?? undefined,
      };
    }

    let reserve = opts?.reserveBytes;
    if (reserve == null) {
      const tier = await getUserTier().catch(() => 'free' as const);
      reserve = voiceCaptureReserveBytes(
        tier === 'paid' ? PAID_TIER_VOICE_MAX_DURATION : FREE_TIER_VOICE_MAX_DURATION,
      );
    }
    const free = readFreeDiskBytes();
    if (free != null && free < reserve) {
      return { ok: false, reason: 'storage', detail: `free=${free} reserve=${reserve}` };
    }

    let reserveUri: string | undefined;
    try {
      if (!Paths.document) return { ok: false, reason: 'write', detail: 'no_document_dir' };
      if (opts?.allocateSlot) {
        const tier = await getUserTier().catch(() => 'free' as const);
        const slotBytes = estimatedVoiceFileBytes(
          tier === 'paid' ? PAID_TIER_VOICE_MAX_DURATION : FREE_TIER_VOICE_MAX_DURATION,
        );
        reserveUri = allocateVoiceCaptureSlot(slotBytes);
      } else {
        const probe = new File(Paths.document, `petitmo_voice_preflight_${Date.now()}.tmp`);
        probe.write('ok');
        try {
          probe.delete();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      if (isDeviceStorageFullError(e)) {
        return { ok: false, reason: 'storage' };
      }
      const detail = e instanceof Error ? e.message : String(e ?? 'write');
      return { ok: false, reason: 'write', detail: detail.slice(0, 120) };
    }

    const mode = await getCachedUserMode();
    if (mode !== 'local') {
      const fromChild = getLocalChild(childId)?.user_id?.trim();
      if (!fromChild) {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.user?.id) {
          releaseVoiceCaptureSlot(reserveUri);
          return { ok: false, reason: 'auth' };
        }
      }
    }

    return { ok: true, childId, reserveUri };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e ?? 'unknown');
    return { ok: false, reason: 'unknown', detail: detail.slice(0, 120) };
  }
}

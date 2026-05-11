import { formatCaptureStickerLabel } from '@/utils/date';

/** Champs minimaux pour la pastille « date de prise » (alignée sur `FilMemoryRow`). */
export type CaptureOverlayMemoryFields = {
  created_at: string;
  inserted_at?: string | null;
  location?: string | null;
};

/** `formatDateLong` ignore l’heure : même jour prise/import masquait l’overlay ; import optimiste avait created = inserted. */
export function shouldShowCapturedMediaDateOverlay(m: CaptureOverlayMemoryFields): boolean {
  const capturedIso = m.created_at;
  const addedAtIso = m.inserted_at || m.created_at;
  if (!capturedIso?.trim() || !addedAtIso?.trim()) return false;
  const tA = new Date(addedAtIso).getTime();
  const tC = new Date(capturedIso).getTime();
  if (Number.isNaN(tA) || Number.isNaN(tC)) return false;
  if (Math.abs(tA - tC) < 90_000) return false;
  return true;
}

export function capturedMediaDateLabel(m: CaptureOverlayMemoryFields): string {
  return formatCaptureStickerLabel(m.created_at, m.location);
}

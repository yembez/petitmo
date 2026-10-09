import type { GenerateBookPdfPayload, GuestMemoryForPdfPayload } from '../types/contracts';

function isGuestMemoryList(x: unknown): x is GuestMemoryForPdfPayload[] {
  if (!Array.isArray(x)) return false;
  for (const i of x) {
    if (!i || typeof i !== 'object') return false;
    const o = i as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id.trim()) return false;
    if (o.type !== 'voice' && o.type !== 'video' && o.type !== 'photo' && o.type !== 'text') return false;
  }
  return true;
}

function isGuestChild(
  x: unknown
): x is { name: string; photo_url?: string | null; birthdate?: string | null } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.name === 'string' && o.name.trim().length > 0;
}

export function isGenerateBookPdfPayload(body: unknown): body is GenerateBookPdfPayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const guestMemOk = b.guestMemories === undefined || isGuestMemoryList(b.guestMemories);
  const guestChildOk = b.guestChild === undefined || isGuestChild(b.guestChild);
  return (
    typeof b.bookId === 'string' &&
    typeof b.childId === 'string' &&
    typeof b.coverTitle === 'string' &&
    typeof b.coverYearLabel === 'string' &&
    typeof b.chapterTitle === 'string' &&
    typeof b.qrBaseUrl === 'string' &&
    (b.exportMode === 'digital' || b.exportMode === 'print') &&
    (b.subscriptionTier === 'free' || b.subscriptionTier === 'premium') &&
    Array.isArray(b.pages) &&
    guestMemOk &&
    guestChildOk
  );
}

export function assertPrintGuestPayload(body: GenerateBookPdfPayload): string | null {
  if (!body.guestChild || !isGuestChild(body.guestChild)) {
    return 'guestChild required';
  }
  if (!body.guestMemories || !isGuestMemoryList(body.guestMemories)) {
    return 'guestMemories required';
  }
  if (body.exportMode !== 'print') {
    return 'exportMode must be print';
  }
  return null;
}

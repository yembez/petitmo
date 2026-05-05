import type { Memory } from '@/types/local';

export type MemoryViewerSessionPayload = {
  memories: Memory[];
  initialIndex: number;
};

let session: MemoryViewerSessionPayload | null = null;

/** À appeler juste avant `router.push('/memory-viewer')`. */
export function setMemoryViewerSession(payload: MemoryViewerSessionPayload): void {
  session = payload;
}

/** Lecture jusqu’à `clearMemoryViewerSession` (évite perte en double montage Strict Mode). */
export function peekMemoryViewerSession(): MemoryViewerSessionPayload | null {
  return session;
}

/** À l’appui sur Retour / fermeture de l’écran viewer. */
export function clearMemoryViewerSession(): void {
  session = null;
}

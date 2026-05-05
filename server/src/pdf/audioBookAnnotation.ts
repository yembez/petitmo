/**
 * Aligné sur `lib/audioBookAnnotation.ts` (app) — package serveur isolé, pas d’import hors `server/`.
 */
export const MAX_AUDIO_BOOK_ANNOTATION_CHARS = 88;

export function clampAudioBookAnnotation(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_AUDIO_BOOK_ANNOTATION_CHARS) return t;
  return `${t.slice(0, MAX_AUDIO_BOOK_ANNOTATION_CHARS - 1).trimEnd()}…`;
}

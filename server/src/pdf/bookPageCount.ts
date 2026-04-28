import type { BookPageServer } from '../types/contracts';
import type { MemoryRow } from './memoryRow';

/**
 * Nombre de blocs `.page` générés (même logique que `renderPage` dans `htmlBook.ts`).
 * Les pages référençant un souvenir absent du map ne produisent pas de page HTML.
 */
export function countRenderedBookPages(pages: BookPageServer[], memoriesById: Map<string, MemoryRow>): number {
  let count = 0;
  for (const page of pages) {
    switch (page.type) {
      case 'cover':
      case 'chapter':
      case 'back-cover':
        count += 1;
        break;
      case 'photo-full':
      case 'photo-note':
      case 'quote':
      case 'audio':
      case 'video': {
        const id = page.memoryId;
        if (typeof id !== 'string' || !id.trim() || !memoriesById.has(id)) {
          break;
        }
        count += 1;
        break;
      }
    }
  }
  return count;
}

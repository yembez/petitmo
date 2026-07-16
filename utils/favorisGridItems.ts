/**
 * Grille onglet Favoris — source partagée avec le picker couverture livre.
 */

import type { Memory } from '@/types/local';
import { memoryShouldAppearInFavoris } from '@/services/favorisMemories';
import {
  bookHasPageEntry,
  type Book,
  type BookPageEntry,
} from '@/services/books';
import {
  getAllPhotoUrlsForFeed,
  getVideoPosterUriForFeedAndViewer,
  getVoiceCoverUriForFeedAndViewer,
  mapPhotoUrlToThumb,
  normalizePhotoUrlForCompare,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';

export type FavorisGridItem = {
  key: string;
  memory: Memory;
  thumbUrl: string;
  kind: 'whole' | 'photo';
  /** Pour `kind === 'photo'` : URL originale dans `favorite_photo_urls`. */
  favPhotoOriginalUrl?: string;
};

function thumbUri(m: Memory): string | null {
  if (m.type === 'voice') {
    const u = getVoiceCoverUriForFeedAndViewer(m);
    return u.trim() || null;
  }
  if (m.type === 'video') {
    const u = getVideoPosterUriForFeedAndViewer(m);
    return u.trim() || null;
  }
  return null;
}

function primaryDisplayThumb(m: Memory): string {
  if (m.type === 'photo') {
    return getAllPhotoUrlsForFeed(m)[0]?.trim() || '';
  }
  if (m.type === 'video') {
    const v = getVideoPosterUriForFeedAndViewer(m);
    if (v) return v;
  }
  if (m.type === 'voice') {
    const c = getVoiceCoverUriForFeedAndViewer(m);
    if (c) return c;
  }
  return thumbUri(m) ?? '';
}

/** Même logique que `buildFavoriteItems` dans l’onglet Favoris. */
export function buildFavorisGridItems(memories: readonly Memory[]): FavorisGridItem[] {
  const items: FavorisGridItem[] = [];
  for (const m of memories) {
    const primary = primaryDisplayThumb(m);
    const listed = memoryShouldAppearInFavoris(m);

    if (listed && m.type !== 'photo') {
      items.push({
        key: `${m.id}-whole`,
        memory: m,
        thumbUrl: primary,
        kind: 'whole',
      });
    } else if (m.is_favorite && m.type === 'photo') {
      items.push({
        key: `${m.id}-whole`,
        memory: m,
        thumbUrl: primary,
        kind: 'whole',
      });
    }

    if (m.type === 'photo') {
      const favUrls = parseFavoritePhotoUrls(m);
      const primaryNorm = normalizePhotoUrlForCompare(primary);
      for (const url of favUrls) {
        if (m.is_favorite && normalizePhotoUrlForCompare(url) === primaryNorm) continue;
        items.push({
          key: `${m.id}-photo-${normalizePhotoUrlForCompare(url)}`,
          memory: m,
          thumbUrl: mapPhotoUrlToThumb(m, url),
          kind: 'photo',
          favPhotoOriginalUrl: url,
        });
      }
    }
  }
  return items.sort(
    (a, b) => new Date(b.memory.created_at).getTime() - new Date(a.memory.created_at).getTime(),
  );
}

/** Ref photo à enregistrer sur le livre pour un item Favoris sélectionné. */
export function photoRefForFavorisGridItem(item: FavorisGridItem): string | undefined {
  if (item.kind === 'photo' && item.favPhotoOriginalUrl?.trim()) {
    return item.favPhotoOriginalUrl.trim();
  }
  if (item.kind === 'whole' && item.memory.type === 'photo') {
    return getAllPhotoUrlsForFeed(item.memory)[0]?.trim() || undefined;
  }
  return undefined;
}

/** Construit `memoryPhotoRefs` depuis une sélection Favoris (clés item). */
export function buildMemoryPhotoRefsFromItems(
  items: readonly FavorisGridItem[],
  selectedKeys: ReadonlySet<string>,
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const item of items) {
    if (!selectedKeys.has(item.key)) continue;
    const ref = photoRefForFavorisGridItem(item);
    if (ref) refs[item.memory.id] = ref;
  }
  return refs;
}

/** Entrée page livre correspondant à une tuile Favoris. */
export function pageEntryForFavorisGridItem(item: FavorisGridItem): BookPageEntry {
  const mid = item.memory.id.trim();
  const photoRef = photoRefForFavorisGridItem(item);
  return photoRef ? { memoryId: mid, photoRef } : { memoryId: mid };
}

/**
 * Encoche verte : cette tuile (souvenir + slot photo) a déjà une page dans le livre.
 * Une autre photo du même album n’est pas cochée → sélectionnable pour APPEND une page.
 */
export function isFavorisItemInBook(
  item: FavorisGridItem,
  book: Book | null | undefined,
): boolean {
  if (!book) return false;
  return bookHasPageEntry(book, pageEntryForFavorisGridItem(item));
}

/** True si l’ajout de cette tuile créerait une nouvelle page. */
export function favorisItemWouldChangeBook(
  item: FavorisGridItem,
  book: Book | null | undefined,
): boolean {
  return !isFavorisItemInBook(item, book);
}

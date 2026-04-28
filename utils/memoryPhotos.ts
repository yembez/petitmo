import type { Memory } from '@/types/local';
import { peekFeedBootstrapDisplayUrls } from '@/services/feedLocalPhotoCache';

function firstNonEmpty(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t) return t;
  }
  return '';
}

/**
 * URI principale pour l’aperçu maquette / livre : **fichiers locaux d’abord** (sandbox / dérivés),
 * puis URLs dérivées (`display_url`, `thumb_url`), puis originaux distants.
 * Aligné sur l’esprit `collectImageUrls` dans `bookPdf.ts`, pour ne pas dépendre de `media_url` (souvent null en gratuit).
 */
export function getPrimaryPhotoUriForBookPreview(memory: Memory): string {
  const boot = peekFeedBootstrapDisplayUrls(memory.id)?.[0]?.trim();
  if (boot) return boot;

  return firstNonEmpty(
    memory.local_display_path,
    memory.local_thumb_path,
    memory.local_print_path,
    memory.local_original_path,
    memory.local_media_path,
    memory.display_url,
    memory.thumb_url,
    memory.print_url,
    memory.edited_media_url,
    memory.media_url
  );
}

/** Photo de fond d’un vocal : chemin local (sandbox) si présent, sinon URL publique. */
export function getVoiceCoverUriForBookPreview(memory: Memory): string {
  return firstNonEmpty(memory.voice_cover_path, memory.voice_cover_url);
}

/** Vignette / poster vidéo pour la maquette : dérivé local éventuel, puis URLs. */
export function getVideoPosterUriForBookPreview(memory: Memory): string {
  return firstNonEmpty(
    memory.local_thumb_path,
    memory.poster_url,
    memory.poster_print_url,
    memory.thumbnail_url
  );
}

/** Toutes les URLs d’un souvenir photo (1ère = version éditée si présente, puis `extra_photo_urls`). */
export function getAllPhotoUrls(memory: Memory): string[] {
  const first = (memory.edited_media_url?.trim() || memory.media_url?.trim()) || undefined;
  const raw = memory.extra_photo_urls;
  const extra: unknown[] = Array.isArray(raw) ? raw : [];
  const rest = extra.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  const urls = [first, ...rest].filter((u): u is string => !!u && u.length > 0);
  return urls;
}

/**
 * URLs optimisées pour le feed (réduit l’egress):
 * - jamais `media_url` / `extra_photo_urls` (originaux)
 * - `thumb_url` puis repli `display_url` (toujours des fichiers dérivés générés côté worker)
 * - album: même logique par index (`extra_thumb_urls` puis `extra_display_urls`)
 */
export function getAllPhotoUrlsForFeed(memory: Memory): string[] {
  const first =
    memory.thumb_url?.trim() ||
    memory.display_url?.trim() ||
    undefined;

  const rawThumb = memory.extra_thumb_urls;
  const rawDisplay = memory.extra_display_urls;
  const thumbs: string[] = Array.isArray(rawThumb)
    ? (rawThumb as unknown[])
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map(u => u.trim())
    : [];
  const displays: string[] = Array.isArray(rawDisplay)
    ? (rawDisplay as unknown[])
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map(u => u.trim())
    : [];

  const max = Math.max(thumbs.length, displays.length);
  const cleaned: string[] = [];
  for (let i = 0; i < max; i++) {
    const u = thumbs[i]?.trim() || displays[i]?.trim() || '';
    if (u) cleaned.push(u);
  }

  return [first, ...cleaned].filter((u): u is string => !!u && u.length > 0);
}

/** URLs pour écrans détail (accepte display puis fallback original si nécessaire). */
export function getAllPhotoUrlsForDisplay(memory: Memory): string[] {
  const first =
    (memory.display_url?.trim() ||
      memory.edited_media_url?.trim() ||
      memory.media_url?.trim()) ||
    undefined;

  const rawDisplay = memory.extra_display_urls;
  const rawExtra = memory.extra_photo_urls;
  const dispArr: unknown[] = Array.isArray(rawDisplay) ? rawDisplay : [];
  const extraArr: unknown[] = Array.isArray(rawExtra) ? rawExtra : [];
  const rest = dispArr.length > 0 ? dispArr : extraArr;
  const cleaned = rest
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map(u => u.trim());

  return [first, ...cleaned].filter((u): u is string => !!u && u.length > 0);
}

/**
 * Mappe une URL "originale" (media_url / extra_photo_urls) vers sa variante thumb si connue.
 * Utile pour l'UI "favoris par photo" pour éviter de recharger les originaux.
 */
export function mapPhotoUrlToThumb(memory: Memory, originalUrl: string): string {
  const o = originalUrl.trim();
  if (!o) return '';

  const mainOrig = (memory.edited_media_url?.trim() || memory.media_url?.trim() || '');
  if (mainOrig && mainOrig === o && memory.thumb_url?.trim()) return memory.thumb_url.trim();

  const extraOrig: string[] = Array.isArray(memory.extra_photo_urls)
    ? (memory.extra_photo_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
    : [];
  const extraThumb: string[] = Array.isArray(memory.extra_thumb_urls)
    ? (memory.extra_thumb_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map(u => u.trim())
    : [];

  const idx = extraOrig.findIndex(u => u === o);
  if (idx >= 0 && extraThumb[idx]) return extraThumb[idx];

  return o;
}

/** URLs des photos d’album marquées comme favoris (colonne `favorite_photo_urls`). */
export function parseFavoritePhotoUrls(memory: Memory): string[] {
  const raw = memory.favorite_photo_urls;
  const arr: unknown[] = Array.isArray(raw) ? raw : [];
  return arr
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map(u => u.trim());
}

export function normalizePhotoUrlForCompare(url: string): string {
  return url.trim();
}

export function isPhotoUrlFavorited(favoriteUrls: string[], photoUrl: string): boolean {
  const n = normalizePhotoUrlForCompare(photoUrl);
  return favoriteUrls.some(u => normalizePhotoUrlForCompare(u) === n);
}

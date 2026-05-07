import type { Memory } from '@/types/local';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { peekFeedBootstrapDisplayUrls } from '@/services/feedLocalPhotoCache';

function asTrimmedStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map(u => u.trim());
}

function firstNonEmpty(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t) return t;
  }
  return '';
}

/** URI pour composants Image : `file://` pour fichiers disque, laisse tel quel HTTP et chemins bucket signables. */
function normalizeMemoryMediaUriForDisplay(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (
    /^https?:\/\//i.test(t) ||
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://') ||
    t.startsWith('data:')
  ) {
    return t;
  }
  // Chemin objet Storage (`uuid/.../photo/...`) — pas un fichier local ; évite `file://` incorrect après réinstall.
  if (extractMediaBucketPath(t)) return t;
  const path = t.startsWith('/') ? t : `/${t}`;
  return `file://${path}`;
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
 * URLs pour le feed : **local-first** (colonnes SQLite / sandbox), puis dérivés distants
 * (`thumb` / `display`), puis originaux — pour ne pas passer par le réseau si le fichier est déjà sur l’appareil.
 */
export function getAllPhotoUrlsForFeed(memory: Memory): string[] {
  const firstLocal = firstNonEmpty(
    memory.local_display_path,
    memory.local_thumb_path,
    memory.local_print_path,
    memory.local_original_path,
    memory.local_media_path,
  );
  const firstRemote = firstNonEmpty(
    memory.thumb_url,
    memory.display_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  );
  const firstRaw = firstNonEmpty(firstLocal, firstRemote);
  const first = firstRaw ? normalizeMemoryMediaUriForDisplay(firstRaw) : '';

  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);

  const max = Math.max(localExtras.length, thumbs.length, displays.length, originals.length);
  const cleaned: string[] = [];
  for (let i = 0; i < max; i++) {
    const raw = firstNonEmpty(localExtras[i], thumbs[i], displays[i], originals[i]);
    if (raw) cleaned.push(normalizeMemoryMediaUriForDisplay(raw));
  }

  return [first, ...cleaned].filter(u => u.length > 0);
}

/** Album multi-photos dans le fil : garde la visionneuse galerie (pas le viewer vertical immersif). */
export function isFeedMultiPhotoAlbum(memory: Memory): boolean {
  if (memory.type !== 'photo') return false;
  return getAllPhotoUrlsForFeed(memory).length > 1;
}

/**
 * URLs pour écrans détail (mémoire / galerie) : **dérivés avant originaux** pour limiter l’egress,
 * comme le fil mais avec repli `edited` / `media` sur la 1re image si le worker n’a pas encore livré.
 */
export function getAllPhotoUrlsForDisplay(memory: Memory): string[] {
  const first =
    firstNonEmpty(
      memory.display_url,
      memory.thumb_url,
      memory.edited_media_url,
      memory.media_url,
      typeof memory.media_path === 'string' ? memory.media_path : '',
    ) || undefined;

  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const paths = asTrimmedStringArray(memory.extra_photo_paths);
  const max = Math.max(displays.length, thumbs.length, originals.length, paths.length);
  const rest: string[] = [];
  for (let i = 0; i < max; i++) {
    const u = firstNonEmpty(displays[i], thumbs[i], originals[i], paths[i]);
    if (u) rest.push(u);
  }

  return [first, ...rest].filter((u): u is string => !!u && u.length > 0);
}

/** Groupes d’URLs qui désignent la même photo (favoris par image, URLs signées différentes). */
function photoVariantGroups(memory: Memory): string[][] {
  const groups: string[][] = [];
  const g0 = [
    memory.display_url,
    memory.thumb_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  ]
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map(u => u.trim());
  if (g0.length) groups.push(g0);

  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const paths = asTrimmedStringArray(memory.extra_photo_paths);
  const n = Math.max(displays.length, thumbs.length, originals.length, paths.length);
  for (let i = 0; i < n; i++) {
    const g = [displays[i], thumbs[i], originals[i], paths[i]].filter(
      (u): u is string => typeof u === 'string' && u.length > 0
    );
    if (g.length) groups.push(g);
  }
  return groups;
}

function sameStorageObject(a: string, b: string): boolean {
  const pa = extractMediaBucketPath(a);
  const pb = extractMediaBucketPath(b);
  return !!(pa && pb && pa === pb);
}

function urlsInSamePhotoVariantGroup(memory: Memory, a: string, b: string): boolean {
  const A = normalizePhotoUrlForCompare(a);
  const B = normalizePhotoUrlForCompare(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (sameStorageObject(A, B)) return true;
  for (const g of photoVariantGroups(memory)) {
    const set = new Set(g.map(normalizePhotoUrlForCompare));
    if (set.has(A) && set.has(B)) return true;
  }
  return false;
}

/**
 * Favori par photo : la liste peut contenir une variante (originale) et l’UI afficher une autre (thumb/display),
 * ou deux signatures différentes du même objet Storage.
 */
export function isPhotoUrlFavoritedWithVariants(
  memory: Memory,
  favoriteUrls: string[],
  shownUrl: string
): boolean {
  return favoriteUrls.some(f => urlsInSamePhotoVariantGroup(memory, f, shownUrl));
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

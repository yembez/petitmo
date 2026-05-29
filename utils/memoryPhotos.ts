import type { Memory } from '@/types/local';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { peekFeedBootstrapDisplayUrls } from '@/services/feedLocalPhotoCache';
import { isProbablyStalePetitmoSandboxPath } from '@/utils/localMediaReadable';

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
 * Même arbitrage que le viewer immersif : local d’abord, sauf chemins sandbox Petitmo encore en base
 * alors que les fichiers ont disparu (réinstall) → on prend tout de suite la chaîne distante.
 */
/** Affichage fil + viewer immersif : dérivé léger (`display` / `thumb`), pas le print livre. */
export function pickPrimaryPhotoNormalizedForFeedAndViewer(memory: Memory): string {
  const localPick = firstNonEmpty(
    memory.local_display_path,
    memory.local_thumb_path,
    memory.local_print_path,
    memory.local_original_path,
    memory.local_media_path,
  );
  const remotePick = firstNonEmpty(
    memory.display_url,
    memory.thumb_url,
    memory.print_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  );
  const ghostLocal = !!localPick.trim() && isProbablyStalePetitmoSandboxPath(localPick);
  const raw =
    ghostLocal && remotePick.trim()
      ? remotePick.trim()
      : localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Viewer immersif / fil : même dérivé que `pickPrimaryPhotoNormalizedForFeedAndViewer`. */
export function getPrimaryPhotoUriForImmersiveViewer(memory: Memory): string {
  const boot = peekFeedBootstrapDisplayUrls(memory.id)?.[0]?.trim();
  if (boot) return boot;
  return pickPrimaryPhotoNormalizedForFeedAndViewer(memory);
}

/** Pastille date + analyse palette : vignette légère (évite `print.jpg` / original). */
export function pickPhotoUriForOverlayPalette(memory: Memory): string {
  const localPick = firstNonEmpty(memory.local_thumb_path, memory.local_display_path);
  const remotePick = firstNonEmpty(memory.thumb_url, memory.display_url);
  const raw = localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Une case d’album : `extra_photo_paths` peut pointer vers un fichier sandbox mort. */
function pickAlbumExtraSlotNormalized(
  localExtra: string | undefined,
  display: string | undefined,
  thumb: string | undefined,
  original: string | undefined,
): string {
  const loc = typeof localExtra === 'string' ? localExtra.trim() : '';
  const rem = firstNonEmpty(display, thumb, original);
  const ghostLocal = !!loc && isProbablyStalePetitmoSandboxPath(loc);
  if (ghostLocal) {
    if (rem.trim()) return normalizeMemoryMediaUriForDisplay(rem.trim());
    if (loc && extractMediaBucketPath(loc)) return normalizeMemoryMediaUriForDisplay(loc);
    return '';
  }
  const raw = loc || rem;
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/**
 * URI principale pour l’aperçu maquette / livre : **fichiers locaux d’abord** (sandbox / dérivés),
 * puis URLs dérivées (`display_url`, `thumb_url`), puis originaux distants.
 * Chaîne d’URI cohérente avec l’export PDF serveur : préférer fichiers locaux puis URLs dérivées, sans dépendre seulement de `media_url`.
 */
export function getPrimaryPhotoUriForBookPreview(memory: Memory): string {
  const boot = peekFeedBootstrapDisplayUrls(memory.id)?.[0]?.trim();
  if (boot) return boot;

  // Livre = destination impression : préférer `print` (résolution plus haute) de façon cohérente.
  // On garde quand même la logique "sandbox fantôme" (réinstall) : si le local est mort, basculer sur le remote.
  const localPick = firstNonEmpty(
    memory.local_print_path,
    memory.local_display_path,
    memory.local_thumb_path,
    memory.local_original_path,
    memory.local_media_path,
  );
  const remotePick = firstNonEmpty(
    memory.print_url,
    memory.display_url,
    memory.thumb_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  );
  const ghostLocal = !!localPick.trim() && isProbablyStalePetitmoSandboxPath(localPick);
  const raw =
    ghostLocal && remotePick.trim()
      ? remotePick.trim()
      : localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Photo de fond d’un vocal : sandbox d’abord, sauf chemin Petitmo fantôme → URL cloud. */
export function getVoiceCoverUriForBookPreview(memory: Memory): string {
  const localPick = firstNonEmpty(memory.voice_cover_path);
  const remotePick = firstNonEmpty(memory.voice_cover_url);
  const ghostLocal = !!localPick.trim() && isProbablyStalePetitmoSandboxPath(localPick);
  const raw =
    ghostLocal && remotePick.trim()
      ? remotePick.trim()
      : localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Vignette / poster vidéo pour la maquette : dérivés locaux, puis URLs (même heuristique sandbox que le fil). */
export function getVideoPosterUriForBookPreview(memory: Memory): string {
  const localPick = firstNonEmpty(
    memory.local_thumb_path,
    memory.thumbnail_url,
    memory.poster_url,
  );
  const remotePick = firstNonEmpty(
    memory.poster_print_url,
    memory.poster_url,
    memory.thumbnail_url,
  );
  const ghostLocal = !!localPick.trim() && isProbablyStalePetitmoSandboxPath(localPick);
  const raw =
    ghostLocal && remotePick.trim()
      ? remotePick.trim()
      : localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
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
 * URLs pour le fil : alignées sur le viewer immersif (sandbox Petitmo « fantôme » → distant tout de suite),
 * puis dérivés display/thumb par case d’album.
 */
export function getAllPhotoUrlsForFeed(memory: Memory): string[] {
  const first = pickPrimaryPhotoNormalizedForFeedAndViewer(memory);

  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);

  const max = Math.max(localExtras.length, thumbs.length, displays.length, originals.length);
  const cleaned: string[] = [];
  for (let i = 0; i < max; i++) {
    const slot = pickAlbumExtraSlotNormalized(localExtras[i], displays[i], thumbs[i], originals[i]);
    if (slot) cleaned.push(slot);
  }

  return [first, ...cleaned].filter(u => u.length > 0);
}

/**
 * Comme `getAllPhotoUrlsForFeed` mais **sans** colonnes `local_*` ni entrées `extra_photo_paths`
 * avant thumb/display/originals — pour repli cloud quand les fichiers sandbox sont morts (réinstall).
 */
export function getAllPhotoUrlsForFeedRemoteOnly(memory: Memory): string[] {
  const firstRemote = firstNonEmpty(
    memory.display_url,
    memory.thumb_url,
    memory.print_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  );
  const first = firstRemote ? normalizeMemoryMediaUriForDisplay(firstRemote) : '';

  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const paths = asTrimmedStringArray(memory.extra_photo_paths);

  const max = Math.max(thumbs.length, displays.length, originals.length, paths.length);
  const cleaned: string[] = [];
  for (let i = 0; i < max; i++) {
    const raw = firstNonEmpty(displays[i], thumbs[i], originals[i], paths[i]);
    if (raw) cleaned.push(normalizeMemoryMediaUriForDisplay(raw));
  }

  return [first, ...cleaned].filter(u => u.length > 0);
}

/** Souvenir photo avec plusieurs images dans le fil / viewer immersif. */
export function isFeedMultiPhotoAlbum(memory: Memory): boolean {
  if (memory.type !== 'photo') return false;
  return getAllPhotoUrlsForFeed(memory).length > 1;
}

/** URLs canoniques pour `favorite_photo_urls` (une par case d’album, alignées sur le fil). */
export function getAlbumCanonicalFavoriteUrls(memory: Memory): string[] {
  if (memory.type !== 'photo') return [];
  return getAllPhotoUrlsForFeed(memory);
}

/** Toutes les photos de l’album sont dans `favorite_photo_urls` (variantes URL acceptées). */
export function isAlbumFullyFavorited(memory: Memory): boolean {
  const slots = getAlbumCanonicalFavoriteUrls(memory);
  if (slots.length <= 1) return !!memory.is_favorite;
  const favs = parseFavoritePhotoUrls(memory);
  return slots.every(u => isPhotoUrlFavoritedWithVariants(memory, favs, u));
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
      memory.print_url,
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
    memory.print_url,
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

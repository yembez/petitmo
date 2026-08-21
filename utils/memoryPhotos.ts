import type { Memory } from '@/types/local';
import { Platform } from 'react-native';
import { documentDirectory } from 'expo-file-system/legacy';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { peekFeedBootstrapDisplayUrls } from '@/services/feedLocalPhotoCache';
import {
  isSandboxUriFromForeignContainer,
  rebaseSandboxUriToCurrentContainer,
} from '@/utils/localMediaReadable';
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
export function normalizeMemoryMediaUriForDisplay(u: string): string {
  const raw = u.trim();
  if (!raw) return '';
  // Expo Image a parfois résolu un chemin Storage nu → `…/Petitmo.app/<uuid>/…/photo/…` (Bundle mort).
  const fromBundle = extractMediaBucketPath(raw);
  if (fromBundle && (raw.includes('/Bundle/Application/') || /\/[^/]+\.app\//i.test(raw) || raw === fromBundle || raw.replace(/^file:\/\//i, '') === fromBundle)) {
    // Toujours renvoyer le chemin bucket nu (à signer) — jamais file:// Bundle.
    if (raw.includes('/Bundle/Application/') || /\/[^/]+\.app\//i.test(raw) || raw.startsWith('file:')) {
      return fromBundle;
    }
  }
  const bundleLeak = raw.match(/\.app\/((?:guest\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/).+)$/i);
  if (bundleLeak?.[1] && extractMediaBucketPath(bundleLeak[1])) {
    return bundleLeak[1];
  }
  // Rebase container iOS (nouvel UUID après build/réinstall) avant tout : sinon `file://…/<ancien UUID>/…` mort.
  const t = rebaseSandboxUriToCurrentContainer(raw);
  if (
    /^https?:\/\//i.test(t) ||
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://') ||
    t.startsWith('data:')
  ) {
    // file:// Bundle déjà traité supra ; double garde.
    if (t.includes('/Bundle/Application/') || /\/[^/]+\.app\//i.test(t)) {
      return extractMediaBucketPath(t) ?? '';
    }
    return t;
  }
  // Chemin objet Storage (`uuid/.../photo/...`) — pas un fichier local ; évite `file://` incorrect après réinstall.
  if (extractMediaBucketPath(t)) return t;
  // Ne jamais préfixer file:// un chemin qui ressemble à Storage (uuid/…).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t) || t.startsWith('guest/')) return t;
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
  const raw = localPick.trim() || remotePick.trim();
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

function isUnusableLocalPhotoPath(path: string): boolean {
  const t = path.trim();
  if (!t) return true;
  if (t.includes('/Bundle/Application/')) return true;
  return isSandboxUriFromForeignContainer(t);
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
  const locOk = loc && !isUnusableLocalPhotoPath(loc);
  const raw = locOk ? loc : rem || loc;
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/**
 * URI principale pour l’aperçu maquette / livre : **fichiers locaux d’abord** (sandbox / dérivés),
 * puis URLs dérivées (`display_url`, `thumb_url`), puis originaux distants.
 * Chaîne d’URI cohérente avec l’export PDF serveur : préférer fichiers locaux puis URLs dérivées, sans dépendre seulement de `media_url`.
 */
/** Index du slot fil / favori correspondant à `photoRef` (-1 si inconnu). */
export function indexOfPhotoUrlInFeed(memory: Memory, photoRef: string): number {
  if (memory.type !== 'photo') return -1;
  const ref = photoRef.trim();
  if (!ref) return -1;
  const slots = getAllPhotoUrlsForFeed(memory);
  for (let i = 0; i < slots.length; i++) {
    if (urlsInSamePhotoVariantGroup(memory, slots[i], ref)) return i;
  }
  return -1;
}

/** Devine `print.jpg` à côté de `display.jpg` quand `local_print_path` n’est pas encore en base. */
export function inferLocalPrintPathFromDisplay(displayPath: string): string {
  const d = displayPath.trim();
  if (!d) return '';
  const guess = d.replace(/\/display\.(jpe?g|webp|png)$/i, '/print.$1');
  return guess !== d ? guess : '';
}

/** Repli quand `print.jpg` est référencé en base mais pas encore généré sur disque. */
export function inferLocalDisplayPathFromPrint(printPath: string): string {
  const p = printPath.trim();
  if (!p) return '';
  const guess = p.replace(/\/print\.(jpe?g|webp|png)$/i, '/display.$1');
  return guess !== p ? guess : '';
}

import {
  feedLocalThumbnailPathCandidates,
  feedLocalVideoPathCandidates,
} from '@/services/feedLocalPhotoCache';

/** Candidats locaux pour upload guest PDF — ordre qualité décroissante, sans doublons. */
export function collectPhotoLocalUploadUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  add(memory.local_print_path);
  if (memory.local_display_path) {
    add(inferLocalPrintPathFromDisplay(memory.local_display_path));
    add(memory.local_display_path);
  }
  if (memory.local_print_path) {
    add(inferLocalDisplayPathFromPrint(memory.local_print_path));
  }
  add(memory.local_original_path);
  add(memory.local_media_path);
  add(memory.local_thumb_path);
  return out;
}

/**
 * Candidats pour **un seul slot** album (favori / page livre).
 * Ne retombe JAMAIS sur le print primaire quand `photoRef` cible une autre photo —
 * c’était la cause du PDF « même souvenir ×3 ».
 */
export function collectPhotoSlotUploadUriCandidates(
  memory: Memory,
  photoRef?: string | null,
): string[] {
  if (memory.type !== 'photo') return [];
  const ref = (photoRef ?? '').trim();
  if (!ref) return collectPhotoLocalUploadUriCandidates(memory);

  const idx = indexOfPhotoUrlInFeed(memory, ref);
  if (idx === 0) return collectPhotoLocalUploadUriCandidates(memory);

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  if (idx > 0) {
    const extraIdx = idx - 1;
    const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
    const originals = asTrimmedStringArray(memory.extra_photo_urls);
    const displays = asTrimmedStringArray(memory.extra_display_urls);
    const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
    const local = localExtras[extraIdx];
    add(local);
    if (local) {
      add(inferLocalPrintPathFromDisplay(local));
      add(inferLocalDisplayPathFromPrint(local));
    }
    add(originals[extraIdx]);
    add(displays[extraIdx]);
    add(thumbs[extraIdx]);
  }

  // Ref hors feed ou cloud-only : la ref elle-même (jamais le primaire).
  add(ref);
  add(inferLocalDisplayPathFromPrint(ref));
  add(inferLocalPrintPathFromDisplay(ref));
  return out;
}

/**
 * URI print du slot ciblé — **sans** forcer le slot 0 si `photoRef` ne matche pas.
 * Pour l’export PDF / upload guest (parité pages album).
 */
export function getBookPhotoSlotUriStrict(memory: Memory, photoRef: string): string {
  if (memory.type !== 'photo') return '';
  const ref = photoRef.trim();
  if (!ref) return '';
  const idx = indexOfPhotoUrlInFeed(memory, ref);
  if (idx < 0) return normalizeMemoryMediaUriForDisplay(ref) || ref;
  if (idx === 0) {
    const raw = primarySlotPrintPathRaw(memory);
    return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
  }
  const extraIdx = idx - 1;
  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const raw = firstNonEmpty(
    localExtras[extraIdx],
    originals[extraIdx],
    displays[extraIdx],
  );
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : normalizeMemoryMediaUriForDisplay(ref) || ref;
}

function sandboxPhotoFileCandidatesForMemoryId(memoryId: string): string[] {
  if (Platform.OS === 'web' || !documentDirectory) return [];
  const base = `${documentDirectory}petitmo_memories/${memoryId.trim()}/`;
  return [
    `${base}print.jpg`,
    `${base}display.jpg`,
    `${base}original.heic`,
    `${base}original.jpg`,
    `${base}original.png`,
    `${base}original.webp`,
    `${base}thumb.jpg`,
  ];
}

/** Migration cloud / sync : sandbox mémoire + cache fil (`petitmo_feed_local_thumbs/`). */
export function collectPhotoCloudSyncUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const u of collectPhotoLocalUploadUriCandidates(memory)) add(u);
  for (const u of feedLocalThumbnailPathCandidates(memory.id)) add(u);
  for (const u of sandboxPhotoFileCandidatesForMemoryId(memory.id)) add(u);
  const legacyIds = new Set<string>();
  const scanSandboxId = (p: string | null | undefined) => {
    const m = (p ?? '').match(/petitmo_memories\/([^/]+)\//);
    if (m?.[1]) legacyIds.add(m[1]);
  };
  scanSandboxId(memory.local_original_path);
  scanSandboxId(memory.local_media_path);
  scanSandboxId(memory.local_thumb_path);
  scanSandboxId(memory.local_display_path);
  scanSandboxId(memory.local_print_path);
  for (const legacyId of legacyIds) {
    if (legacyId === memory.id) continue;
    for (const u of feedLocalThumbnailPathCandidates(legacyId)) add(u);
    for (const u of sandboxPhotoFileCandidatesForMemoryId(legacyId)) add(u);
  }
  return out;
}

function sandboxVideoFileCandidatesForMemoryId(memoryId: string): string[] {
  if (Platform.OS === 'web' || !documentDirectory) return [];
  const base = `${documentDirectory}petitmo_memories/${memoryId.trim()}/`;
  return [`${base}original.mp4`, `${base}original.mov`, `${base}original.m4v`, `${base}poster.jpg`, `${base}poster_print.jpg`];
}

/** Candidats vidéo pour sync cloud : sandbox + cache fil. */
export function collectVideoCloudSyncUriCandidates(
  memory: Pick<Memory, 'id' | 'edited_media_url' | 'media_url' | 'local_media_path' | 'local_original_path'>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const u of feedLocalVideoPathCandidates(memory.id)) add(u);
  for (const u of sandboxVideoFileCandidatesForMemoryId(memory.id)) add(u);
  add(memory.edited_media_url);
  add(memory.local_original_path);
  add(memory.local_media_path);
  add(memory.media_url);
  const legacyIds = new Set<string>();
  const scanSandboxId = (p: string | null | undefined) => {
    const m = (p ?? '').match(/petitmo_memories\/([^/]+)\//);
    if (m?.[1]) legacyIds.add(m[1]);
  };
  scanSandboxId(memory.local_original_path);
  scanSandboxId(memory.local_media_path);
  for (const legacyId of legacyIds) {
    if (legacyId === memory.id) continue;
    for (const u of feedLocalVideoPathCandidates(legacyId)) add(u);
    for (const u of sandboxVideoFileCandidatesForMemoryId(legacyId)) add(u);
  }
  return out;
}

function primarySlotPrintPathRaw(memory: Memory): string {
  const fromDisplay = memory.local_display_path?.trim()
    ? inferLocalPrintPathFromDisplay(memory.local_display_path)
    : '';
  return firstNonEmpty(
    memory.local_print_path,
    fromDisplay,
    memory.local_original_path,
    memory.local_media_path,
    memory.print_url,
    memory.edited_media_url,
    memory.media_url,
    typeof memory.media_path === 'string' ? memory.media_path : '',
  );
}

/** True si l’URI pointe vers un dérivé display/thumb (pas le fichier d’impression). */
export function isBookDisplayDerivativeUri(uri: string): boolean {
  const t = (uri ?? '').trim();
  if (!t) return false;
  if (/\/display\.(jpe?g|webp|png)(\?|#|$)/i.test(t)) return true;
  if (/\/thumb\.(jpe?g|webp|png)(\?|#|$)/i.test(t)) return true;
  if (/\/(feed_)?thumb[_/]/i.test(t)) return true;
  return false;
}

/** URIs **print uniquement** pour le badge / contrôle DPI (jamais display / thumb). */
export function collectBookPhotoDpiUriCandidates(args: {
  memory: Memory | null;
  photoRef?: string;
  /** URI affichée éditeur — utilisée seulement pour déduire le voisin `print.jpg`. */
  displayUri?: string;
  bookPrintUri?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t) || isBookDisplayDerivativeUri(t)) return;
    seen.add(t);
    out.push(t);
  };

  const { memory, photoRef, displayUri, bookPrintUri } = args;
  if (memory?.type === 'voice') {
    add(memory.local_print_path);
    const cover = (memory.voice_cover_path ?? '').trim();
    if (cover) add(inferLocalVoiceCoverPrintPath(cover));
    add(bookPrintUri ?? undefined);
    if (displayUri) add(inferLocalPrintPathFromDisplay(displayUri));
    return out;
  }
  if (memory?.type === 'photo') {
    add(memory.local_print_path);
    add(getBookPhotoPrintUri(memory, photoRef));
    if (memory.local_display_path) {
      add(inferLocalPrintPathFromDisplay(memory.local_display_path));
    }
    add(memory.print_url);
    add(memory.local_original_path);
    add(memory.media_url);
  }
  // Jamais `displayUri` / thumb pour le DPI — seulement le frère `print.jpg` s’il existe.
  if (displayUri) add(inferLocalPrintPathFromDisplay(displayUri));
  add(bookPrintUri ?? undefined);
  return out;
}

/**
 * Pixels du fichier **print** (colonne SQLite) — pas original, pas display.
 * Slot album > 0 : pas de `print_px_*` par case → `null` (mesurer l’URI du slot).
 * Sinon `null` : il faut mesurer l’URI print via `collectBookPhotoDpiUriCandidates`.
 */
export function getBookPhotoPrintPixelSize(
  memory: Memory,
  photoRef?: string | null,
): { w: number; h: number } | null {
  if (memory.type !== 'photo' && memory.type !== 'voice' && memory.type !== 'video') {
    return null;
  }
  if (memory.type === 'photo') {
    const ref = photoRef?.trim() ?? '';
    let slotIndex = ref ? indexOfPhotoUrlInFeed(memory, ref) : 0;
    if (slotIndex < 0) slotIndex = 0;
    // `print_px_*` = photo principale uniquement.
    if (slotIndex > 0) return null;
  }
  const pw = memory.print_px_w;
  const ph = memory.print_px_h;
  if (typeof pw === 'number' && typeof ph === 'number' && pw > 0 && ph > 0) {
    return { w: pw, h: ph };
  }
  return null;
}

/**
 * URI **print** pour l’éditeur livre / contrôle DPI — jamais thumb ni display fil.
 * `photoRef` : URL favorite / couverture choisie (pour cibler une photo d’album).
 */
export function getBookPhotoPrintUri(memory: Memory, photoRef?: string): string {
  if (memory.type !== 'photo') return '';

  const ref = photoRef?.trim() ?? '';
  let slotIndex = ref ? indexOfPhotoUrlInFeed(memory, ref) : 0;
  if (slotIndex < 0) slotIndex = 0;

  if (slotIndex === 0) {
    const raw = primarySlotPrintPathRaw(memory);
    return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
  }

  const extraIdx = slotIndex - 1;
  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const paths = asTrimmedStringArray(memory.extra_photo_paths);
  // Pas de `extra_display_urls` : le print / original seulement (DPI + export).
  const raw = firstNonEmpty(localExtras[extraIdx], originals[extraIdx], paths[extraIdx]);
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** URI principale photo (slot 0) pour maquette livre / export — toujours variante print. */
export function getPrimaryPhotoUriForBookPreview(memory: Memory): string {
  return getBookPhotoPrintUri(memory);
}

/**
 * Aperçu livre à l’écran : display / thumb (léger) — le print reste pour l’export PDF.
 */
export function getPrimaryPhotoUriForBookMaquetteDisplay(memory: Memory): string {
  if (memory.type !== 'photo') return '';
  const light = pickPhotoUriForOverlayPalette(memory).trim();
  if (light) return light;
  return pickPrimaryPhotoNormalizedForFeedAndViewer(memory);
}

/**
 * Aperçu maquette livre pour un slot photo précis (album / favori).
 * `photoRef` absent = slot principal (0).
 */
export function getPhotoUriForBookMaquetteDisplay(memory: Memory, photoRef?: string): string {
  if (memory.type !== 'photo') return '';
  const ref = photoRef?.trim() ?? '';
  let slotIndex = ref ? indexOfPhotoUrlInFeed(memory, ref) : 0;
  if (slotIndex < 0) slotIndex = 0;
  if (slotIndex === 0) return getPrimaryPhotoUriForBookMaquetteDisplay(memory);

  const extraIdx = slotIndex - 1;
  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  return pickAlbumExtraSlotNormalized(
    localExtras[extraIdx],
    displays[extraIdx],
    thumbs[extraIdx],
    originals[extraIdx],
  );
}

/** Collecte les refs cloud à pré-signer avant affichage maquette livre. */
export function collectBookMaquetteCloudMediaRefs(
  memories: readonly Memory[],
  coverUri?: string | null,
  memoryPhotoRefs?: Record<string, string>,
  /** Toutes les pages (multi-photos d’un même album). */
  pageEntries?: readonly { memoryId: string; photoRef?: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    if (isDeviceLocalMediaUri(t)) return;
    if (!extractMediaBucketPath(t) && !/^https:\/\//i.test(t)) return;
    seen.add(t);
    out.push(t);
  };
  add(coverUri);
  const byId = new Map(memories.map(m => [m.id, m]));
  if (pageEntries && pageEntries.length > 0) {
    for (const e of pageEntries) {
      const m = byId.get(e.memoryId.trim());
      if (!m) continue;
      if (m.type === 'photo') {
        add(getPhotoUriForBookMaquetteDisplay(m, e.photoRef ?? memoryPhotoRefs?.[m.id]));
      } else if (m.type === 'video') {
        add(getVideoPosterUriForBookPreview(m));
      } else if (m.type === 'voice') {
        add(getVoiceCoverUriForBookPreview(m));
      }
    }
    return out;
  }
  for (const m of memories) {
    if (m.type === 'photo') {
      add(getPhotoUriForBookMaquetteDisplay(m, memoryPhotoRefs?.[m.id]));
    } else if (m.type === 'video') {
      add(getVideoPosterUriForBookPreview(m));
    } else if (m.type === 'voice') {
      add(getVoiceCoverUriForBookPreview(m));
    }
  }
  return out;
}

/** Chemin sandbox `voice_cover_print.jpg` (parité `print.jpg` des photos). */
export function inferLocalVoiceCoverPrintPath(coverPath: string): string {
  const c = coverPath.trim();
  if (!c) return '';
  if (/voice_cover_print\./i.test(c)) return c;
  const slash = c.lastIndexOf('/');
  const dir = slash >= 0 ? c.slice(0, slash + 1) : '';
  return `${dir}voice_cover_print.jpg`;
}

/** Candidats locaux cover vocal pour upload PDF / cloud (qualité print d’abord). */
export function collectVoiceCoverLocalUploadUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (memory.type !== 'voice') return out;
  add(memory.local_print_path);
  const cover = (memory.voice_cover_path ?? '').trim();
  if (cover) add(inferLocalVoiceCoverPrintPath(cover));
  add(memory.voice_cover_path);
  return out;
}

/** Ancien cache ImagePicker (`…/voice/cover_*.jpg`) — souvent mort après redémarrage. */
function isStaleVoicePickerCachePath(uri: string | null | undefined): boolean {
  const t = (uri ?? '').trim();
  return t.includes('/voice/cover_') && !t.includes('petitmo_memories');
}

function voiceCoverSandboxFileCandidates(memoryId: string): string[] {
  if (Platform.OS === 'web' || !documentDirectory) return [];
  const base = `${documentDirectory}petitmo_memories/${memoryId.trim()}/`;
  return [
    `${base}voice_cover.jpg`,
    `${base}voice_cover.jpeg`,
    `${base}voice_cover.png`,
    `${base}voice_cover.webp`,
  ];
}

/** Candidats locaux lisibles pour générer `voice_cover_print.jpg`. */
export function collectVoiceCoverReadableSourceCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t) || /^https?:\/\//i.test(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (memory.type !== 'voice') return out;
  const stored = (memory.voice_cover_path ?? '').trim();
  if (stored && !isStaleVoicePickerCachePath(stored)) add(stored);
  for (const p of voiceCoverSandboxFileCandidates(memory.id)) add(p);
  return out;
}

/** Chemins sandbox uniquement — pas les colonnes cloud (`voice_cover_url`). */
function pickVoiceCoverSandboxPath(memory: Memory): string {
  const stored = (memory.voice_cover_path ?? '').trim();
  if (stored && !isStaleVoicePickerCachePath(stored)) return stored;
  return '';
}

/** Vrai seulement si l’utilisatrice a ajouté une cover (colonnes SQLite / cloud), pas un chemin candidat vide. */
export function memoryHasExplicitVoiceCover(memory: Memory): boolean {
  if (memory.type !== 'voice') return false;
  if ((memory.voice_cover_url ?? '').trim()) return true;
  const path = (memory.voice_cover_path ?? '').trim();
  return !!(path && !isStaleVoicePickerCachePath(path));
}

/** Livre / PDF : dérivé print local (`local_print_path`), sinon cover d’origine. */
export function getVoiceCoverUriForBookPreview(memory: Memory): string {
  const localPick = firstNonEmpty(memory.local_print_path, pickVoiceCoverSandboxPath(memory));
  const remotePick = firstNonEmpty(memory.voice_cover_url);
  const raw = localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Fil / favoris / viewer : cover légère (pas le dérivé print livre). */
export function getVoiceCoverUriForFeedAndViewer(memory: Memory): string {
  const localPick = pickVoiceCoverSandboxPath(memory);
  const remotePick = firstNonEmpty(memory.voice_cover_url);
  const raw = localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/**
 * Éditeur livre (recadrage inline) : cover d’origine pour le pinch/pan ;
 * le badge DPI utilise le dérivé print via `collectBookPhotoDpiUriCandidates`.
 */
export function getVoiceCoverUriForBookEditorDisplay(memory: Memory): string {
  if (memory.type !== 'voice') return '';
  const display = getVoiceCoverUriForFeedAndViewer(memory).trim();
  if (display) return display;
  return getVoiceCoverUriForBookPreview(memory);
}

/**
 * Variante d’URL quand un fichier local est écrasé au même chemin (`voice_cover.jpg`) :
 * fait varier l’URI affichée quand `updated_at` change (cache expo-image / SDWebImage).
 */
export function appendLocalMediaCacheBuster(
  uri: string,
  updatedAt?: string | null,
): string {
  const base = uri.trim();
  if (!base) return '';
  const rev = (updatedAt ?? '').trim();
  if (!rev) return base;
  if (
    base.startsWith('file:') ||
    base.startsWith('content:') ||
    base.startsWith('ph://')
  ) {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}petitmo_v=${encodeURIComponent(rev)}`;
  }
  return base;
}

/** URI affichage cover vocal fil / viewer (cache-buster local sur `updated_at`). */
export function getVoiceCoverDisplayUriForFeedAndViewer(memory: Memory): string {
  const raw = getVoiceCoverUriForFeedAndViewer(memory);
  return appendLocalMediaCacheBuster(raw, memory.updated_at);
}

export function isDeviceLocalMediaUri(u: string | null | undefined): boolean {
  const t = (u ?? '').trim();
  if (!t || /^https?:\/\//i.test(t) || t.startsWith('data:')) return false;
  return (
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('/') ||
    t.includes('petitmo_memories/')
  );
}

/** Chemins sandbox poster fil (`poster.jpg`) — pas `poster_print.jpg`. */
function pickVideoPosterSandboxPath(memory: Memory): string {
  for (const u of [memory.local_thumb_path, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && isDeviceLocalMediaUri(t) && !t.endsWith('poster_print.jpg')) return t;
  }
  return '';
}

/** Poster impression livre (`poster_print.jpg`) — local sandbox uniquement. */
function pickVideoPosterPrintSandboxPath(memory: Memory): string {
  for (const u of [memory.local_poster_print_path, memory.poster_print_url]) {
    const t = (u ?? '').trim();
    if (t && isDeviceLocalMediaUri(t)) return t;
  }
  for (const u of sandboxVideoFileCandidatesForMemoryId(memory.id)) {
    if (u.endsWith('poster_print.jpg')) return u;
  }
  return '';
}

function remoteVideoPosterColumns(memory: Memory): string {
  for (const u of [memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && !isDeviceLocalMediaUri(t)) return t;
  }
  return '';
}

function remoteVideoPosterPrintColumns(memory: Memory): string {
  const t = (memory.poster_print_url ?? '').trim();
  if (t && !isDeviceLocalMediaUri(t)) return t;
  return '';
}

function resolveVideoPosterUri(localPick: string, remotePick: string): string {
  const raw = localPick.trim() || remotePick.trim();
  return raw ? normalizeMemoryMediaUriForDisplay(raw) : '';
}

/** Candidats poster fil uniquement (`poster.jpg`, pas `poster_print.jpg`). */
export function collectVideoFeedPosterLocalUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t) || t.endsWith('poster_print.jpg')) return;
    seen.add(t);
    out.push(t);
  };
  if (memory.type !== 'video') return out;
  add(memory.local_thumb_path);
  add(memory.poster_url);
  add(memory.thumbnail_url);
  add(pickVideoPosterSandboxPath(memory));
  for (const u of sandboxVideoFileCandidatesForMemoryId(memory.id)) {
    if (u.endsWith('poster.jpg')) add(u);
  }
  return out;
}

/** Candidats locaux poster vidéo pour upload PDF / cloud. */
export function collectVideoPosterLocalUploadUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (memory.type !== 'video') return out;
  add(memory.local_poster_print_path);
  const printLocal = pickVideoPosterPrintSandboxPath(memory);
  if (printLocal) add(printLocal);
  add(memory.local_thumb_path);
  add(memory.poster_url);
  add(memory.thumbnail_url);
  add(pickVideoPosterSandboxPath(memory));
  for (const u of sandboxVideoFileCandidatesForMemoryId(memory.id)) {
    if (u.endsWith('poster.jpg') || u.endsWith('poster_print.jpg')) add(u);
  }
  return out;
}

/**
 * Candidats **print only** (`poster_print.jpg`) — export livre quand un poster custom existe.
 * Ne jamais inclure `poster.jpg` (frame t≈0) : sinon Gelato reçoit la mauvaise image.
 */
export function collectVideoPosterPrintOnlyUploadUriCandidates(memory: Memory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) return;
    // HTTPS remote print OK à lister pour pick lisible local seulement si file/content.
    if (/^https?:\/\//i.test(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (memory.type !== 'video') return out;
  add(memory.local_poster_print_path);
  const printLocal = pickVideoPosterPrintSandboxPath(memory);
  if (printLocal) add(printLocal);
  const pp = (memory.poster_print_url ?? '').trim();
  if (pp && isDeviceLocalMediaUri(pp) && pp.includes('poster_print')) add(pp);
  for (const u of sandboxVideoFileCandidatesForMemoryId(memory.id)) {
    if (u.endsWith('poster_print.jpg')) add(u);
  }
  return out;
}

/** True si l'utilisatrice a choisi une image d'illustration livre (`poster_print`). */
export function hasCustomVideoPrintPoster(memory: Memory): boolean {
  if (memory.type !== 'video') return false;
  if ((memory.local_poster_print_path ?? '').trim()) return true;
  const pp = (memory.poster_print_url ?? '').trim();
  if (!pp) return false;
  if (!isDeviceLocalMediaUri(pp)) return true;
  return pp.includes('poster_print');
}

/** Poster impression livre : `poster_print` d’abord, repli `poster` fil. */
export function getVideoPosterPrintUriForBookPreview(memory: Memory): string {
  if (memory.type !== 'video' || !hasCustomVideoPrintPoster(memory)) return '';
  const printLocal = pickVideoPosterPrintSandboxPath(memory);
  if (printLocal.trim()) return resolveVideoPosterUri(printLocal, '');
  const printRemote = remoteVideoPosterPrintColumns(memory);
  if (printRemote.trim()) return resolveVideoPosterUri('', printRemote);
  return '';
}

/** Vignette / poster vidéo : fil, favoris, viewer immersif. */
export function getVideoPosterUriForFeedAndViewer(memory: Memory): string {
  const localPick = pickVideoPosterSandboxPath(memory);
  const remotePick = remoteVideoPosterColumns(memory);
  return resolveVideoPosterUri(localPick, remotePick);
}

/** Livre / PDF : illustration custom si choisie, sinon poster fil par défaut (t≈0). */
export function getVideoPosterUriForBookPreview(memory: Memory): string {
  if (memory.type !== 'video') return '';
  if (hasCustomVideoPrintPoster(memory)) {
    const custom = getVideoPosterPrintUriForBookPreview(memory);
    if (custom.trim()) return custom;
  }
  const defaultPoster = getVideoPosterUriForFeedAndViewer(memory);
  if (defaultPoster.trim()) return defaultPoster;
  const remotePick = remoteVideoPosterPrintColumns(memory) || remoteVideoPosterColumns(memory);
  return resolveVideoPosterUri('', remotePick);
}

/** URI affichage maquette livre — bust cache si `poster_print.jpg` réécrit au même chemin. */
export function getBookVideoPosterDisplayUri(memory: Memory): string {
  const raw = getVideoPosterUriForBookPreview(memory).trim();
  if (!raw) return '';
  if (hasCustomVideoPrintPoster(memory) && isDeviceLocalMediaUri(raw)) {
    return appendLocalMediaCacheBuster(raw, memory.updated_at);
  }
  return raw;
}

/**
 * Poster vidéo livre pour le premier paint (prefetch / legacy).
 * Ne renvoie que le cache session ou une URL https — jamais un chemin local non vérifié.
 * Préférer `peekSyncBookVideoPosterDisplayUri` (`utils/bookVideoPosterUri.ts`).
 */
export function getBookVideoPosterSyncDisplayUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  for (const u of [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && /^https?:\/\//i.test(t)) return normalizeMemoryMediaUriForDisplay(t);
  }
  return '';
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
 * URLs pour le fil : `local_*` d’abord, puis colonnes distantes ; repli cloud après réinstall dans `useFeedPhotoDisplayUrls`.
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
    memory.local_thumb_path,
    memory.local_display_path,
    memory.local_print_path,
    memory.local_original_path,
    memory.local_media_path,
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

  const localExtras = asTrimmedStringArray(memory.extra_photo_paths);
  const displays = asTrimmedStringArray(memory.extra_display_urls);
  const thumbs = asTrimmedStringArray(memory.extra_thumb_urls);
  const originals = asTrimmedStringArray(memory.extra_photo_urls);
  const paths = asTrimmedStringArray(memory.extra_photo_paths);
  const n = Math.max(localExtras.length, displays.length, thumbs.length, originals.length, paths.length);
  for (let i = 0; i < n; i++) {
    const g = [localExtras[i], displays[i], thumbs[i], originals[i], paths[i]].filter(
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

/** True si deux URLs désignent le même slot photo (display/print/thumb/original…). */
export function urlsInSamePhotoVariantGroup(memory: Memory, a: string, b: string): boolean {
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

  const slots = getAllPhotoUrlsForFeed(memory);
  for (const slot of slots) {
    if (urlsInSamePhotoVariantGroup(memory, slot, o)) return slot;
  }

  return o;
}

/** Vrai si `url` désigne une variante (locale ou distante) d’une photo du souvenir. */
export function memoryPhotoMatchesUrl(memory: Memory, url: string): boolean {
  const u = url.trim();
  if (!u || memory.type !== 'photo') return false;

  const candidates: string[] = [];
  const push = (v: unknown) => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t) candidates.push(t);
  };
  push(memory.local_thumb_path);
  push(memory.local_display_path);
  push(memory.local_print_path);
  push(memory.local_original_path);
  push(memory.local_media_path);
  push(memory.display_url);
  push(memory.thumb_url);
  push(memory.print_url);
  push(memory.edited_media_url);
  push(memory.media_url);
  push(memory.media_path);
  asTrimmedStringArray(memory.extra_photo_paths).forEach(push);
  asTrimmedStringArray(memory.extra_display_urls).forEach(push);
  asTrimmedStringArray(memory.extra_thumb_urls).forEach(push);
  asTrimmedStringArray(memory.extra_photo_urls).forEach(push);
  parseFavoritePhotoUrls(memory).forEach(push);

  for (const c of candidates) {
    if (urlsInSamePhotoVariantGroup(memory, c, u)) return true;
  }
  return false;
}

/** URLs des photos d’album marquées comme favoris (colonne `favorite_photo_urls`). */
export function parseFavoritePhotoUrls(memory: Memory): string[] {
  const raw = memory.favorite_photo_urls;
  const arr: unknown[] = Array.isArray(raw) ? raw : [];
  return arr
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map(u => u.trim());
}

/** Référence à stocker dans `book.coverPhotoUrl` (URL favorite / slot fil, pas le thumb). */
export function canonicalBookCoverPhotoRef(memory: Memory): string {
  if (memory.type !== 'photo') return '';
  const favs = parseFavoritePhotoUrls(memory);
  if (favs[0]?.trim()) return favs[0].trim();
  return getAllPhotoUrlsForFeed(memory)[0]?.trim() || getBookPhotoPrintUri(memory);
}

export function normalizePhotoUrlForCompare(url: string): string {
  return rebaseSandboxUriToCurrentContainer(url.trim());
}

export function isPhotoUrlFavorited(favoriteUrls: string[], photoUrl: string): boolean {
  const n = normalizePhotoUrlForCompare(photoUrl);
  return favoriteUrls.some(u => normalizePhotoUrlForCompare(u) === n);
}

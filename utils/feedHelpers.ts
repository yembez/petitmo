import type { PendingUpload } from '@/contexts/PendingMediaUploadsContext';
import { getAllPhotoUrlsForFeed } from '@/utils/memoryPhotos';

import type { Child, Memory } from '@/types/local';
export type { Memory, Child } from '@/types/local';

export function filChildLiteKey(c: Child | null): string {
  if (!c) return '';
  const localPh = (c.local_photo_path ?? '').trim();
  // Sync cloud peut remplir `photo_url` sans changer l’affichage local — ne pas invalider le memo.
  const remotePh = localPh ? '' : (c.photo_url ?? '').trim();
  return `${c.id}|${c.birthdate ?? ''}|${localPh}|${remotePh}|${c.name.trim()}`;
}

/** Clé stable pour memo fil quand la liste famille change (birthdate, prénom…). */
export function filFamilyChildrenLiteKey(children: Child[]): string {
  return [...children]
    .sort((a, b) => (a.birthdate ?? '').localeCompare(b.birthdate ?? '') || a.id.localeCompare(b.id))
    .map(c => filChildLiteKey(c))
    .join('|');
}

export function filMemoryLiteKey(m: Memory): string {
  return JSON.stringify({
    id: m.id,
    t: m.type,
    mp: (m.media_path ?? '').trim(),
    ldp: m.local_display_path,
    ltp: m.local_thumb_path,
    lmp: m.local_media_path,
    lop: m.local_original_path,
    lpp: m.local_print_path,
    lx: m.extra_photo_paths,
    th: m.thumb_url,
    d: m.display_url,
    pu: (m.print_url ?? '').trim(),
    eth: m.extra_thumb_urls,
    ed: m.extra_display_urls,
    epo: m.extra_photo_urls,
    po: m.poster_url,
    tn: m.thumbnail_url,
    fav: m.is_favorite,
    c: m.content,
    favp: m.favorite_photo_urls,
    vc: m.voice_cover_url,
    vcp: m.voice_cover_path,
    mu: m.media_url,
    emu: m.edited_media_url,
    dur: m.duration,
    ca: m.created_at,
    ins: m.inserted_at,
    ua: m.updated_at,
    coi: m.captured_overlay_ink,
    loc: (m.location ?? '').trim(),
  });
}

/**
 * Égalité **affichage** fil/capture — ignore sync cloud (`thumb_url`, `sync_status`, etc.).
 * Si true, un upsert SQLite post-sync ne doit **pas** remonter React / FlatList.
 */
export function filMemoryVisualEqual(a: Memory, b: Memory): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.type !== b.type) return false;
  return (
    (a.content ?? '') === (b.content ?? '') &&
    (a.text_title ?? '') === (b.text_title ?? '') &&
    !!a.is_favorite === !!b.is_favorite &&
    (a.location ?? '') === (b.location ?? '') &&
    a.created_at === b.created_at &&
    (a.local_thumb_path ?? '') === (b.local_thumb_path ?? '') &&
    (a.local_display_path ?? '') === (b.local_display_path ?? '') &&
    (a.local_original_path ?? '') === (b.local_original_path ?? '') &&
    (a.local_media_path ?? '') === (b.local_media_path ?? '') &&
    (a.local_print_path ?? '') === (b.local_print_path ?? '') &&
    (a.voice_cover_path ?? '') === (b.voice_cover_path ?? '') &&
    JSON.stringify(a.extra_photo_paths ?? []) === JSON.stringify(b.extra_photo_paths ?? []) &&
    JSON.stringify(a.favorite_photo_urls ?? []) === JSON.stringify(b.favorite_photo_urls ?? []) &&
    (a.duration ?? null) === (b.duration ?? null) &&
    (a.captured_overlay_ink ?? null) === (b.captured_overlay_ink ?? null)
  );
}

function compareMemoriesByEventDateDesc(a: Memory, b: Memory): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (tb !== ta) return tb - ta;
  const ia = new Date(a.inserted_at ?? a.created_at).getTime();
  const ib = new Date(b.inserted_at ?? b.created_at).getTime();
  return ib - ia;
}

/**
 * Quand `getMemories` revient juste après un import, on recevait une **nouvelle** liste d’objets :
 * même contenu visible, références différentes → React / FlatList recyclaient les cellules → flash.
 * On garde l’ancienne référence `Memory` si l’affichage local est identique (`filMemoryVisualEqual`) —
 * **pas** `filMemoryLiteKey` (qui inclut les URLs cloud et ferait remonter la sync).
 *
 * **Union prev + server** : le SQLite local peut être un cran derrière Supabase (pull async) ;
 * si on ne faisait que `server.map`, une liste serveur incomplète **écrasait** les souvenirs déjà
 * fusionnés via `petitmo:memories-inserted` → une seule carte ou fil vide (ex. texte non encore pull).
 */
export function mergeMemoriesListPreservingVisualRowRefs(prev: Memory[], server: Memory[]): Memory[] {
  if (prev.length === 0) return [...server].sort(compareMemoriesByEventDateDesc);
  if (server.length === 0) {
    return [...prev].sort(compareMemoriesByEventDateDesc);
  }

  const prevById = new Map(prev.map(m => [m.id, m]));
  const mergedById = new Map<string, Memory>();

  for (const s of server) {
    const p = prevById.get(s.id);
    if (p && filMemoryVisualEqual(p, s)) {
      mergedById.set(s.id, p);
    } else {
      mergedById.set(s.id, s);
    }
  }

  for (const p of prev) {
    if (!mergedById.has(p.id)) {
      mergedById.set(p.id, p);
    }
  }

  return [...mergedById.values()].sort(compareMemoriesByEventDateDesc);
}

/** Souvenir factice pendant l’upload : même `FilMemoryRow` que le souvenir final (pas de carte « envoi » différente). */
export function buildOptimisticMemoryForPending(p: PendingUpload, child: Child | null): Memory {
  const now = new Date().toISOString();
  const uris = p.previewUris.map(u => u.trim()).filter(Boolean);
  const childId = child?.id ?? '';
  const emptyExtras = [] as unknown as Memory['extra_photo_urls'];

  const captureIso = p.capturedAtPreviewIso?.trim();
  const createdAtForRow = captureIso || now;

  const localFirstUri = uris[0] ?? null;

  const shared = {
    id: p.tempId,
    child_id: childId,
    user_id: '',
    content: null,
    is_favorite: false,
    upload_status: 'pending' as const,
    local_media_path: localFirstUri,
    synced_at: null,
    location: p.locationPreview?.trim() || null,
    file_size: null,
    captured_overlay_ink: null,
    voice_cover_url: null,
    voice_cover_path: null,
    voice_playback_start_sec: null,
    edited_media_url: null,
    media_path: null,
    thumbnail_path: null,
    print_url: null,
    poster_print_url: null,
    inserted_at: now,
    created_at: createdAtForRow,
    updated_at: now,
    favorite_photo_urls: emptyExtras,
    extra_photo_paths: emptyExtras,
  };

  if (p.kind === 'video') {
    const poster = p.previewPosterUri?.trim() || null;
    return {
      ...shared,
      type: 'video',
      media_url: uris[0] ?? null,
      duration: null,
      thumbnail_url: poster,
      thumb_url: poster,
      display_url: null,
      poster_url: poster,
      local_thumb_path: poster,
      extra_photo_urls: emptyExtras,
      extra_thumb_urls: emptyExtras,
      extra_display_urls: emptyExtras,
    };
  }

  const [first, ...rest] = uris;
  const restArr = (rest.length ? rest : []) as unknown as Memory['extra_photo_urls'];
  return {
    ...shared,
    type: 'photo',
    media_url: first ?? null,
    duration: null,
    thumbnail_url: null,
    thumb_url: first ?? null,
    display_url: first ?? null,
    poster_url: null,
    extra_photo_urls: restArr,
    extra_thumb_urls: restArr,
    extra_display_urls: restArr,
  };
}

export function canRenderOptimisticPendingRow(p: PendingUpload): boolean {
  if (p.status === 'error' || p.committedMemory) return false;
  if (!p.previewUris.some(u => u?.trim())) return false;
  return p.kind === 'photo' || p.kind === 'video';
}

/** Photo/vidéo avec fichier en base mais encore aucune vignette affichable dans le fil (worker / dérivés). */
export function memoryWaitingForFeedDerivatives(m: Memory): boolean {
  if (m.type === 'photo') {
    return !!(m.media_path?.trim()) && getAllPhotoUrlsForFeed(m).length === 0;
  }
  if (m.type === 'video') {
    const poster =
      (m.poster_url?.trim() || m.thumbnail_url?.trim() || '') !== '';
    return !!(m.media_path?.trim()) && !poster;
  }
  return false;
}

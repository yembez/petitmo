import type { Memory } from '@/types/local';
import { awaitVideoPosterForBookMemory } from '@/services/memoryLocalStore';
import {
  collectVideoFeedPosterLocalUriCandidates,
  collectVideoPosterLocalUploadUriCandidates,
  getBookVideoPosterDisplayUri,
  hasCustomVideoPrintPoster,
  isDeviceLocalMediaUri,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import {
  isLocalMediaUriReadable,
  isSandboxUriFromForeignContainer,
  pickFirstReadableLocalMediaUri,
} from '@/utils/localMediaReadable';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import {
  peekBookVideoPosterStableCache,
  resolveBookVideoPosterStableCache,
} from '@/hooks/bookVideoPosterStableCache';

function normalizePosterDisplay(u: string): string {
  const t = u.trim();
  return t ? normalizeMemoryMediaUriForDisplay(t) : '';
}

function collectVideoPrintPosterLocalUriCandidates(memory: Memory): string[] {
  if (memory.type !== 'video') return [];
  return collectVideoPosterLocalUploadUriCandidates(memory).filter(u =>
    u.endsWith('poster_print.jpg'),
  );
}

async function readableLocalUriCandidates(candidates: string[]): Promise<string> {
  for (const u of candidates) {
    const t = (u ?? '').trim();
    if (!t || !isDeviceLocalMediaUri(t)) continue;
    if (isSandboxUriFromForeignContainer(t)) continue;
    if (await isLocalMediaUriReadable(t)) {
      return normalizePosterDisplay(t);
    }
  }
  return '';
}

async function readableCustomPrintPosterUri(memory: Memory): Promise<string> {
  if (!hasCustomVideoPrintPoster(memory)) return '';
  return readableLocalUriCandidates(collectVideoPrintPosterLocalUriCandidates(memory));
}

async function readableFeedPosterUri(memory: Memory): Promise<string> {
  return readableLocalUriCandidates(collectVideoFeedPosterLocalUriCandidates(memory));
}

async function resolveRemoteBookPoster(memory: Memory): Promise<string> {
  for (const u of [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (!t || isDeviceLocalMediaUri(t)) continue;
    if (/^https?:\/\//i.test(t)) return normalizePosterDisplay(t);
    const signed = (await getSignedMediaDisplayUrl(t)).trim();
    if (signed) return normalizePosterDisplay(signed);
  }
  return '';
}

async function resolveReadableBookPoster(memory: Memory): Promise<string> {
  const custom = await readableCustomPrintPosterUri(memory);
  if (custom) return getBookVideoPosterDisplayUri(memory).trim() || custom;

  const feed = await readableFeedPosterUri(memory);
  if (feed) return feed;

  return resolveRemoteBookPoster(memory);
}

/**
 * Résout un poster vidéo affichable pour spread + éditeur livre — jamais un chemin sandbox mort.
 */
export async function resolveBookVideoPosterDisplayUri(memory: Memory): Promise<string> {
  if (memory.type !== 'video') return '';

  let resolved = await resolveReadableBookPoster(memory);
  if (resolved) return resolveBookVideoPosterStableCache(memory.id, resolved);

  const updated = await awaitVideoPosterForBookMemory(memory.id);
  if (updated) {
    resolved = await resolveReadableBookPoster(updated);
    if (resolved) return resolveBookVideoPosterStableCache(memory.id, resolved);
  }

  return '';
}

/** True si une vignette vidéo est déjà affichable (local lisible ou remote https). */
export async function hasReadableBookVideoPoster(memory: Memory): Promise<boolean> {
  if (memory.type !== 'video') return false;
  const cached = peekBookVideoPosterStableCache(memory.id);
  if (cached) return true;
  const local =
    (await readableCustomPrintPosterUri(memory)) || (await readableFeedPosterUri(memory));
  if (local) return true;
  const remote = await resolveRemoteBookPoster(memory);
  return !!remote.trim();
}

/**
 * Sync local-first : print custom d’abord, puis feed, puis https.
 * La lisibilité FS est confirmée en async (`resolveBookVideoPosterDisplayUri`).
 */
export function peekSyncBookVideoPosterDisplayUri(memory: Memory): string {
  if (memory.type !== 'video') return '';
  const cached = peekBookVideoPosterStableCache(memory.id);
  if (cached) return normalizePosterDisplay(cached);

  for (const u of collectVideoPrintPosterLocalUriCandidates(memory)) {
    const t = (u ?? '').trim();
    if (!t || !isDeviceLocalMediaUri(t)) continue;
    if (isSandboxUriFromForeignContainer(t)) continue;
    return normalizePosterDisplay(t);
  }

  for (const u of collectVideoFeedPosterLocalUriCandidates(memory)) {
    const t = (u ?? '').trim();
    if (!t || !isDeviceLocalMediaUri(t)) continue;
    if (isSandboxUriFromForeignContainer(t)) continue;
    return normalizePosterDisplay(t);
  }

  for (const u of [memory.poster_print_url, memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && /^https?:\/\//i.test(t)) return normalizePosterDisplay(t);
  }
  return '';
}

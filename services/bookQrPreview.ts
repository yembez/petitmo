import type { BookPage } from '@/src/book/BookEngine';
import type { BookPageServer } from '@/types/shared';
import type { GenerateBookPdfResponse } from '@/types/shared';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import { primeBookQrTokens, readBookQrTokenFromLocal } from '@/lib/bookQrTokenStore';
import { supabase } from '@/lib/supabase';
import { publicMediaBaseUrl, bookQrUrlForToken } from '@/lib/publicMediaBaseUrl';
import {
  bookPortraitPerfNetwork,
  bookPortraitPerfTiming,
  isBookPortraitPerfEnabled,
} from '@/utils/bookPortraitSpreadPerf';

function pdfServerBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_PDF_SERVER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

function mapPagesForResolve(pages: BookPage[]): BookPageServer[] {
  return pages.map(p => {
    const memoryId =
      'memory' in p && p.memory && typeof p.memory.id === 'string' ? p.memory.id : undefined;
    return {
      type: p.type,
      ...(memoryId ? { memoryId } : {}),
      ...(p.type === 'chapter' ? { month: p.month, chapterNum: p.chapterNum } : {}),
      ...(p.type === 'photo-full' ? { variant: p.variant } : {}),
    };
  });
}

/** Ids audio/vidéo uniques dans l’ordre des pages. */
export function audioVideoMemoryIdsFromPages(pages: BookPage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pages) {
    if (p.type !== 'audio' && p.type !== 'video') continue;
    const id = p.memory.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Clé stable pour éviter un refetch réseau à chaque remontage `pages`. */
export function bookQrMemoryIdsKey(pages: BookPage[]): string {
  return audioVideoMemoryIdsFromPages(pages).sort().join(',');
}

/** Tokens QR déjà résolus — cache SQLite local-first. */
export function readCachedBookQrTokens(memoryIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of memoryIds) {
    const token = readBookQrTokenFromLocal(id);
    if (token) out[id] = token;
  }
  if (Object.keys(out).length > 0) {
    primeBookQrTokens(out);
  }
  return out;
}

/** Persiste les tokens définitifs par souvenir (une fois générés côté cloud). */
export function persistBookQrTokens(tokens: Record<string, string>): void {
  const persisted: Record<string, string> = {};
  for (const [memoryId, token] of Object.entries(tokens)) {
    const t = token.trim();
    if (!t) continue;
    const cur = getLocalMemoryById(memoryId);
    if (!cur) continue;
    if ((cur.public_media_token ?? '').trim() === t) {
      persisted[memoryId] = t;
      continue;
    }
    upsertLocalMemory({ ...cur, public_media_token: t });
    persisted[memoryId] = t;
  }
  if (Object.keys(persisted).length > 0) {
    primeBookQrTokens(persisted);
  }
}

const resolveInflightByKey = new Map<string, Promise<Record<string, string>>>();

async function fetchBookQrTokensFromServer(
  childId: string,
  pages: BookPage[],
): Promise<Record<string, string>> {
  const base = pdfServerBaseUrl();
  if (!base) return {};

  const avPages = pages.filter(p => p.type === 'audio' || p.type === 'video');
  if (avPages.length === 0) return {};

  const startedAt = Date.now();
  if (isBookPortraitPerfEnabled()) {
    bookPortraitPerfNetwork('resolve-tokens:fetch-start', {
      pageCount: avPages.length,
      childId: childId.slice(0, 8),
    });
  }

  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) return {};

  const res = await fetch(`${base}/v1/public-media/resolve-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      childId,
      pages: mapPagesForResolve(avPages),
    }),
  });

  if (!res.ok) {
    if (isBookPortraitPerfEnabled()) {
      bookPortraitPerfTiming('resolve-tokens:fetch-fail', startedAt, { status: res.status });
    }
    console.warn('[bookQrPreview] resolve-tokens', res.status);
    return {};
  }

  const json = (await res.json()) as { tokens?: Record<string, string> };
  if (isBookPortraitPerfEnabled()) {
    bookPortraitPerfTiming('resolve-tokens:fetch-ok', startedAt, {
      tokenCount: Object.keys(json.tokens ?? {}).length,
    });
  }
  return json.tokens ?? {};
}

/**
 * Tokens QR stables pour l’aperçu livre (compte cloud + serveur PDF configuré).
 * Cache SQLite : une fois résolu, le token est définitif pour le souvenir.
 * Mode local pur : retourne le cache local uniquement (pas de QR cloud avant export).
 */
export async function resolveBookQrTokensForPreview(
  childId: string,
  pages: BookPage[],
): Promise<Record<string, string>> {
  const avIds = audioVideoMemoryIdsFromPages(pages);
  if (avIds.length === 0) return {};

  const cached = readCachedBookQrTokens(avIds);
  const missingIds = avIds.filter(id => !cached[id]?.trim());
  if (missingIds.length === 0) return cached;

  const inflightKey = `${childId}:${missingIds.sort().join(',')}`;
  const inflight = resolveInflightByKey.get(inflightKey);
  if (inflight) {
    const fetched = await inflight;
    return { ...cached, ...fetched };
  }

  const missingSet = new Set(missingIds);
  const pagesToResolve = pages.filter(
    p =>
      (p.type === 'audio' || p.type === 'video') && missingSet.has(p.memory.id.trim()),
  );

  const promise = (async (): Promise<Record<string, string>> => {
    const fetched = await fetchBookQrTokensFromServer(childId, pagesToResolve);
    if (Object.keys(fetched).length > 0) {
      persistBookQrTokens(fetched);
    }
    return fetched;
  })();

  resolveInflightByKey.set(inflightKey, promise);
  try {
    const fetched = await promise;
    return { ...cached, ...fetched };
  } finally {
    resolveInflightByKey.delete(inflightKey);
  }
}

/** Persiste les tokens renvoyés par `generate-pdf` — aperçu livre immédiat post-export. */
export function persistQrTokensFromPdfResponse(response: GenerateBookPdfResponse): void {
  const tokens = response.qrTokensByMemoryId;
  if (!tokens || Object.keys(tokens).length === 0) return;
  persistBookQrTokens(tokens);
}

/**
 * Remappe `public_media_tokens.media_id` côté cloud après `remapLegacyEntityIdsForCloudSync`.
 * Best-effort : n’interrompt pas l’upgrade si le serveur PDF est injoignable.
 */
export async function remapBookQrTokensOnCloudAfterIdRemap(
  memoryIdMap: Map<string, string>,
): Promise<void> {
  if (memoryIdMap.size === 0) return;
  const base = pdfServerBaseUrl();
  if (!base) return;

  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) return;

  const remaps = [...memoryIdMap.entries()].map(([from, to]) => ({ from, to }));
  try {
    const res = await fetch(`${base}/v1/public-media/remap-media-ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ remaps }),
    });
    if (!res.ok) {
      console.warn('[bookQrPreview] remap-media-ids', res.status);
    }
  } catch (e) {
    console.warn('[bookQrPreview] remap-media-ids', e);
  }
}

export function qrPreviewUrlForMemory(
  memoryId: string | undefined,
  tokensByMemoryId: Record<string, string>,
): string {
  if (!memoryId) return '';
  const token = tokensByMemoryId[memoryId]?.trim() || readBookQrTokenFromLocal(memoryId);
  return token ? bookQrUrlForToken(token) : '';
}

export { publicMediaBaseUrl, bookQrUrlForToken };

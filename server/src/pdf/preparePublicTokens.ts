import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookPageServer } from '../types/contracts';
import type { MemoryRow } from './memoryRow';
import { ensurePublicMediaToken } from '../publicMediaTokens';
import { bookPublicMediaExpiresAtIso, FREE_TIER_QR_AV_MAX_PER_BOOK } from '../constants/spec';
import { linkPublicMediaTokenToMemorySource } from './linkPublicMediaTokenSource';

export type PrepareTokensResult =
  | { ok: true; tokensByMemoryId: Map<string, string> }
  | { ok: false; status: number; message: string };

function countAudioVideoPages(pages: BookPageServer[]): number {
  return pages.filter(p => p.type === 'audio' || p.type === 'video').length;
}

/**
 * Crée/assure l’existence de tokens stables (public) pour audio/vidéo d’un livre.
 * IMPORTANT: ne dépend pas de l’existence des fichiers (PDF immédiat).
 */
export async function preparePublicTokensForBook(params: {
  supabase: SupabaseClient;
  userId: string;
  childId: string;
  bookId: string;
  pages: BookPageServer[];
  memoriesById: Map<string, MemoryRow>;
  subscriptionTier: 'free' | 'premium';
}): Promise<PrepareTokensResult> {
  const { supabase, pages, memoriesById, subscriptionTier } = params;
  const avCount = countAudioVideoPages(pages);
  if (subscriptionTier === 'free' && avCount > FREE_TIER_QR_AV_MAX_PER_BOOK) {
    return {
      ok: false,
      status: 400,
      message: `Free tier: maximum ${FREE_TIER_QR_AV_MAX_PER_BOOK} pages audio/vidéo avec QR par livre.`,
    };
  }

  const tokensByMemoryId = new Map<string, string>();
  const seen = new Set<string>();
  const orderedAvIds: string[] = [];
  for (const p of pages) {
    if (p.type !== 'audio' && p.type !== 'video') continue;
    const id = p.memoryId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedAvIds.push(id);
  }

  for (const memoryId of orderedAvIds) {
    const m = memoriesById.get(memoryId);
    if (!m) return { ok: false, status: 400, message: `Missing memory ${memoryId}` };
    const kind: 'audio' | 'video' = m.type === 'video' ? 'video' : 'audio';
    if (m.type !== 'voice' && m.type !== 'video') {
      return { ok: false, status: 400, message: `Memory ${memoryId} is not audio/video` };
    }
    const tok = await ensurePublicMediaToken({
      supabase,
      mediaId: memoryId,
      kind,
      expiresAtIso: bookPublicMediaExpiresAtIso(),
    });
    await linkPublicMediaTokenToMemorySource(supabase, tok, m);
    tokensByMemoryId.set(memoryId, tok);
  }

  return { ok: true, tokensByMemoryId };
}

/**
 * Tokens stables pour un export guest (ticket) : `memory_client_id` = id local côté app.
 */
export async function preparePublicTokensForExportRequest(params: {
  supabase: SupabaseClient;
  exportRequestId: string;
  bookId: string;
  pages: BookPageServer[];
  memoriesById: Map<string, MemoryRow>;
  subscriptionTier: 'free' | 'premium';
}): Promise<PrepareTokensResult> {
  const { supabase, pages, memoriesById, subscriptionTier } = params;
  const avCount = countAudioVideoPages(pages);
  if (subscriptionTier === 'free' && avCount > FREE_TIER_QR_AV_MAX_PER_BOOK) {
    return {
      ok: false,
      status: 400,
      message: `Free tier: maximum ${FREE_TIER_QR_AV_MAX_PER_BOOK} pages audio/vidéo avec QR par livre.`,
    };
  }
  const tokensByMemoryId = new Map<string, string>();
  const seen = new Set<string>();
  const orderedAvIds: string[] = [];
  for (const p of pages) {
    if (p.type !== 'audio' && p.type !== 'video') continue;
    const id = p.memoryId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedAvIds.push(id);
  }

  for (const memoryClientId of orderedAvIds) {
    const m = memoriesById.get(memoryClientId);
    if (!m) return { ok: false, status: 400, message: `Missing memory ${memoryClientId}` };
    const kind: 'audio' | 'video' = m.type === 'video' ? 'video' : 'audio';
    if (m.type !== 'voice' && m.type !== 'video') {
      return { ok: false, status: 400, message: `Memory ${memoryClientId} is not audio/video` };
    }
    // Token stable basé sur memoryClientId (id local). `exportRequestId` pourra servir plus tard pour rattacher/cleanup.
    const tok = await ensurePublicMediaToken({
      supabase,
      mediaId: memoryClientId,
      kind,
      expiresAtIso: bookPublicMediaExpiresAtIso(),
    });
    await linkPublicMediaTokenToMemorySource(supabase, tok, m);
    tokensByMemoryId.set(memoryClientId, tok);
  }
  return { ok: true, tokensByMemoryId };
}


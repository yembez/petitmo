import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookPageServer } from '../types/contracts';
import type { MemoryRow } from './memoryRow';
import {
  FREE_TIER_QR_AV_MAX_PER_BOOK,
  qrLinkExpiresAtIso,
  qrLinkExpiresAtIsoForExportRequest,
} from '../constants/spec';

const execFileAsync = promisify(execFile);

function newQrToken(): string {
  return randomBytes(27).toString('base64url');
}

function countAudioVideoPages(pages: BookPageServer[]): number {
  return pages.filter(p => p.type === 'audio' || p.type === 'video').length;
}

function isLinkUsable(expiresAt: string, revokedAt: string | null): boolean {
  if (revokedAt != null) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > Date.now();
}

async function downloadSourceMedia(
  supabase: SupabaseClient,
  m: MemoryRow
): Promise<Buffer> {
  if (m.media_path) {
    const { data, error } = await supabase.storage.from('media').download(m.media_path);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  }
  const url = (m.media_url ?? '').trim();
  if (!url) {
    throw new Error('no media_path or media_url');
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch media failed ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function transcodeVideo(tmpDir: string, inputBuf: Buffer, premium: boolean): Promise<Buffer> {
  const inPath = path.join(tmpDir, 'in_vid');
  const outPath = path.join(tmpDir, 'out.mp4');
  await import('node:fs/promises').then(fs => fs.writeFile(inPath, inputBuf));

  const vf = premium
    ? 'scale=-2:720:force_original_aspect_ratio=decrease'
    : 'scale=-2:480:force_original_aspect_ratio=decrease';
  const crf = premium ? '23' : '28';
  const ab = premium ? '128k' : '64k';

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    crf,
    '-c:a',
    'aac',
    '-b:a',
    ab,
    '-movflags',
    '+faststart',
    outPath,
  ]);

  return readFile(outPath);
}

async function transcodeAudio(tmpDir: string, inputBuf: Buffer, premium: boolean): Promise<Buffer> {
  const inPath = path.join(tmpDir, 'in_aud');
  const outPath = path.join(tmpDir, 'out.m4a');
  await import('node:fs/promises').then(fs => fs.writeFile(inPath, inputBuf));

  const args = ['-y', '-i', inPath, '-ac', '1', '-c:a', 'aac', '-movflags', '+faststart'];
  if (premium) {
    args.push('-ar', '44100', '-b:a', '96k');
  } else {
    args.push('-ar', '24000', '-b:a', '32k');
  }
  args.push(outPath);

  await execFileAsync('ffmpeg', args);
  return readFile(outPath);
}

export type PrepareQrResult =
  | { ok: true; tokensByMemoryId: Map<string, string> }
  | { ok: false; status: number; message: string };

/**
 * Prépare les fichiers qr-media + lignes `qr_links` (compte enfant Supabase).
 * Pour le flux export / ticket : `prepareQrTokensForExportRequest` → `qr_links_exports`.
 * Les deux utilisent la même URL `${qrBaseUrl}/q/${token}`.
 */
export async function prepareQrTokensForBook(
  supabase: SupabaseClient,
  params: {
    userId: string;
    childId: string;
    bookId: string;
    pages: BookPageServer[];
    memoriesById: Map<string, MemoryRow>;
    subscriptionTier: 'free' | 'premium';
  }
): Promise<PrepareQrResult> {
  const { userId, childId, bookId, pages, memoriesById, subscriptionTier } = params;
  const avCount = countAudioVideoPages(pages);
  if (subscriptionTier === 'free' && avCount > FREE_TIER_QR_AV_MAX_PER_BOOK) {
    return {
      ok: false,
      status: 400,
      message: `Free tier: maximum ${FREE_TIER_QR_AV_MAX_PER_BOOK} pages audio/vidéo avec QR par livre.`,
    };
  }

  const tokensByMemoryId = new Map<string, string>();
  const premium = subscriptionTier === 'premium';

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
    if (!m) {
      return { ok: false, status: 400, message: `Missing memory ${memoryId}` };
    }

    const kind: 'audio' | 'video' = m.type === 'video' ? 'video' : 'audio';
    if (m.type !== 'voice' && m.type !== 'video') {
      return { ok: false, status: 400, message: `Memory ${memoryId} is not audio/video` };
    }

    const { data: existing } = await supabase
      .from('qr_links')
      .select('token, expires_at, revoked_at')
      .eq('book_id', bookId)
      .eq('memory_id', memoryId)
      .maybeSingle();

    if (
      existing &&
      typeof existing.token === 'string' &&
      typeof existing.expires_at === 'string' &&
      isLinkUsable(existing.expires_at, existing.revoked_at as string | null)
    ) {
      tokensByMemoryId.set(memoryId, existing.token);
      continue;
    }

    let source: Buffer;
    try {
      source = await downloadSourceMedia(supabase, m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'download failed';
      return { ok: false, status: 500, message: `QR source ${memoryId}: ${msg}` };
    }

    const tmpDir = await mkdtemp(path.join(tmpdir(), 'petitmo-qr-'));
    try {
      let outBytes: Buffer;
      let ext: string;
      let contentType: string;
      if (kind === 'video') {
        outBytes = await transcodeVideo(tmpDir, source, premium);
        ext = 'mp4';
        contentType = 'video/mp4';
      } else {
        outBytes = await transcodeAudio(tmpDir, source, premium);
        ext = 'm4a';
        contentType = 'audio/mp4';
      }

      const objectPath = `${userId}/${childId}/${bookId}/${memoryId}.${ext}`;
      const { error: upErr } = await supabase.storage.from('qr-media').upload(objectPath, outBytes, {
        contentType,
        upsert: true,
      });
      if (upErr) {
        return { ok: false, status: 500, message: `qr-media upload: ${upErr.message}` };
      }

      await supabase.from('qr_links').delete().eq('book_id', bookId).eq('memory_id', memoryId);

      const token = newQrToken();
      const expiresAt = qrLinkExpiresAtIso(subscriptionTier);

      const { error: insErr } = await supabase.from('qr_links').insert({
        token,
        child_id: childId,
        memory_id: memoryId,
        book_id: bookId,
        storage_bucket: 'qr-media',
        media_path: objectPath,
        kind,
        expires_at: expiresAt,
      });

      if (insErr) {
        return { ok: false, status: 500, message: `qr_links insert: ${insErr.message}` };
      }

      tokensByMemoryId.set(memoryId, token);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return { ok: true, tokensByMemoryId };
}

/**
 * Même logique que `prepareQrTokensForBook`, mais lignes `qr_links_exports` + chemins
 * `exports/{exportRequestId}/…` (flux ticket / sans compte).
 */
export async function prepareQrTokensForExportRequest(
  supabase: SupabaseClient,
  params: {
    exportRequestId: string;
    bookId: string;
    pages: BookPageServer[];
    memoriesById: Map<string, MemoryRow>;
    subscriptionTier: 'free' | 'premium';
  }
): Promise<PrepareQrResult> {
  const { exportRequestId, bookId, pages, memoriesById, subscriptionTier } = params;
  const avCount = countAudioVideoPages(pages);
  if (subscriptionTier === 'free' && avCount > FREE_TIER_QR_AV_MAX_PER_BOOK) {
    return {
      ok: false,
      status: 400,
      message: `Free tier: maximum ${FREE_TIER_QR_AV_MAX_PER_BOOK} pages audio/vidéo avec QR par livre.`,
    };
  }

  const tokensByMemoryId = new Map<string, string>();
  const premium = subscriptionTier === 'premium';

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
    if (!m) {
      return { ok: false, status: 400, message: `Missing memory ${memoryClientId}` };
    }

    const kind: 'audio' | 'video' = m.type === 'video' ? 'video' : 'audio';
    if (m.type !== 'voice' && m.type !== 'video') {
      return { ok: false, status: 400, message: `Memory ${memoryClientId} is not audio/video` };
    }

    const { data: existing } = await supabase
      .from('qr_links_exports')
      .select('token, expires_at, revoked_at')
      .eq('export_request_id', exportRequestId)
      .eq('memory_client_id', memoryClientId)
      .maybeSingle();

    if (
      existing &&
      typeof existing.token === 'string' &&
      typeof existing.expires_at === 'string' &&
      isLinkUsable(existing.expires_at, existing.revoked_at as string | null)
    ) {
      tokensByMemoryId.set(memoryClientId, existing.token);
      continue;
    }

    let source: Buffer;
    try {
      source = await downloadSourceMedia(supabase, m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'download failed';
      return { ok: false, status: 500, message: `QR source ${memoryClientId}: ${msg}` };
    }

    const tmpDir = await mkdtemp(path.join(tmpdir(), 'petitmo-qr-export-'));
    try {
      let outBytes: Buffer;
      let ext: string;
      let contentType: string;
      if (kind === 'video') {
        outBytes = await transcodeVideo(tmpDir, source, premium);
        ext = 'mp4';
        contentType = 'video/mp4';
      } else {
        outBytes = await transcodeAudio(tmpDir, source, premium);
        ext = 'm4a';
        contentType = 'audio/mp4';
      }

      const objectPath = `exports/${exportRequestId}/${memoryClientId}.${ext}`;
      const { error: upErr } = await supabase.storage.from('qr-media').upload(objectPath, outBytes, {
        contentType,
        upsert: true,
      });
      if (upErr) {
        return { ok: false, status: 500, message: `qr-media upload: ${upErr.message}` };
      }

      await supabase
        .from('qr_links_exports')
        .delete()
        .eq('export_request_id', exportRequestId)
        .eq('memory_client_id', memoryClientId);

      const token = newQrToken();
      const expiresAt = qrLinkExpiresAtIsoForExportRequest();

      const { error: insErr } = await supabase.from('qr_links_exports').insert({
        token,
        export_request_id: exportRequestId,
        book_id: bookId,
        memory_client_id: memoryClientId,
        storage_bucket: 'qr-media',
        media_path: objectPath,
        kind,
        expires_at: expiresAt,
      });

      if (insErr) {
        return { ok: false, status: 500, message: `qr_links_exports insert: ${insErr.message}` };
      }

      tokensByMemoryId.set(memoryClientId, token);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return { ok: true, tokensByMemoryId };
}

import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import { collectMemoriesFromPagesForPdf } from '@/services/bookPdfServer';
import { requestMissingMediaDerivatives } from '@/services/media';
import { ensureMemoryUploadedForCloud } from '@/services/migration';
import { supabase } from '@/lib/supabase';

export type BookExportPrepIssue =
  | { kind: 'cover_https'; message: string }
  | { kind: 'photo_https'; memoryId: string; message: string }
  | { kind: 'video_thumb_https'; memoryId: string; message: string }
  | { kind: 'av_media_missing'; memoryId: string; message: string };

function isHttps(u: string | null | undefined): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim());
}

function isProbablyLocalUri(u: string | null | undefined): boolean {
  const t = (u ?? '').trim();
  return !!t && (/^file:\/\//i.test(t) || /^ph:\/\//i.test(t) || /^content:\/\//i.test(t));
}

function photoMainUrl(m: Memory): string {
  return (
    m.print_url ??
    m.display_url ??
    m.edited_media_url ??
    m.media_url ??
    ''
  ).trim();
}

function videoThumbUrl(m: Memory): string {
  return (m.thumbnail_url ?? m.poster_url ?? '').trim();
}

/**
 * Vérifie si un export PDF serveur (guest) est possible sans erreur "URL https".
 * - Photos: nécessite une URL https sur au moins un des champs (print/display/edited/media).
 * - Vidéos: nécessite une vignette https (thumbnail/poster).
 * - Audio/Vidéo (QR): nécessite `media_path` (préféré) OU `media_url` https.
 *
 * NOTE: la cover peut être omise (placeholder) si non prête.
 */
export function getBookExportPrepIssues(params: {
  pages: BookPage[];
  localEdits: Record<string, Partial<Memory>>;
  child: Child;
  coverPhotoUrl?: string | null;
}): BookExportPrepIssue[] {
  const { pages, localEdits } = params;
  const issues: BookExportPrepIssue[] = [];

  // Cover: ne bloque pas (placeholder), mais on peut signaler si c'est local.
  const cover = (params.coverPhotoUrl ?? params.child.photo_url ?? '').trim();
  if (cover && isProbablyLocalUri(cover)) {
    issues.push({
      kind: 'cover_https',
      message: 'La photo de couverture est locale. Elle ne sera pas utilisée côté serveur tant qu’elle n’est pas en https.',
    });
  }

  const memories = collectMemoriesFromPagesForPdf(pages, localEdits);
  const byId = new Map(memories.map(m => [m.id, m]));

  for (const p of pages) {
    if (p.type === 'photo-full' || p.type === 'photo-note') {
      const m = byId.get(p.memory.id);
      if (!m) continue;
      const main = photoMainUrl(m);
      if (main && !isHttps(main)) {
        issues.push({
          kind: 'photo_https',
          memoryId: m.id,
          message: 'Photo non synchronisée (URL https requise pour l’export serveur).',
        });
      }
    }

    if (p.type === 'video') {
      const m = byId.get(p.memory.id);
      if (!m) continue;
      const thumb = videoThumbUrl(m);
      if (thumb && !isHttps(thumb)) {
        issues.push({
          kind: 'video_thumb_https',
          memoryId: m.id,
          message: 'Vignette vidéo non synchronisée (URL https requise pour l’export serveur).',
        });
      }
      // QR doit pouvoir récupérer la vidéo
      const hasMedia = !!(m.media_path?.trim() || isHttps(m.media_url));
      if (!hasMedia) {
        issues.push({
          kind: 'av_media_missing',
          memoryId: m.id,
          message: 'Vidéo non prête pour QR (media_path ou URL https manquante).',
        });
      }
    }

    if (p.type === 'audio') {
      const m = byId.get(p.memory.id);
      if (!m) continue;
      const hasMedia = !!(m.media_path?.trim() || isHttps(m.media_url));
      if (!hasMedia) {
        issues.push({
          kind: 'av_media_missing',
          memoryId: m.id,
          message: 'Audio non prêt pour QR (media_path ou URL https manquante).',
        });
      }
    }
  }

  return issues;
}

/**
 * Tente de préparer l’export serveur en tâche de fond:
 * - si une session Supabase existe, pousse les souvenirs locaux vers le cloud (upload + insert/merge)
 * - déclenche `process-memory` pour générer les dérivés (print/poster/thumb) manquants
 *
 * Best-effort: ne jette pas d’erreur (UX: on garde la preview locale).
 */
export async function runBookExportPrepInBackground(params: {
  pages: BookPage[];
  localEdits: Record<string, Partial<Memory>>;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const hasSession = !!data.session?.access_token;
    if (!hasSession) return;

    const memories = collectMemoriesFromPagesForPdf(params.pages, params.localEdits);

    // 1) Pousser les médias locaux si nécessaire (cible: audio/video + photos manquantes).
    //    Cela rend `media_url`/`media_path` disponibles et permet au serveur de dériver print/poster.
    for (const m of memories) {
      if (m.type === 'text') continue;
      const hasRemote = isHttps(m.media_url) || !!m.media_path?.trim();
      if (hasRemote) continue;
      if (!m.local_media_path?.trim() && !m.local_original_path?.trim()) continue;
      await ensureMemoryUploadedForCloud(m);
    }

    // 2) Dérivés côté serveur (print_url, thumbnail_url, poster_url, …)
    if (memories.length > 0) {
      await requestMissingMediaDerivatives(memories);
    }
  } catch {
    // best-effort
  }
}


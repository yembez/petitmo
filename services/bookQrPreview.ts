import type { BookPage } from '@/src/book/BookEngine';
import type { BookPageServer } from '@/types/shared';
import { supabase } from '@/lib/supabase';
import { publicMediaBaseUrl, bookQrUrlForToken } from '@/lib/publicMediaBaseUrl';

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

/**
 * Tokens QR stables pour l’aperçu livre (compte cloud + serveur PDF configuré).
 * Mode local pur : retourne une map vide — l’aperçu n’affiche pas de QR jouable avant export.
 */
export async function resolveBookQrTokensForPreview(
  childId: string,
  pages: BookPage[],
): Promise<Record<string, string>> {
  const base = pdfServerBaseUrl();
  if (!base) return {};

  const avPages = pages.filter(p => p.type === 'audio' || p.type === 'video');
  if (avPages.length === 0) return {};

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
      pages: mapPagesForResolve(pages),
    }),
  });

  if (!res.ok) {
    console.warn('[bookQrPreview] resolve-tokens', res.status);
    return {};
  }

  const json = (await res.json()) as { tokens?: Record<string, string> };
  return json.tokens ?? {};
}

export function qrPreviewUrlForMemory(
  memoryId: string | undefined,
  tokensByMemoryId: Record<string, string>,
): string {
  if (!memoryId) return '';
  const token = tokensByMemoryId[memoryId]?.trim();
  if (token) return bookQrUrlForToken(token);
  return '';
}

export { publicMediaBaseUrl, bookQrUrlForToken };

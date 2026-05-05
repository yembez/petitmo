import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChildRow, MemoryRow } from './memoryRow';

/** Assez long pour Playwright (`networkidle`) + génération PDF. */
export const PDF_RENDER_MEDIA_SIGNED_SEC = 7200;

const BARE_MEDIA_PATH_RE =
  /^(guest\/exports\/|exports\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)/i;

function parseStoragePathFromUrl(projectOrigin: string, rawUrl: string): { bucket: string; path: string } | null {
  const u = rawUrl.trim();
  if (!u.startsWith('http')) {
    if (BARE_MEDIA_PATH_RE.test(u)) return { bucket: 'media', path: u };
    return null;
  }
  let pathname: string;
  try {
    const parsed = new URL(u);
    pathname = parsed.pathname;
    const expectedOrigin = new URL(projectOrigin.replace(/\/$/, '')).origin;
    if (parsed.origin !== expectedOrigin) return null;
  } catch {
    return null;
  }

  const patterns: RegExp[] = [
    /\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
    /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
    /\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/,
  ];
  for (const re of patterns) {
    const m = pathname.match(re);
    if (m?.[1] && m[2]) {
      try {
        return { bucket: m[1], path: decodeURIComponent(m[2]) };
      } catch {
        return { bucket: m[1], path: m[2] };
      }
    }
  }
  const plain = pathname.match(/\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (
    plain?.[1] &&
    plain[2] &&
    plain[1] !== 'sign' &&
    plain[1] !== 'public' &&
    plain[1] !== 'authenticated'
  ) {
    try {
      return { bucket: plain[1], path: decodeURIComponent(plain[2]) };
    } catch {
      return { bucket: plain[1], path: plain[2] };
    }
  }
  return null;
}

export async function signUrlForPdfRender(
  supabase: SupabaseClient,
  projectOrigin: string,
  url: string | null | undefined
): Promise<string | null | undefined> {
  if (url == null) return url;
  const trimmed = url.trim();
  if (!trimmed) return url;
  const ref = parseStoragePathFromUrl(projectOrigin, trimmed);
  if (!ref) return url;
  const { data, error } = await supabase.storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, PDF_RENDER_MEDIA_SIGNED_SEC);
  if (error || !data?.signedUrl) {
    console.warn('[pdf-sign]', ref.bucket, ref.path, error?.message);
    return url;
  }
  return data.signedUrl;
}

const MEMORY_URL_FIELDS: Array<keyof MemoryRow> = [
  'media_url',
  'edited_media_url',
  'thumbnail_url',
  'display_url',
  'print_url',
  'poster_url',
  'poster_print_url',
  'voice_cover_url',
];

export async function signMemoryRowForPdfRender(
  supabase: SupabaseClient,
  projectOrigin: string,
  row: MemoryRow
): Promise<MemoryRow> {
  const out: MemoryRow = { ...row };
  for (const key of MEMORY_URL_FIELDS) {
    const v = out[key];
    if (typeof v === 'string' && v.trim()) {
      const s = await signUrlForPdfRender(supabase, projectOrigin, v);
      if (typeof s === 'string') {
        (out as Record<string, unknown>)[key as string] = s;
      }
    }
  }
  /**
   * Vocal : `voice_cover_path` (bucket `media`) est la source de vérité. Toujours préférer une
   * URL signée fraîche depuis ce chemin quand il existe, sinon Playwright peut charger un JWT
   * expiré encore présent dans `voice_cover_url`.
   */
  if (out.type === 'voice') {
    const pathTrim = typeof out.voice_cover_path === 'string' ? out.voice_cover_path.trim() : '';
    if (pathTrim) {
      const signed = await signUrlForPdfRender(supabase, projectOrigin, pathTrim);
      if (typeof signed === 'string' && /^https:\/\//i.test(signed.trim())) {
        out.voice_cover_url = signed.trim();
      }
    }
  }
  return out;
}

export async function signMemoriesMapForPdfRender(
  supabase: SupabaseClient,
  projectOrigin: string,
  map: Map<string, MemoryRow>
): Promise<Map<string, MemoryRow>> {
  const entries = await Promise.all(
    [...map.entries()].map(async ([id, row]) => [id, await signMemoryRowForPdfRender(supabase, projectOrigin, row)] as const)
  );
  return new Map(entries);
}

export async function signChildRowForPdfRender(
  supabase: SupabaseClient,
  projectOrigin: string,
  child: ChildRow
): Promise<ChildRow> {
  const photo = child.photo_url;
  if (typeof photo !== 'string' || !photo.trim()) return child;
  const signed = await signUrlForPdfRender(supabase, projectOrigin, photo);
  if (typeof signed === 'string' && signed.trim()) {
    return { ...child, photo_url: signed };
  }
  return child;
}

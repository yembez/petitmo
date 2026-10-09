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
  // Retry léger : pool Supabase saturé → « Too many connections » → URL morte dans Chromium.
  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await supabase.storage
      .from(ref.bucket)
      .createSignedUrl(ref.path, PDF_RENDER_MEDIA_SIGNED_SEC);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    lastErr = error?.message ?? 'no signedUrl';
    console.warn('[pdf-sign]', ref.bucket, ref.path, lastErr, `attempt=${attempt}`);
    if (/too many connections/i.test(lastErr) && attempt < 3) {
      await new Promise(r => setTimeout(r, 200 * attempt));
      continue;
    }
    break;
  }
  // Ne pas renvoyer une URL signée expirée / morte : Chromium échoue en PDF_CROP_IMAGE_LOAD_FAILED.
  throw new Error(`PDF_SIGN_FAILED ${ref.bucket}/${ref.path}: ${lastErr ?? 'unknown'}`);
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
   * Vocal : toujours produire une URL signée fraîche pour Playwright.
   * Source : `voice_cover_path`, ou chemin dérivé de `voice_cover_url` si la colonne path est vide.
   */
  if (out.type === 'voice') {
    let pathTrim = typeof out.voice_cover_path === 'string' ? out.voice_cover_path.trim() : '';
    if (!pathTrim && typeof out.voice_cover_url === 'string' && out.voice_cover_url.trim()) {
      const ref = parseStoragePathFromUrl(projectOrigin, out.voice_cover_url.trim());
      if (ref?.bucket === 'media' && ref.path?.trim()) pathTrim = ref.path.trim();
    }
    if (pathTrim) {
      const signed = await signUrlForPdfRender(supabase, projectOrigin, pathTrim);
      if (typeof signed === 'string' && /^https:\/\//i.test(signed.trim())) {
        out.voice_cover_url = signed.trim();
      }
    }
  }
  return out;
}

/** Limite la concurrence des createSignedUrl — évite « Too many connections » Supabase. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function signMemoriesMapForPdfRender(
  supabase: SupabaseClient,
  projectOrigin: string,
  map: Map<string, MemoryRow>
): Promise<Map<string, MemoryRow>> {
  const items = [...map.entries()];
  const signed = await mapPool(items, 4, async ([id, row]) => {
    const next = await signMemoryRowForPdfRender(supabase, projectOrigin, row);
    return [id, next] as const;
  });
  return new Map(signed);
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

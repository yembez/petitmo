import { useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '@/lib/supabase';

/** Affichage client : URLs courtes, re-signées au besoin via le cache. */
export const MEDIA_DISPLAY_SIGNED_TTL_SEC = 3600;

const CACHE_SKEW_MS = 60_000;

const signedDisplayCache = new Map<string, { url: string; expiresAt: number }>();

const BARE_MEDIA_PATH_RE =
  /^(guest\/exports\/|exports\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)/i;

/**
 * Extrait le chemin objet dans le bucket `media` à partir d’une URL Supabase Storage
 * ou d’un chemin nu (ex. `userId/childId/...`).
 */
export function extractMediaBucketPath(urlOrPath: string): string | null {
  const s = urlOrPath.trim();
  if (!s) return null;
  if (!s.startsWith('http')) {
    if (BARE_MEDIA_PATH_RE.test(s)) return s;
    return null;
  }
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;
  let origin: string;
  try {
    origin = new URL(s).origin;
  } catch {
    return null;
  }
  if (origin !== new URL(base).origin) return null;

  const m = s.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/media\/(.+?)(?:\?|$)/);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function getSignedUrlForMediaPath(path: string, ttlSec: number): Promise<string | null> {
  const cached = signedDisplayCache.get(path);
  if (cached && cached.expiresAt > Date.now() + CACHE_SKEW_MS) {
    return cached.url;
  }
  const { data, error } = await supabase.storage.from('media').createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) {
    console.warn('[mediaSignedUrl]', path, error?.message);
    return null;
  }
  signedDisplayCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  return data.signedUrl;
}

/**
 * Pour l’UI : si ce n’est pas une URL HTTP vers notre Storage `media`, renvoie l’entrée telle quelle
 * (fichier local, data:, autre CDN).
 */
export async function getSignedMediaDisplayUrl(remoteUrlOrPath: string): Promise<string> {
  const trimmed = remoteUrlOrPath.trim();
  if (!trimmed) return trimmed;
  const path = extractMediaBucketPath(trimmed);
  if (!path) return trimmed;
  const signed = await getSignedUrlForMediaPath(path, MEDIA_DISPLAY_SIGNED_TTL_SEC);
  return signed ?? trimmed;
}

/** Après upload authentifié : URL signée stockée en base (TTL plus long ; le fil re-signe via le cache). */
export const MEDIA_POST_UPLOAD_SIGNED_TTL_SEC = 60 * 60 * 24 * 7;

export async function getSignedUrlAfterMediaUpload(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('media')
    .createSignedUrl(filePath, MEDIA_POST_UPLOAD_SIGNED_TTL_SEC);
  if (error || !data?.signedUrl) {
    throw error ?? new Error('Impossible de signer l’URL média après upload');
  }
  return data.signedUrl;
}

export function useSignedMediaUrl(url: string | null | undefined): string | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  const initial = raw || null;
  const [out, setOut] = useState<string | null>(initial);

  useEffect(() => {
    if (!raw) {
      setOut(null);
      return;
    }
    let alive = true;
    void (async () => {
      const next = await getSignedMediaDisplayUrl(raw);
      if (alive) setOut(next || null);
    })();
    return () => {
      alive = false;
    };
  }, [raw]);

  return out;
}

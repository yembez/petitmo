import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { bookPortraitPerfNetwork, isBookPortraitPerfEnabled } from '@/utils/bookPortraitSpreadPerf';

/** Affichage client : URLs courtes, re-signées au besoin via le cache. */
export const MEDIA_DISPLAY_SIGNED_TTL_SEC = 3600;

const CACHE_SKEW_MS = 60_000;

/** Limite conservative pour `createSignedUrls` (évite timeouts / limites API). */
const SIGNED_URL_BATCH_SIZE = 80;

const signedDisplayCache = new Map<string, { url: string; expiresAt: number }>();

const BARE_MEDIA_PATH_RE =
  /^(guest\/exports\/|exports\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)/i;

/**
 * Extrait le chemin objet dans le bucket `media` à partir d’une URL Supabase Storage
 * ou d’un chemin nu (ex. `userId/childId/...`).
 *
 * Ne compare pas l’origine à `EXPO_PUBLIC_SUPABASE_URL` : en build, l’URL en base peut
 * venir d’un autre sous-domaine / variante, ou `Constants.expoConfig` peut diverger — sans
 * chemin extrait, `createSignedUrl` n’est jamais appelé et les images restent cassées.
 */
/**
 * True si Expo Image / RN résoudrait ce chemin sous `…/Petitmo.app/<bucketPath>` (WARN Bundle).
 */
export function isAppBundleMediaLeakUri(uri: string | null | undefined): boolean {
  const t = (uri ?? '').trim();
  if (!t) return false;
  return t.includes('/Bundle/Application/') || /\/[^/]+\.app\//i.test(t);
}

export function extractMediaBucketPath(urlOrPath: string): string | null {
  const s = urlOrPath.trim();
  if (!s) return null;
  // iOS : bare path résolu → `file:///…/Petitmo.app/uuid/child/photo/…`
  const bundleLeak = s.match(
    /\.app\/((?:guest\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/).+)$/i,
  );
  if (bundleLeak?.[1] && BARE_MEDIA_PATH_RE.test(bundleLeak[1])) {
    return bundleLeak[1];
  }
  if (!s.startsWith('http')) {
    if (BARE_MEDIA_PATH_RE.test(s)) return s;
    // `file:///uuid/...` (file:// à tort sur un chemin Storage)
    const noFile = s.replace(/^file:\/\//i, '');
    if (BARE_MEDIA_PATH_RE.test(noFile)) return noFile;
    return null;
  }
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/media\/(.+?)(?:\?|$)/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function cacheSignedPath(path: string, url: string, ttlSec: number): void {
  signedDisplayCache.set(path, {
    url,
    expiresAt: Date.now() + ttlSec * 1000,
  });
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
  cacheSignedPath(path, data.signedUrl, ttlSec);
  return data.signedUrl;
}

/**
 * Pré-remplit le cache d’URLs signées en **un ou peu d’appels** `createSignedUrls`.
 * Les entrées non reconnues comme chemins / URLs bucket `media` sont ignorées.
 */
export async function primeSignedMediaDisplayUrls(remoteUrlOrPaths: string[]): Promise<void> {
  const pathsToSign: string[] = [];
  for (const raw of remoteUrlOrPaths) {
    const path = extractMediaBucketPath(raw.trim());
    if (!path) continue;
    const cached = signedDisplayCache.get(path);
    if (cached && cached.expiresAt > Date.now() + CACHE_SKEW_MS) continue;
    pathsToSign.push(path);
  }
  const uniq = [...new Set(pathsToSign)];
  if (uniq.length === 0) return;

  for (let i = 0; i < uniq.length; i += SIGNED_URL_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + SIGNED_URL_BATCH_SIZE);
    const { data, error } = await supabase.storage
      .from('media')
      .createSignedUrls(chunk, MEDIA_DISPLAY_SIGNED_TTL_SEC);

    if (error) {
      console.warn('[mediaSignedUrl] createSignedUrls batch', error.message);
      for (const p of chunk) {
        await getSignedUrlForMediaPath(p, MEDIA_DISPLAY_SIGNED_TTL_SEC);
      }
      continue;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows as { path?: string; signedUrl?: string }[]) {
      const path = row.path?.trim();
      const url = row.signedUrl?.trim();
      if (path && url) {
        cacheSignedPath(path, url, MEDIA_DISPLAY_SIGNED_TTL_SEC);
      }
    }
    for (const p of chunk) {
      const c = signedDisplayCache.get(p);
      if (!c || c.expiresAt <= Date.now() + CACHE_SKEW_MS) {
        await getSignedUrlForMediaPath(p, MEDIA_DISPLAY_SIGNED_TTL_SEC);
      }
    }
  }
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

/** Lecture synchrone du cache (évite un flash URL → re-sign en fil si prefetch déjà passé). */
export function peekSignedMediaDisplayUrl(remoteUrlOrPath: string): string | null {
  const trimmed = remoteUrlOrPath.trim();
  if (!trimmed) return null;
  const path = extractMediaBucketPath(trimmed);
  if (!path) return trimmed;
  const cached = signedDisplayCache.get(path);
  if (cached && cached.expiresAt > Date.now() + CACHE_SKEW_MS) return cached.url;
  return null;
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

/**
 * True si `uri` est un chemin Storage nu (`uuid/...`) — **jamais** le passer tel quel à
 * Expo Image : iOS le résout en relatif sous `Petitmo.app/…` → WARN Bundle introuvable.
 */
export function isBareMediaBucketPath(uri: string | null | undefined): boolean {
  const t = (uri ?? '').trim();
  if (!t) return false;
  // Bundle leak = chemin Storage déguisé — à signer, jamais à afficher tel quel.
  if (isAppBundleMediaLeakUri(t) && extractMediaBucketPath(t)) return true;
  if (/^https?:\/\//i.test(t) || t.startsWith('file:') || t.startsWith('content:') || t.startsWith('ph://')) {
    return false;
  }
  return !!extractMediaBucketPath(t);
}

export function useSignedMediaUrl(url: string | null | undefined): string | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  const [out, setOut] = useState<string | null>(() => {
    if (!raw) return null;
    const peeked = peekSignedMediaDisplayUrl(raw);
    if (peeked && !isBareMediaBucketPath(peeked)) return peeked;
    // Attendre la signature — ne pas exposer le chemin nu (résolu → Bundle iOS).
    if (isBareMediaBucketPath(raw)) return null;
    return peeked ?? raw;
  });

  useEffect(() => {
    if (!raw) {
      setOut(null);
      return;
    }
    const cached = peekSignedMediaDisplayUrl(raw);
    if (cached && !isBareMediaBucketPath(cached)) {
      setOut(prev => (prev === cached ? prev : cached));
      return;
    }
    let alive = true;
    if (isBookPortraitPerfEnabled()) {
      bookPortraitPerfNetwork('useSignedMediaUrl:fetch-start', {
        path: extractMediaBucketPath(raw)?.slice(0, 48),
      });
    }
    void (async () => {
      const t0 = Date.now();
      const next = await getSignedMediaDisplayUrl(raw);
      if (isBookPortraitPerfEnabled()) {
        bookPortraitPerfNetwork('useSignedMediaUrl:fetch-done', {
          ms: Date.now() - t0,
          changed: next !== raw,
        });
      }
      if (!alive) return;
      // Signature échouée + chemin bucket → null (évite Bundle WARN).
      if (isBareMediaBucketPath(next)) {
        setOut(prev => (prev == null ? prev : null));
        return;
      }
      setOut(prev => (prev === next ? prev : next || null));
    })();
    return () => {
      alive = false;
    };
  }, [raw]);

  return out;
}

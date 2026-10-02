import { supabaseUrl } from '@/lib/supabase';

/**
 * Probe réseau courte (pas de dépendance NetInfo).
 * Sert l’auth hors-ligne : reprise locale du dernier compte sur l’appareil.
 */
export async function probeNetworkReachable(timeoutMs = 2500): Promise<boolean> {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      await fetch(`${base}/auth/v1/health`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Erreurs typiques d’un login / OAuth sans réseau. */
export function looksLikeNetworkAuthError(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  if (!m) return false;
  return (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('offline') ||
    m.includes('internet') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('failed to connect') ||
    m.includes('network request failed') ||
    m.includes('connexion') ||
    m.includes('réseau')
  );
}

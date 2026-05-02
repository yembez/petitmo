import Constants from 'expo-constants';

function readDebugEgressFlag(): boolean {
  const raw = process.env.EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;

  const extra = (Constants.expoConfig?.extra ?? Constants.manifest?.extra) as Record<string, unknown> | undefined;
  const fromExtra = extra?.EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS;
  if (typeof fromExtra === 'string') {
    const t = fromExtra.trim().toLowerCase();
    if (t === '1' || t === 'true' || t === 'yes') return true;
  }
  return false;
}

function resolveUrlAndMethod(input: RequestInfo | URL, init?: RequestInit): { urlStr: string; method: string } {
  if (typeof input === 'string') {
    return { urlStr: input, method: (init?.method ?? 'GET').toUpperCase() };
  }
  if (input instanceof URL) {
    return { urlStr: input.href, method: (init?.method ?? 'GET').toUpperCase() };
  }
  return {
    urlStr: input.url,
    method: (init?.method ?? input.method ?? 'GET').toUpperCase(),
  };
}

/**
 * En __DEV__, si `EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS=1` : log `[supabase-egress] METHOD /path`
 * pour les requêtes vers le host du projet (pas la query string — évite les jetons des signed URLs).
 */
export function wrapFetchForSupabaseEgressDebug(
  supabaseProjectUrl: string | undefined,
  baseFetch: typeof fetch
): typeof fetch {
  const enabled = typeof __DEV__ !== 'undefined' && __DEV__ && readDebugEgressFlag();
  if (!enabled || !supabaseProjectUrl?.trim()) return baseFetch;

  let host: string;
  try {
    host = new URL(supabaseProjectUrl.trim()).hostname;
  } catch {
    return baseFetch;
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { urlStr, method } = resolveUrlAndMethod(input, init);
    try {
      const u = new URL(urlStr);
      if (u.hostname === host) {
        console.log(`[supabase-egress] ${method} ${u.pathname}`);
      }
    } catch {
      /* URL relative ou invalide : ignoré */
    }
    return baseFetch(input, init);
  }) as typeof fetch;
}

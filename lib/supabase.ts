import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Database } from '@/types/database';
import Constants from 'expo-constants';
import { wrapFetchForSupabaseEgressDebug } from '@/lib/supabaseFetchDebug';

function readPublicEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'): string | undefined {
  const fromProcess = process.env?.[name];
  if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) return fromProcess.trim();

  const extra = (Constants.expoConfig?.extra ?? Constants.manifest?.extra) as Record<string, unknown> | undefined;
  const fromExtra = extra?.[name];
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) return fromExtra.trim();

  return undefined;
}

export const supabaseUrl = readPublicEnv('EXPO_PUBLIC_SUPABASE_URL');
export const supabaseAnonKey = readPublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  // Laisser l’app démarrer en dev, mais rendre l’erreur explicite.
  console.error(
    '[supabase] Variables manquantes. Attendu EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/** Mettre `EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS=1` en dev pour tracer host+path (sans query). */
const fetchForSupabase = wrapFetchForSupabaseEgressDebug(supabaseUrl, globalThis.fetch.bind(globalThis));

export const supabase = createClient<Database>(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  global: { fetch: fetchForSupabase },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

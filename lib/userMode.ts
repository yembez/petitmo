import AsyncStorage from '@react-native-async-storage/async-storage';

/** Même clé que `lib/userTier.ts` (évite import circulaire). */
const USER_TIER_STORAGE_KEY = 'petitmo:userTier';

export type UserMode = 'local' | 'cloud';

/** Contextes où Supabase est explicitement autorisé même en mode gratuit (hors souvenirs / enfants). */
export type SupabaseAllowedContext = 'book_order' | 'push_token';

/**
 * `local` : Petitmo gratuit — souvenirs et profils enfant **uniquement** SQLite + sandbox.
 * `cloud` : Petitmo+ — sync mémoires / enfants vers Supabase comme aujourd’hui.
 *
 * Note : l’app peut avoir une session Supabase (compte « device ») tout en restant en `local`
 * tant que l’abonnement stocké n’est pas `paid`.
 */
export async function getUserMode(): Promise<UserMode> {
  const tierRaw = await AsyncStorage.getItem(USER_TIER_STORAGE_KEY);
  const paid = tierRaw === 'paid';
  return paid ? 'cloud' : 'local';
}

let cachedMode: UserMode | null = null;

export async function getCachedUserMode(): Promise<UserMode> {
  if (cachedMode !== null) {
    return cachedMode;
  }
  cachedMode = await getUserMode();
  return cachedMode;
}

export function invalidateUserModeCache(): void {
  cachedMode = null;
}

/** Réservé aux flux explicites (commande livre, PDF, token push) — ne court-circuite pas `getUserMode`. */
export function isSupabaseAllowed(context: SupabaseAllowedContext): boolean {
  void context;
  return true;
}

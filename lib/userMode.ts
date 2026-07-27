import AsyncStorage from '@react-native-async-storage/async-storage';

/** Même clé que `lib/userTier.ts` (évite import circulaire). */
const USER_TIER_STORAGE_KEY = 'petitmo:userTier';

/**
 * Compte produit authentifié (Google / Apple / email) vs device-user / aucun.
 * Indépendant du tier paid/free — pilote uniquement l’autorisation de sync.
 */
const CLOUD_ACCOUNT_KIND_KEY = 'petitmo:cloudAccountKind';

export type UserMode = 'local' | 'cloud';

export type CloudAccountKind = 'real' | 'none';

/** Contextes où Supabase est explicitement autorisé même en mode local (device-user). */
export type SupabaseAllowedContext = 'book_order' | 'push_token';

/**
 * `local` : pas de sync fil (device-user ou pas de compte produit).
 * `cloud` : sync arrière-plan autorisée — compte produit **gratuit ou Petitmo+**.
 *           L’UI reste local-first (SQLite + sandbox) dans les deux cas.
 * `paid` (AsyncStorage) reste la source pour HD photo / quotas / remise print.
 */
export async function getUserMode(): Promise<UserMode> {
  const tierRaw = await AsyncStorage.getItem(USER_TIER_STORAGE_KEY);
  if (tierRaw === 'paid') return 'cloud';

  const kind = await AsyncStorage.getItem(CLOUD_ACCOUNT_KIND_KEY);
  if (kind === 'real') return 'cloud';

  return 'local';
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

/** Marque un vrai compte produit (active la sync free/paid sans attendre paid). */
export async function setCloudAccountKind(kind: CloudAccountKind): Promise<void> {
  if (kind === 'real') {
    await AsyncStorage.setItem(CLOUD_ACCOUNT_KIND_KEY, 'real');
  } else {
    await AsyncStorage.removeItem(CLOUD_ACCOUNT_KIND_KEY);
  }
  invalidateUserModeCache();
}

export async function getCloudAccountKind(): Promise<CloudAccountKind> {
  const kind = await AsyncStorage.getItem(CLOUD_ACCOUNT_KIND_KEY);
  return kind === 'real' ? 'real' : 'none';
}

/** Réservé aux flux explicites (commande livre, PDF, token push) — ne court-circuite pas `getUserMode`. */
export function isSupabaseAllowed(context: SupabaseAllowedContext): boolean {
  void context;
  return true;
}

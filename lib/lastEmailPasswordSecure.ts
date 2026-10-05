/**
 * Dernier mot de passe e-mail — Keychain iOS (`expo-secure-store`).
 * Low Friction First : préremplir login sans secret en clair (AsyncStorage interdit).
 *
 * Clés : uniquement `[A-Za-z0-9._-]` — les `:` font échouer setItemAsync (no-op silencieux).
 */
const PASSWORD_KEY = 'petitmo.lastAuthPassword';
const PASSWORD_EMAIL_KEY = 'petitmo.lastAuthPasswordEmail';

async function loadSecureStore(): Promise<typeof import('expo-secure-store') | null> {
  try {
    const mod = await import('expo-secure-store');
    if (!(await mod.isAvailableAsync())) return null;
    return mod;
  } catch {
    return null;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function keychainOpts(store: typeof import('expo-secure-store')) {
  return {
    keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

/** Après login / signup e-mail réussi. Conservé à la déconnexion ; purgé à la suppression de compte. */
export async function saveLastEmailPassword(email: string, password: string): Promise<void> {
  const e = normalizeEmail(email);
  const p = password;
  if (!e || !p) return;
  const store = await loadSecureStore();
  if (!store) return;
  try {
    const opts = keychainOpts(store);
    await store.setItemAsync(PASSWORD_EMAIL_KEY, e, opts);
    await store.setItemAsync(PASSWORD_KEY, p, opts);
  } catch (err) {
    console.warn('[lastEmailPasswordSecure] save', err);
  }
}

/** Mot de passe Keychain si l’e-mail correspond au dernier compte mémorisé. */
export async function getLastEmailPasswordFor(email: string): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const store = await loadSecureStore();
  if (!store) return null;
  try {
    const opts = keychainOpts(store);
    const savedEmail = normalizeEmail((await store.getItemAsync(PASSWORD_EMAIL_KEY, opts)) ?? '');
    if (!savedEmail || savedEmail !== e) return null;
    return (await store.getItemAsync(PASSWORD_KEY, opts)) || null;
  } catch (err) {
    console.warn('[lastEmailPasswordSecure] get', err);
    return null;
  }
}

export async function clearLastEmailPassword(): Promise<void> {
  const store = await loadSecureStore();
  if (!store) return;
  try {
    const opts = keychainOpts(store);
    await store.deleteItemAsync(PASSWORD_KEY, opts);
    await store.deleteItemAsync(PASSWORD_EMAIL_KEY, opts);
  } catch (err) {
    console.warn('[lastEmailPasswordSecure] clear', err);
  }
}

/**
 * Dernier mot de passe e-mail — Keychain iOS uniquement (`expo-secure-store`).
 * Low Friction First : préremplir login sans stocker le secret en clair.
 * Absent du binaire TF → no-op (OTA safe jusqu’au prochain build natif).
 */
const PASSWORD_KEY = 'petitmo:lastAuthPassword';
const PASSWORD_EMAIL_KEY = 'petitmo:lastAuthPasswordEmail';

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

/** Après login / signup e-mail réussi. Conservé à la déconnexion ; purgé à la suppression de compte. */
export async function saveLastEmailPassword(email: string, password: string): Promise<void> {
  const e = normalizeEmail(email);
  const p = password;
  if (!e || !p) return;
  const store = await loadSecureStore();
  if (!store) return;
  try {
    const opts = {
      keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
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
    const savedEmail = normalizeEmail((await store.getItemAsync(PASSWORD_EMAIL_KEY)) ?? '');
    if (!savedEmail || savedEmail !== e) return null;
    return (await store.getItemAsync(PASSWORD_KEY)) || null;
  } catch (err) {
    console.warn('[lastEmailPasswordSecure] get', err);
    return null;
  }
}

export async function clearLastEmailPassword(): Promise<void> {
  const store = await loadSecureStore();
  if (!store) return;
  try {
    await store.deleteItemAsync(PASSWORD_KEY);
    await store.deleteItemAsync(PASSWORD_EMAIL_KEY);
  } catch (err) {
    console.warn('[lastEmailPasswordSecure] clear', err);
  }
}

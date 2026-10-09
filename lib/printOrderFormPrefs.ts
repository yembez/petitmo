/**
 * Dernier formulaire commande print — cache local confort (Low Friction).
 * Mémoire synchrone + AsyncStorage : paint formulaire sans attendre le disque.
 * Pas de secret : AsyncStorage OK (comme l’e-mail guest export).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'petitmo_print_order_form_v1';

export type PrintOrderFormPrefs = {
  email: string;
  fullName: string;
  shippingName: string;
  line1: string;
  line2: string;
  city: string;
  zip: string;
  country: string;
};

/** Cache process — peindre le formulaire au 1er frame sans await. */
let memoryCache: PrintOrderFormPrefs | null = null;
let hydrateStarted = false;

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parsePrefs(raw: string | null): PrintOrderFormPrefs | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    const email = trimStr(o.email).toLowerCase();
    const line1 = trimStr(o.line1);
    const city = trimStr(o.city);
    const zip = trimStr(o.zip);
    if (!email && !line1 && !city && !zip && !trimStr(o.shippingName)) return null;
    return {
      email,
      fullName: trimStr(o.fullName),
      shippingName: trimStr(o.shippingName),
      line1,
      line2: trimStr(o.line2),
      city,
      zip,
      country: (trimStr(o.country) || 'FR').toUpperCase().slice(0, 2),
    };
  } catch {
    return null;
  }
}

/** Lecture synchrone (mémoire). Hydrate AsyncStorage en fond au 1er appel. */
export function peekLastPrintOrderForm(): PrintOrderFormPrefs | null {
  if (!hydrateStarted) {
    hydrateStarted = true;
    void getLastPrintOrderForm();
  }
  return memoryCache;
}

export async function getLastPrintOrderForm(): Promise<PrintOrderFormPrefs | null> {
  if (memoryCache) return memoryCache;
  try {
    const parsed = parsePrefs(await AsyncStorage.getItem(KEY));
    if (parsed) memoryCache = parsed;
    return parsed;
  } catch {
    return memoryCache;
  }
}

export async function setLastPrintOrderForm(form: PrintOrderFormPrefs): Promise<void> {
  const next: PrintOrderFormPrefs = {
    email: form.email.trim().toLowerCase(),
    fullName: form.fullName.trim(),
    shippingName: form.shippingName.trim(),
    line1: form.line1.trim(),
    line2: form.line2.trim(),
    city: form.city.trim(),
    zip: form.zip.trim(),
    country: (form.country.trim() || 'FR').toUpperCase().slice(0, 2),
  };
  if (!next.email && !next.line1 && !next.city && !next.zip && !next.shippingName) return;
  memoryCache = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Warm au chargement du module (navigation livre → commande). */
void getLastPrintOrderForm();

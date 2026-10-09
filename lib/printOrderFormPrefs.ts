/**
 * Dernier formulaire commande print — cache local confort (Low Friction).
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
    // Au moins une donnée utile (sinon inutile de peindre).
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

export async function getLastPrintOrderForm(): Promise<PrintOrderFormPrefs | null> {
  try {
    return parsePrefs(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
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
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

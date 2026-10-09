/**
 * Adresse de livraison Petitmo (`export_requests.shipping_address_json`).
 * Partagé par `init-export` (brouillon au ticket) et `print-payment` (adresse **finale**
 * figée au tap Commander, juste avant le Checkout).
 */
export type ParsedShippingAddress =
  | { ok: true; value: Record<string, string> }
  | { ok: false; message: string };

export function parseShippingAddress(raw: unknown): ParsedShippingAddress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'shipping_address_json must be an object' };
  }
  const o = raw as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1.trim() : '';
  const city = typeof o.city === 'string' ? o.city.trim() : '';
  const zip = typeof o.zip === 'string' ? o.zip.trim() : '';
  const country = typeof o.country === 'string' ? o.country.trim() : '';
  if (!line1 || !city || !zip || !country) {
    return { ok: false, message: 'shipping_address_json requires line1, city, zip, country' };
  }
  const line2 = typeof o.line2 === 'string' ? o.line2.trim() : '';
  const value: Record<string, string> = { line1, city, zip, country };
  if (line2) value.line2 = line2;
  return { ok: true, value };
}

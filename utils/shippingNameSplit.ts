/** Découpe un nom complet legacy → prénom / nom (Gelato firstName / lastName). */
export function splitShippingName(fullName: string): { firstName: string; lastName: string } {
  const t = fullName.trim();
  if (!t) return { firstName: '', lastName: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

/** Compose le libellé colis / CRM depuis prénom + nom. */
export function composeShippingName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
}

/** Limites Gelato ShippingAddress (create order v4). */
export const GELATO_NAME_MAX_LEN = 25;

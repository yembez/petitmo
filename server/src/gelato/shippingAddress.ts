export type PetitmoShippingAddressJson = {
  line1?: string;
  line2?: string;
  city?: string;
  zip?: string;
  country?: string;
};

export function parsePetitmoShippingAddress(raw: unknown): PetitmoShippingAddressJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1.trim() : '';
  const city = typeof o.city === 'string' ? o.city.trim() : '';
  const zip = typeof o.zip === 'string' ? o.zip.trim() : '';
  const country = typeof o.country === 'string' ? o.country.trim().toUpperCase() : '';
  if (!line1 || !city || !zip || !country) return null;
  const line2 = typeof o.line2 === 'string' ? o.line2.trim() : '';
  return { line1, ...(line2 ? { line2 } : {}), city, zip, country };
}

export function splitShippingName(fullName: string): { firstName: string; lastName: string } {
  const t = fullName.trim();
  if (!t) return { firstName: 'Client', lastName: 'Petit Cœur' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '-' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

export function gelatoShippingAddress(params: {
  shippingName: string;
  address: PetitmoShippingAddressJson;
  email: string;
  phone: string;
}): Record<string, string> {
  const { firstName, lastName } = splitShippingName(params.shippingName);
  const out: Record<string, string> = {
    firstName,
    lastName,
    addressLine1: params.address.line1!,
    city: params.address.city!,
    postCode: params.address.zip!,
    country: params.address.country!,
    email: params.email.trim().toLowerCase(),
    phone: params.phone,
  };
  if (params.address.line2?.trim()) {
    out.addressLine2 = params.address.line2.trim();
  }
  return out;
}

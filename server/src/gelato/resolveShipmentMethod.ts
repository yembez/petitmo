import { formatGelatoApiError } from './apiError';
import type { GelatoConfig } from './config';
import type { PetitmoShippingAddressJson } from './shippingAddress';

const GELATO_QUOTE_API = 'https://order.gelatoapis.com/v4/orders:quote';

type QuoteShipmentMethod = {
  shipmentMethodUid: string;
  name?: string;
  price?: number;
  currency?: string;
  type?: string;
};

/**
 * `standard` / `normal` / `express` sont des alias Gelato — s’ils ne matchent
 * aucun transporteur réel, Gelato tombe en `api_fallback_delivery` à 0 €.
 * On quote puis on choisit un UID concret (le moins cher du type demandé).
 */
export async function resolveGelatoShipmentMethodUid(params: {
  config: GelatoConfig;
  address: PetitmoShippingAddressJson;
  email: string;
  shippingName: string;
  pageCount: number;
  orderReferenceId: string;
}): Promise<{ shipmentMethodUid: string; price: number | null; name: string | null }> {
  const preferred = params.config.shipmentMethodUid.trim() || 'standard';
  const preferredLower = preferred.toLowerCase();
  const typeAlias =
    preferredLower === 'standard' || preferredLower === 'normal' || preferredLower === 'express'
      ? preferredLower === 'standard'
        ? 'normal'
        : preferredLower
      : null;

  const nameParts = params.shippingName.trim().split(/\s+/);
  const firstName = nameParts[0] || 'Client';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '-';

  const body = {
    orderReferenceId: `quote-${params.orderReferenceId}`.slice(0, 64),
    customerReferenceId: 'petitmo-quote',
    currency: params.config.currency,
    allowMultipleQuotes: true,
    recipient: {
      country: params.address.country,
      firstName,
      lastName,
      addressLine1: params.address.line1,
      ...(params.address.line2 ? { addressLine2: params.address.line2 } : {}),
      city: params.address.city,
      postCode: params.address.zip,
      email: params.email.trim().toLowerCase(),
      phone: params.config.defaultPhone,
    },
    products: [
      {
        itemReferenceId: 'book',
        productUid: params.config.productUid,
        quantity: 1,
        pageCount: params.pageCount,
      },
    ],
  };

  const res = await fetch(GELATO_QUOTE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': params.config.apiKey,
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = { raw: rawText.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(formatGelatoApiError(res.status, json, rawText));
  }

  const methods: QuoteShipmentMethod[] = [];
  const quotes = Array.isArray(json.quotes) ? json.quotes : [];
  for (const q of quotes) {
    if (!q || typeof q !== 'object') continue;
    const list = (q as { shipmentMethods?: unknown }).shipmentMethods;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const uid = typeof (m as { shipmentMethodUid?: unknown }).shipmentMethodUid === 'string'
        ? (m as { shipmentMethodUid: string }).shipmentMethodUid.trim()
        : '';
      if (!uid || uid === 'api_fallback_delivery') continue;
      const priceRaw = (m as { price?: unknown }).price;
      const price = typeof priceRaw === 'number' && Number.isFinite(priceRaw) ? priceRaw : null;
      methods.push({
        shipmentMethodUid: uid,
        name: typeof (m as { name?: unknown }).name === 'string' ? (m as { name: string }).name : undefined,
        price: price ?? undefined,
        currency: typeof (m as { currency?: unknown }).currency === 'string'
          ? (m as { currency: string }).currency
          : undefined,
        type: typeof (m as { type?: unknown }).type === 'string'
          ? (m as { type: string }).type
          : undefined,
      });
    }
  }

  if (methods.length === 0) {
    // Pas de quote utilisable → laisser Gelato choisir (évite bloquer la commande).
    console.warn('[gelato] quote returned no shipment methods — using preferred', preferred);
    return { shipmentMethodUid: preferred, price: null, name: null };
  }

  // UID exact configuré (ex. dhl_warenpost_international).
  const exact = methods.find(m => m.shipmentMethodUid === preferred);
  if (exact) {
    return {
      shipmentMethodUid: exact.shipmentMethodUid,
      price: exact.price ?? null,
      name: exact.name ?? null,
    };
  }

  const pool = typeAlias
    ? methods.filter(m => (m.type ?? '').toLowerCase() === typeAlias)
    : methods;
  const ranked = (pool.length > 0 ? pool : methods).slice().sort((a, b) => {
    const pa = typeof a.price === 'number' ? a.price : Number.POSITIVE_INFINITY;
    const pb = typeof b.price === 'number' ? b.price : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
  const pick = ranked[0]!;
  console.log(
    '[gelato] shipment resolved',
    `preferred=${preferred}`,
    `→ ${pick.shipmentMethodUid}`,
    pick.price != null ? `${pick.price} ${pick.currency ?? ''}`.trim() : 'no-price',
    pick.name ?? '',
  );
  return {
    shipmentMethodUid: pick.shipmentMethodUid,
    price: pick.price ?? null,
    name: pick.name ?? null,
  };
}

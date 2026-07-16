import type { GelatoConfig } from './config';

export type GelatoCoverRect = {
  widthMm: number;
  heightMm: number;
  leftMm: number;
  topMm: number;
};

export type GelatoCoverLayout = {
  productUid: string;
  pageCount: number;
  spreadWidthMm: number;
  spreadHeightMm: number;
  contentFront: GelatoCoverRect;
  contentBack: GelatoCoverRect;
  spine: GelatoCoverRect;
};

type DimensionAttributes = {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

function parseRect(raw: unknown): GelatoCoverRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as DimensionAttributes;
  const widthMm = typeof o.width === 'number' ? o.width : NaN;
  const heightMm = typeof o.height === 'number' ? o.height : NaN;
  const leftMm = typeof o.left === 'number' ? o.left : 0;
  const topMm = typeof o.top === 'number' ? o.top : 0;
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return null;
  }
  return { widthMm, heightMm, leftMm, topMm };
}

const GELATO_PRODUCT_API = 'https://product.gelatoapis.com/v3/products';

export async function fetchGelatoCoverLayout(
  config: GelatoConfig,
  pageCount: number,
): Promise<GelatoCoverLayout> {
  const count = Math.max(1, Math.round(pageCount));
  const url = `${GELATO_PRODUCT_API}/${encodeURIComponent(config.productUid)}/cover-dimensions?pageCount=${count}`;
  const res = await fetch(url, {
    headers: { 'X-API-KEY': config.apiKey },
  });
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const msg =
      typeof json.message === 'string'
        ? json.message
        : rawText.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Gelato cover-dimensions ${res.status}: ${msg}`);
  }

  const spread = parseRect(json.wraparoundInsideSize);
  const contentFront = parseRect(json.contentFrontSize);
  const contentBack = parseRect(json.contentBackSize);
  const spine = parseRect(json.spineSize);
  if (!spread || !contentFront || !contentBack || !spine) {
    throw new Error('Gelato cover-dimensions: réponse incomplète (wraparound / panels manquants)');
  }

  return {
    productUid:
      typeof json.productUid === 'string' ? json.productUid : config.productUid,
    pageCount: count,
    spreadWidthMm: spread.widthMm,
    spreadHeightMm: spread.heightMm,
    contentFront,
    contentBack,
    spine,
  };
}

/**
 * Petitmo = livre photo portrait **210×280 mm (21×28)**, pas le carré 20×20 / 8×8.
 * Si `GELATO_PRODUCT_UID` pointe vers un autre SKU, Gelato imprime le mauvais format
 * alors que l’app / le PDF sont dimensionnés en 21×28.
 */
export function assertGelatoCoverLayoutMatchesPetitmo(layout: GelatoCoverLayout): void {
  const { widthMm: w, heightMm: h } = layout.contentFront;
  const ratio = h / w;
  const isSquare = Math.abs(ratio - 1) < 0.12;
  const looksLike20x20 = w >= 185 && w <= 215 && h >= 185 && h <= 215;
  const portraitOk = ratio >= 1.2 && w >= 195 && w <= 230 && h >= 255 && h <= 310;

  if (isSquare || looksLike20x20 || !portraitOk) {
    throw new Error(
      `GELATO_PRODUCT_UID incorrect pour Petitmo : panneau avant ${w.toFixed(0)}×${h.toFixed(0)} mm ` +
        `(productUid=${layout.productUid}). Attendu : livre photo portrait ~210×280 mm (21×28), ` +
        `pas Hard Cover 20×20 / 8×8. Corrige la variable Railway GELATO_PRODUCT_UID.`,
    );
  }
}

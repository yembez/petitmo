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

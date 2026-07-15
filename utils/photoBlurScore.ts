/**
 * Détection de flou pour le contrôle qualité impression livre.
 * Analyse l’image **telle qu’affichée / imprimée** (pas l’original bruyant),
 * avec léger lissage anti-bruit — sinon un RAW soft + bruit score « Netteté OK ».
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

/** Largeur d’analyse. */
const ANALYSIS_MAX_WIDTH = 640;

/**
 * Seuils (score composite après lissage, ~640 px).
 * Photo manège soft PDF ≈ 50–80 → floue ; net print ≈ ≥ 150.
 */
const BLUR_SCORE_SOFT = 150;
const BLUR_SCORE_BLURRY = 90;

const SCORE_CACHE_VERSION = 'v3-denoise-640';

export type PhotoBlurStatus = 'sharp' | 'soft' | 'blurry' | 'unknown';

const scoreCache = new Map<string, number | null>();

export function photoBlurStatus(score: number | null | undefined): PhotoBlurStatus {
  if (score == null || !Number.isFinite(score) || score <= 0) return 'unknown';
  if (score < BLUR_SCORE_BLURRY) return 'blurry';
  if (score < BLUR_SCORE_SOFT) return 'soft';
  return 'sharp';
}

/** Applique le zoom éditeur : zoomer dans une zone soft fait chuter la netteté utile. */
export function effectiveBlurScoreForCropScale(
  score: number | null | undefined,
  scale: number,
): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  const s = Math.max(1, scale);
  return score / (s * s);
}

export function photoBlurStatusLabel(status: PhotoBlurStatus): string {
  switch (status) {
    case 'sharp':
      return 'Netteté OK';
    case 'soft':
      return 'Netteté faible';
    case 'blurry':
      return 'Photo floue';
    default:
      return 'Netteté —';
  }
}

function toGray(pixels: Uint8Array | Float32Array, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * pixels[p]! + 0.587 * pixels[p + 1]! + 0.114 * pixels[p + 2]!;
  }
  return gray;
}

/** Lissage 3×3 pour ne pas confondre bruit capteur / JPEG avec de la netteté. */
function boxBlur3(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx]!;
          n += 1;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

function varianceOf(values: Float32Array, len: number): number {
  if (len < 16) return 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i]!;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / len;
  return Math.max(0, sumSq / len - mean * mean);
}

function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  const out = new Float32Array(Math.max(0, (w - 2) * (h - 2)));
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[k++] =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
    }
  }
  return varianceOf(out, k);
}

function highFreqResidualVariance(gray: Float32Array, w: number, h: number): number {
  const hw = Math.max(2, Math.floor(w / 2));
  const hh = Math.max(2, Math.floor(h / 2));
  const small = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const x0 = Math.min(w - 1, x * 2);
      const y0 = Math.min(h - 1, y * 2);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      small[y * hw + x] =
        (gray[y0 * w + x0]! + gray[y0 * w + x1]! + gray[y1 * w + x0]! + gray[y1 * w + x1]!) / 4;
    }
  }
  const resid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(hw - 1, (x * hw) / w);
      const sy = Math.min(hh - 1, (y * hh) / h);
      const sx0 = Math.floor(sx);
      const sy0 = Math.floor(sy);
      const fx = sx - sx0;
      const fy = sy - sy0;
      const sx1 = Math.min(hw - 1, sx0 + 1);
      const sy1 = Math.min(hh - 1, sy0 + 1);
      const v00 = small[sy0 * hw + sx0]!;
      const v10 = small[sy0 * hw + sx1]!;
      const v01 = small[sy1 * hw + sx0]!;
      const v11 = small[sy1 * hw + sx1]!;
      const up =
        v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
      resid[y * w + x] = gray[y * w + x]! - up;
    }
  }
  return varianceOf(resid, resid.length);
}

function compositeSharpnessScore(pixels: Uint8Array | Float32Array, w: number, h: number): number {
  const gray = boxBlur3(toGray(pixels, w, h), w, h);
  const lap = laplacianVariance(gray, w, h);
  const hf = highFreqResidualVariance(gray, w, h);
  return lap + hf * 3;
}

/**
 * Score de netteté (plus haut = plus net). `null` si impossible à calculer.
 */
export async function estimatePhotoBlurScore(uri: string): Promise<number | null> {
  const trimmed = uri.trim();
  if (!trimmed) return null;
  const key = `${SCORE_CACHE_VERSION}:${trimmed}`;
  if (scoreCache.has(key)) return scoreCache.get(key) ?? null;

  try {
    const resized = await ImageManipulator.manipulateAsync(
      trimmed,
      [{ resize: { width: ANALYSIS_MAX_WIDTH } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    const b64 = await readAsStringAsync(resized.uri, { encoding: EncodingType.Base64 });
    const data = Skia.Data.fromBase64(b64);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) {
      scoreCache.set(key, null);
      return null;
    }

    const w = image.width();
    const h = image.height();
    if (w < 8 || h < 8) {
      scoreCache.set(key, null);
      return null;
    }

    const pixels = image.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!pixels) {
      scoreCache.set(key, null);
      return null;
    }

    const score = compositeSharpnessScore(pixels as Uint8Array, w, h);
    scoreCache.set(key, score);
    return score;
  } catch (e) {
    console.warn('[photoBlurScore] failed', trimmed.slice(0, 80), e);
    scoreCache.set(key, null);
    return null;
  }
}

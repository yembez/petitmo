/**
 * Copie de `server/src/pdf/maquetteAlign.ts` (onde uniquement) — l’app n’inclut pas `server/` au tsconfig.
 * Garder aligné avec `audioWaveformSvg` côté serveur pour un rendu identique.
 */

const BAR_W = 3;
const BAR_GAP = 2.5;
const BAR_COUNT = 24;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function audioBarHeightsFromMemoryId(id: string): number[] {
  const rand = mulberry32(hashSeed(id));
  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    heights.push(4 + Math.floor(rand() * 17));
  }
  return heights;
}

export function audioWaveformSvg(memoryId: string, viewBoxH = 24): string {
  const heights = audioBarHeightsFromMemoryId(memoryId);
  const waveW = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  const rects: string[] = [];
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    const x = i * (BAR_W + BAR_GAP);
    const y = (viewBoxH - h) / 2;
    const fill = i < BAR_COUNT * 0.4 ? '#5C8FA6' : 'rgba(0,0,0,0.12)';
    rects.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${BAR_W}" height="${h}" rx="1" fill="${fill}"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="audio-wave-svg" viewBox="0 0 ${waveW} ${viewBoxH}" preserveAspectRatio="xMidYMid meet">${rects.join('')}</svg>`;
}

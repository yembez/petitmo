/** Nombre de pics persistés / affichés (lecture fil, immersif, éditeur). */
export const VOICE_WAVE_PEAKS_COUNT = 64;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.06;
  return Math.min(1, Math.max(0.06, n));
}

/** Réduit un historique metering (50 ms) en N pics (max par bucket). */
export function downsampleMeterHistory(samples: number[], targetCount = VOICE_WAVE_PEAKS_COUNT): number[] {
  if (!samples.length) return [];
  if (samples.length <= targetCount) {
    return samples.map(clamp01);
  }
  const out: number[] = [];
  const bucket = samples.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const a = Math.floor(i * bucket);
    const b = Math.max(a + 1, Math.floor((i + 1) * bucket));
    let peak = 0;
    for (let j = a; j < b; j++) {
      const v = samples[j] ?? 0;
      if (v > peak) peak = v;
    }
    out.push(clamp01(peak));
  }
  return out;
}

/** Découpe les pics sur un extrait [startSec, endSec], puis re-échantillonne. */
export function sliceWavePeaks(
  peaks: number[],
  startSec: number,
  endSec: number,
  totalSec: number,
  targetCount = VOICE_WAVE_PEAKS_COUNT,
): number[] {
  if (!peaks.length || !(totalSec > 0)) return peaks.slice();
  const start = Math.max(0, Math.min(1, startSec / totalSec));
  const end = Math.max(start + 1e-6, Math.min(1, endSec / totalSec));
  const i0 = Math.floor(start * peaks.length);
  const i1 = Math.max(i0 + 1, Math.ceil(end * peaks.length));
  return downsampleMeterHistory(peaks.slice(i0, i1), targetCount);
}

/** Ré-échantillonne pour l’UI (nombre de needles fil / immersif). */
export function resampleWavePeaks(peaks: number[], targetCount: number): number[] {
  return downsampleMeterHistory(peaks, targetCount);
}

/**
 * Étire l’affichage pour que la crête la plus haute atteigne presque
 * toute la hauteur du range — sans changer les pics persistés.
 */
export function fitWavePeaksToDisplayRange(peaks: number[], targetMax = 0.96): number[] {
  if (peaks.length === 0) return peaks;
  let hi = 0;
  for (const a of peaks) {
    if (a > hi) hi = a;
  }
  if (hi < 0.05 || hi >= targetMax) return peaks;
  const k = targetMax / hi;
  return peaks.map(a => clamp01(a * k));
}

export function parseVoiceWavePeaks(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const nums = raw
      .map(v => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN))
      .filter(n => Number.isFinite(n))
      .map(clamp01);
    return nums.length >= 8 ? nums : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseVoiceWavePeaks(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  return null;
}

export function serializeVoiceWavePeaks(peaks: number[] | null | undefined): string | null {
  const parsed = parseVoiceWavePeaks(peaks ?? null);
  if (!parsed) return null;
  return JSON.stringify(parsed.map(n => Math.round(n * 1000) / 1000));
}

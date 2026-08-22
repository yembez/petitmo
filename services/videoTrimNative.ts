import { mediaDurationToSeconds } from '@/utils/mediaDuration';

export type VideoTrimClipResult = {
  uri: string;
  /** Durée de l’extrait en secondes. */
  durationSec: number;
};

export class VideoTrimNativeMissingError extends Error {
  constructor() {
    super('VIDEO_TRIM_NATIVE_MISSING');
    this.name = 'VideoTrimNativeMissingError';
  }
}

export function ensureVideoFileUri(path: string): string {
  const t = path.trim();
  if (!t) return t;
  if (t.startsWith('file://') || t.startsWith('content:') || t.startsWith('ph://')) return t;
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

type VideoTrimModule = {
  trim?: (
    url: string,
    options: {
      startTime: number;
      endTime: number;
      outputExt?: string;
      enablePreciseTrimming?: boolean;
    },
  ) => Promise<{ outputPath?: string; duration?: number; startTime?: number; endTime?: number }>;
  getFrameAt?: (
    url: string,
    options: {
      time: number;
      format?: string;
      quality?: number;
      maxWidth?: number;
    },
  ) => Promise<{ outputPath?: string }>;
};

function loadVideoTrimModule(): VideoTrimModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-video-trim') as VideoTrimModule & { default?: VideoTrimModule };
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export function isVideoTrimNativeAvailable(): boolean {
  const mod = loadVideoTrimModule();
  return typeof mod?.trim === 'function';
}

/**
 * Coupe un extrait vidéo sans UI (FFmpeg natif via react-native-video-trim).
 */
export async function trimVideoClipToLocalFile(params: {
  inputUri: string;
  startSec: number;
  endSec: number;
}): Promise<VideoTrimClipResult> {
  const mod = loadVideoTrimModule();
  if (typeof mod?.trim !== 'function') {
    throw new VideoTrimNativeMissingError();
  }

  const startMs = Math.max(0, Math.round(params.startSec * 1000));
  const endMs = Math.max(startMs + 1000, Math.round(params.endSec * 1000));
  const input = ensureVideoFileUri(params.inputUri);
  if (!input) throw new Error('VIDEO_TRIM_EMPTY_INPUT');

  const result = await mod.trim(input, {
    startTime: startMs,
    endTime: endMs,
    outputExt: 'mp4',
    enablePreciseTrimming: true,
  });

  const out = ensureVideoFileUri((result.outputPath ?? '').trim());
  if (!out) throw new Error('VIDEO_TRIM_EMPTY_OUTPUT');

  const rangeMs =
    typeof result.startTime === 'number' &&
    typeof result.endTime === 'number' &&
    result.endTime > result.startTime
      ? result.endTime - result.startTime
      : endMs - startMs;

  let durationSec = mediaDurationToSeconds(rangeMs);
  if (durationSec <= 0 && typeof result.duration === 'number' && result.duration > 0) {
    durationSec = mediaDurationToSeconds(result.duration);
  }
  if (durationSec <= 0) {
    durationSec = Math.max(1, Math.round(params.endSec - params.startSec));
  }

  return { uri: out, durationSec };
}

const FILMSTRIP_COUNT = 10;

/**
 * Extrait des vignettes pour la piste de coupe (cache natif).
 * Retourne un tableau de même longueur que `count` (chaîne vide si échec).
 */
export async function loadVideoTrimFilmstripUris(
  inputUri: string,
  durationSec: number,
  count = FILMSTRIP_COUNT,
): Promise<string[]> {
  const mod = loadVideoTrimModule();
  if (typeof mod?.getFrameAt !== 'function' || durationSec <= 0 || count <= 0) {
    return Array.from({ length: count }, () => '');
  }

  const input = ensureVideoFileUri(inputUri);
  const slots = Array.from({ length: count }, () => '');

  await Promise.all(
    slots.map(async (_, i) => {
      const timeMs = Math.round(((i + 0.5) / count) * durationSec * 1000);
      try {
        const frame = await mod.getFrameAt!(input, {
          time: timeMs,
          format: 'jpeg',
          quality: 55,
          maxWidth: 160,
        });
        slots[i] = ensureVideoFileUri((frame.outputPath ?? '').trim());
      } catch {
        slots[i] = '';
      }
    }),
  );

  return slots;
}

import { cacheDirectory, copyAsync, getInfoAsync } from 'expo-file-system/legacy';
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

type TrimFn = (
  url: string,
  options: {
    startTime: number;
    endTime: number;
    outputExt?: string;
    enablePreciseTrimming?: boolean;
  },
) => Promise<{ outputPath?: string; duration?: number; startTime?: number; endTime?: number }>;

type GetFrameAtFn = (
  url: string,
  options: {
    time: number;
    format?: string;
    quality?: number;
    maxWidth?: number;
  },
) => Promise<{ outputPath?: string }>;

type VideoTrimModule = {
  trim?: TrimFn;
  getFrameAt?: GetFrameAtFn;
};

/**
 * Toujours les **fonctions nommées** du package, jamais le TurboModule brut.
 * Le wrapper JS remplit `saveToPhoto` / `type` / `speed`… — sinon l’export plante.
 */
function loadVideoTrimModule(): VideoTrimModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-video-trim') as VideoTrimModule & {
      default?: VideoTrimModule;
    };
    const trim = typeof mod?.trim === 'function' ? mod.trim : mod?.default?.trim;
    const getFrameAt =
      typeof mod?.getFrameAt === 'function' ? mod.getFrameAt : mod?.default?.getFrameAt;
    if (typeof trim !== 'function') return null;
    return { trim, getFrameAt };
  } catch {
    return null;
  }
}

export function isVideoTrimNativeAvailable(): boolean {
  const mod = loadVideoTrimModule();
  return typeof mod?.trim === 'function';
}

/**
 * FFmpeg iOS veut un vrai fichier local. `ph://` / chemins morts → copie cache.
 */
async function materializeLocalFileForTrim(rawUri: string): Promise<string> {
  const input = ensureVideoFileUri(rawUri);
  if (!input) throw new Error('VIDEO_TRIM_EMPTY_INPUT');

  const probe = async (uri: string): Promise<boolean> => {
    try {
      const info = await getInfoAsync(uri);
      return !!(info.exists && !info.isDirectory);
    } catch {
      return false;
    }
  };

  if (
    input.startsWith('file:') ||
    (input.startsWith('/') && !input.startsWith('ph://'))
  ) {
    const asFile = input.startsWith('file:') ? input : `file://${input}`;
    if (await probe(asFile)) return asFile;
  }

  if (!cacheDirectory) {
    if (await probe(input)) return input;
    throw new Error('VIDEO_TRIM_INPUT_UNREADABLE');
  }

  const dest = `${cacheDirectory}petitmo_trim_src_${Date.now()}.mp4`;
  try {
    await copyAsync({ from: input, to: dest });
  } catch (e) {
    console.warn('[videoTrimNative] copy for trim failed', e);
    throw new Error('VIDEO_TRIM_INPUT_UNREADABLE');
  }
  if (!(await probe(dest))) throw new Error('VIDEO_TRIM_INPUT_UNREADABLE');
  return dest.startsWith('file:') ? dest : `file://${dest}`;
}

function clipResultFromNative(
  result: { outputPath?: string; duration?: number; startTime?: number; endTime?: number },
  startMs: number,
  endMs: number,
  startSec: number,
  endSec: number,
): VideoTrimClipResult {
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
    durationSec = Math.max(1, Math.round(endSec - startSec));
  }
  return { uri: out, durationSec };
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
  const input = await materializeLocalFileForTrim(params.inputUri);

  const run = (precise: boolean) =>
    mod.trim!(input, {
      startTime: startMs,
      endTime: endMs,
      outputExt: 'mp4',
      enablePreciseTrimming: precise,
    });

  // Stream-copy d’abord (léger) ; si le codec refuse, ré-encode une fois.
  try {
    const result = await run(false);
    return clipResultFromNative(result, startMs, endMs, params.startSec, params.endSec);
  } catch (e1) {
    console.warn('[videoTrimNative] stream-copy failed, retry precise', e1);
    try {
      const result = await run(true);
      return clipResultFromNative(result, startMs, endMs, params.startSec, params.endSec);
    } catch (e2) {
      console.warn('[videoTrimNative] precise trim failed', e2);
      throw e2 instanceof Error ? e2 : new Error('VIDEO_TRIM_FAILED');
    }
  }
}

/** Nombre de vignettes de la piste de coupe (aligné sur `FILMSTRIP_SLOTS` de l’éditeur). */
export const VIDEO_TRIM_FILMSTRIP_COUNT = 10;

/**
 * Vignettes de la piste de coupe.
 *
 * Extraction **séquentielle** et basse résolution : en parallèle, dix décodages FFmpeg
 * s’ajoutaient au lecteur expo-av et faisaient tuer l’app pour dépassement mémoire.
 * `onFrame` permet de peindre chaque vignette dès qu’elle est prête plutôt que d’attendre.
 */
export async function loadVideoTrimFilmstripUris(
  inputUri: string,
  durationSec: number,
  opts?: {
    count?: number;
    onFrame?: (index: number, uri: string) => void;
    /** Interrompt l’extraction dès que la modale se ferme. */
    shouldContinue?: () => boolean;
  },
): Promise<string[]> {
  const count = Math.max(0, opts?.count ?? VIDEO_TRIM_FILMSTRIP_COUNT);
  const slots = Array.from({ length: count }, () => '');

  const mod = loadVideoTrimModule();
  if (typeof mod?.getFrameAt !== 'function' || durationSec <= 0 || count === 0) {
    return slots;
  }

  const input = ensureVideoFileUri(inputUri);
  if (!input) return slots;

  for (let i = 0; i < count; i += 1) {
    if (opts?.shouldContinue && !opts.shouldContinue()) break;
    const timeMs = Math.round(((i + 0.5) / count) * durationSec * 1000);
    try {
      const frame = await mod.getFrameAt(input, {
        time: timeMs,
        format: 'jpeg',
        quality: 55,
        maxWidth: 160,
      });
      slots[i] = ensureVideoFileUri((frame.outputPath ?? '').trim());
    } catch {
      slots[i] = '';
    }
    if (slots[i]) opts?.onFrame?.(i, slots[i]);
  }

  return slots;
}

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

/**
 * Toujours les **fonctions nommées** du package, jamais son `default`.
 * `default` est la spec TurboModule brute : elle attend un objet d’options complet
 * (`saveToPhoto`, `type`, `speed`, `removeAudio`…) que seuls les wrappers JS remplissent.
 * Appeler le natif avec des champs manquants fait planter l’app à l’export.
 */
function loadVideoTrimModule(): VideoTrimModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-video-trim') as VideoTrimModule;
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

  // Precise = ré-encode FFmpeg (RAM élevée → WatchdogTermination sur iPhone).
  // Stream-copy (false) : coupe aux keyframes, bien plus léger pour la sauvegarde fil.
  const result = await mod.trim(input, {
    startTime: startMs,
    endTime: endMs,
    outputExt: 'mp4',
    enablePreciseTrimming: false,
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

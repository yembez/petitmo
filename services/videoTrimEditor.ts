import { NativeEventEmitter, NativeModules } from 'react-native';
import { FREE_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';
import { mediaDurationToSeconds } from '@/utils/mediaDuration';

export type VideoTrimEditorResult = {
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

function ensureFileUri(path: string): string {
  const t = path.trim();
  if (!t) return t;
  if (t.startsWith('file://') || t.startsWith('content:') || t.startsWith('ph://')) return t;
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

type TrimSub = { remove: () => void };

/**
 * Ouvre l’éditeur de coupe **sur la vidéo déjà sélectionnée** (pas de 2ᵉ galerie).
 * Nécessite un build natif avec `react-native-video-trim` (dev client / TestFlight).
 */
export function openVideoTrimEditorOnUri(
  sourceUri: string,
  opts?: { maxDurationSec?: number },
): Promise<VideoTrimEditorResult | null> {
  const maxSec = opts?.maxDurationSec ?? FREE_TIER_VIDEO_MAX_DURATION;
  const maxMs = Math.max(1000, Math.round(maxSec * 1000));
  const input = ensureFileUri(sourceUri);
  if (!input) return Promise.resolve(null);

  let VideoTrimMod: any;
  let showEditor: (path: string, config: Record<string, unknown>) => void;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-video-trim') as typeof import('react-native-video-trim');
    VideoTrimMod = mod.default ?? mod;
    showEditor = mod.showEditor;
    if (typeof showEditor !== 'function') {
      return Promise.reject(new VideoTrimNativeMissingError());
    }
  } catch {
    return Promise.reject(new VideoTrimNativeMissingError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const subs: TrimSub[] = [];

    const cleanup = () => {
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      }
    };

    const finish = (value: VideoTrimEditorResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onFinish = (payload: {
      outputPath?: string;
      startTime?: number;
      endTime?: number;
      duration?: number;
    }) => {
      const out = ensureFileUri((payload.outputPath ?? '').trim());
      if (!out) {
        finish(null);
        return;
      }
      let durationSec = 0;
      const rangeMs =
        typeof payload.startTime === 'number' &&
        typeof payload.endTime === 'number' &&
        payload.endTime > payload.startTime
          ? payload.endTime - payload.startTime
          : 0;
      /** Préférer la fenêtre sélectionnée : `duration` peut renvoyer la longueur source complète. */
      if (rangeMs > 0) {
        durationSec = mediaDurationToSeconds(rangeMs);
      } else if (typeof payload.duration === 'number' && payload.duration > 0) {
        durationSec = mediaDurationToSeconds(payload.duration);
      }
      finish({ uri: out, durationSec });
    };

    const onCancel = () => finish(null);

    try {
      if (typeof VideoTrimMod.onFinishTrimming === 'function') {
        const add = (emitter: unknown, cb: (...args: any[]) => void) => {
          if (typeof emitter !== 'function') return;
          const sub = (emitter as (c: typeof cb) => TrimSub)(cb);
          if (sub?.remove) subs.push(sub);
        };
        add(VideoTrimMod.onFinishTrimming, onFinish);
        add(VideoTrimMod.onCancel, onCancel);
        add(VideoTrimMod.onCancelTrimming, onCancel);
        add(VideoTrimMod.onError, (e: { message?: string }) => {
          console.warn('[videoTrim]', e?.message);
          finish(null);
        });
      } else {
        const native = NativeModules.VideoTrim ?? NativeModules.RNVideoTrim;
        if (!native) {
          reject(new VideoTrimNativeMissingError());
          return;
        }
        const emitter = new NativeEventEmitter(native);
        subs.push(
          emitter.addListener('VideoTrim', (event: {
            name?: string;
            outputPath?: string;
            duration?: number;
            startTime?: number;
            endTime?: number;
            message?: string;
          }) => {
            if (event?.name === 'onFinishTrimming') onFinish(event);
            else if (event?.name === 'onCancel' || event?.name === 'onCancelTrimming') onCancel();
            else if (event?.name === 'onError') {
              console.warn('[videoTrim]', event.message);
              finish(null);
            }
          }),
        );
      }
    } catch (e) {
      cleanup();
      reject(e instanceof VideoTrimNativeMissingError ? e : new VideoTrimNativeMissingError());
      return;
    }

    try {
      showEditor(input, {
        maxDuration: maxMs,
        minDuration: 1000,
        saveToPhoto: false,
        openShareSheetOnFinish: false,
        openDocumentsOnFinish: false,
        enablePreciseTrimming: false,
        enableEditTools: false,
        enableHapticFeedback: true,
        enableCancelDialog: false,
        enableSaveDialog: false,
        headerText: `Max ${maxSec} s`,
        saveButtonText: 'Utiliser',
        cancelButtonText: 'Annuler',
        theme: 'light',
        type: 'video',
        outputExt: 'mp4',
        durationFormat: 'mm:ss',
      });
    } catch (e) {
      console.warn('[videoTrim] showEditor failed', e);
      cleanup();
      reject(new VideoTrimNativeMissingError());
    }
  });
}

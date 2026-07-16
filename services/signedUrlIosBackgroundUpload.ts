/**
 * Upload PUT vers une URL signée (ex. Supabase) via NSURLSession background sur iOS.
 * Nécessite un build natif (dev client / EAS) — absent dans Expo Go.
 */
import { NativeModules, Platform } from 'react-native';

/** Évite un Promise qui ne se résout jamais (écran « Dernière étape » bloqué). */
const DEFAULT_UPLOAD_TIMEOUT_MS = 8 * 60_000;

export function isIosBackgroundSignedPutUploadAvailable(): boolean {
  return Platform.OS === 'ios' && !!NativeModules.VydiaRNFileUploader;
}

function normalizeFileUri(uri: string): string {
  const t = uri.trim();
  if (t.startsWith('file://')) return t;
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

export async function uploadFileToSignedPutUrlIosBackground(params: {
  signedUrl: string;
  localUri: string;
  mimeType: string;
  timeoutMs?: number;
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Upload = require('react-native-background-upload').default as {
    startUpload: (o: {
      url: string;
      path: string;
      method: 'PUT';
      type: 'raw';
      headers: Record<string, string>;
    }) => Promise<string>;
    addListener: (
      event: 'completed' | 'error' | 'cancelled',
      uploadId: string,
      listener: (data: Record<string, unknown>) => void
    ) => { remove: () => void };
    cancelUpload?: (uploadId: string) => void;
  };

  const path = normalizeFileUri(params.localUri);
  const uploadId = await Upload.startUpload({
    url: params.signedUrl,
    path,
    method: 'PUT',
    type: 'raw',
    headers: {
      'Content-Type': params.mimeType,
    },
  });

  const timeoutMs = params.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    const subs: Array<{ remove: () => void }> = [];

    const cleanup = () => {
      subs.forEach(s => s.remove());
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      try {
        Upload.cancelUpload?.(uploadId);
      } catch {
        // ignore
      }
      finish(() =>
        reject(new Error(`SIGNED_UPLOAD_TIMEOUT (${Math.round(timeoutMs / 1000)}s)`)),
      );
    }, timeoutMs);

    subs.push(
      Upload.addListener('completed', uploadId, data => {
        const code = Number(data.responseCode ?? 0);
        if (code >= 200 && code < 300) {
          finish(() => resolve());
        } else {
          const body = typeof data.responseBody === 'string' ? data.responseBody : '';
          finish(() =>
            reject(new Error(`SIGNED_UPLOAD_FAILED (${code}) ${body}`.trim())),
          );
        }
      }),
    );

    subs.push(
      Upload.addListener('error', uploadId, data => {
        const msg = typeof data.error === 'string' ? data.error : 'BACKGROUND_UPLOAD_ERROR';
        finish(() => reject(new Error(msg)));
      }),
    );

    subs.push(
      Upload.addListener('cancelled', uploadId, () => {
        finish(() => reject(new Error('SIGNED_UPLOAD_CANCELLED')));
      }),
    );
  });
}

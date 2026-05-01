import { Platform } from 'react-native';
import { cacheDirectory, documentDirectory, getInfoAsync } from 'expo-file-system/legacy';

function stripFileScheme(uri: string): string {
  const t = uri.trim();
  return t.startsWith('file://') ? t.slice('file://'.length) : t;
}

function addFileSchemeIfNeeded(pathOrUri: string): string {
  const t = pathOrUri.trim();
  if (!t) return t;
  if (t.startsWith('file://')) return t;
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

function safeName(base: string): string {
  return base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/**
 * Coupe un extrait audio [startSec, endSec] et génère un nouveau fichier local (m4a).
 * Nécessite un build natif (FFmpegKit), pas disponible dans Expo Go.
 */
export function isAudioTrimAvailable(): boolean {
  // FFmpegKit a été retiré (assets iOS 404). Un remplaçant natif AVFoundation sera branché ensuite.
  return false;
}

export async function trimAudioToLocalFile(params: {
  inputUri: string;
  startSec: number;
  endSec: number;
}): Promise<{ outputUri: string; durationSec: number }> {
  const start = Math.max(0, params.startSec);
  const end = Math.max(start, params.endSec);
  const dur = end - start;
  if (dur <= 0.01) {
    throw new Error('AUDIO_TRIM_INVALID_RANGE');
  }
  if (Platform.OS === 'web') {
    throw new Error('AUDIO_TRIM_UNSUPPORTED');
  }

  const baseDir = cacheDirectory ?? documentDirectory ?? '';
  if (!baseDir) throw new Error('AUDIO_TRIM_NO_DIR');

  const inUri = addFileSchemeIfNeeded(params.inputUri);
  const inPath = stripFileScheme(inUri);
  const outPath = `${stripFileScheme(baseDir)}petitmo-audio-trim-${safeName(String(Date.now()))}.m4a`;
  const outUri = addFileSchemeIfNeeded(outPath);

  let FFmpegKit: { execute: (cmd: string) => Promise<any> };
  let ReturnCode: { isSuccess: (rc: any) => boolean };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ FFmpegKit, ReturnCode } = require('ffmpeg-kit-react-native') as {
      FFmpegKit: { execute: (cmd: string) => Promise<any> };
      ReturnCode: { isSuccess: (rc: any) => boolean };
    });
  } catch {
    throw new Error('AUDIO_TRIM_NATIVE_MISSING');
  }

  // Ré-encode AAC pour une coupe fiable (copy peut foirer selon les keyframes / conteneur).
  const cmd =
    `-y -ss ${start.toFixed(3)} -t ${dur.toFixed(3)} ` +
    `-i "${inPath}" -vn -c:a aac -b:a 96k -movflags +faststart "${outPath}"`;

  const session = await FFmpegKit.execute(cmd);
  const rc = await session.getReturnCode();
  if (!ReturnCode.isSuccess(rc)) {
    const log = (await session.getAllLogsAsString?.()) ?? '';
    throw new Error(`AUDIO_TRIM_FAILED ${log}`.trim());
  }

  const info = await getInfoAsync(outUri);
  if (!info.exists) throw new Error('AUDIO_TRIM_OUTPUT_MISSING');

  return { outputUri: outUri, durationSec: dur };
}


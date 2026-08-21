import { Audio } from 'expo-av';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  copyAsync,
  documentDirectory,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';

const AUDIO_MIME_TYPES = [
  'audio/*',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/caf',
];

function extensionFromNameOrUri(name: string | null | undefined, uri: string): string {
  const fromName = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['m4a', 'mp3', 'aac', 'wav', 'caf', 'mp4'].includes(fromName)) return fromName;
  const path = uri.split('?')[0] ?? '';
  const fromUri = path.split('.').pop()?.toLowerCase() ?? '';
  if (['m4a', 'mp3', 'aac', 'wav', 'caf', 'mp4'].includes(fromUri)) return fromUri;
  return 'm4a';
}

async function measureAudioDurationSec(uri: string): Promise<number> {
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
  try {
    const status = await sound.getStatusAsync();
    if (!status.isLoaded || typeof status.durationMillis !== 'number') {
      throw new Error('DURATION_UNAVAILABLE');
    }
    return Math.max(0, status.durationMillis / 1000);
  } finally {
    await sound.unloadAsync().catch(() => {});
  }
}

async function persistImportedAudio(sourceUri: string, fileName?: string | null): Promise<string> {
  const base = documentDirectory;
  if (!base) return sourceUri;
  const root = `${base}petitmo_voice_import/`;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
  const ext = extensionFromNameOrUri(fileName, sourceUri);
  const dest = `${root}import-${Date.now()}.${ext}`;
  await copyAsync({ from: sourceUri, to: dest });
  return dest;
}

export type PickedVoiceFile = {
  uri: string;
  durationSec: number;
  fileName: string | null;
};

/**
 * Sync — ne charge jamais `expo-document-picker` (qui crash si absent du binaire).
 */
export function isVoiceDocumentPickerAvailable(): boolean {
  try {
    return requireOptionalNativeModule('ExpoDocumentPicker') != null;
  } catch {
    return false;
  }
}

type GetDocumentAsync = typeof import('expo-document-picker').getDocumentAsync;

async function loadGetDocumentAsync(): Promise<GetDocumentAsync> {
  if (!isVoiceDocumentPickerAvailable()) {
    throw new Error('DOCUMENT_PICKER_UNAVAILABLE');
  }
  // Seulement si le natif est présent — sinon `import()` déclenche requireNativeModule et log une ERROR.
  const mod = await import('expo-document-picker');
  const fn =
    typeof mod.getDocumentAsync === 'function'
      ? mod.getDocumentAsync
      : typeof (mod as { default?: { getDocumentAsync?: unknown } }).default?.getDocumentAsync ===
          'function'
        ? (mod as { default: { getDocumentAsync: GetDocumentAsync } }).default.getDocumentAsync
        : null;
  if (!fn) {
    throw new Error('DOCUMENT_PICKER_UNAVAILABLE');
  }
  return fn;
}

/** Charge un audio déjà accessible (import Fichiers ou Share Extension). */
export async function loadVoiceAudioFromUri(
  sourceUri: string,
  fileName?: string | null,
): Promise<PickedVoiceFile> {
  const uri = await persistImportedAudio(sourceUri, fileName);
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });
  const durationSec = await measureAudioDurationSec(uri);
  if (!(durationSec > 0.05)) {
    throw new Error('AUDIO_TOO_SHORT');
  }
  return {
    uri,
    durationSec,
    fileName: typeof fileName === 'string' ? fileName : null,
  };
}

/**
 * Ouvre le sélecteur système (Fichiers). Pas d’accès direct à la lib Dictaphone iOS.
 * Nécessite un build natif qui inclut `expo-document-picker`.
 */
export async function pickVoiceAudioFromFiles(): Promise<PickedVoiceFile | null> {
  const getDocumentAsync = await loadGetDocumentAsync();
  const result = await getDocumentAsync({
    type: AUDIO_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;

  const asset = result.assets[0];
  return loadVoiceAudioFromUri(asset.uri, asset.name);
}

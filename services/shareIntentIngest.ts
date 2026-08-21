import type { ShareIntentFile } from 'expo-share-intent';
import type * as ImagePicker from 'expo-image-picker';
import {
  copyAsync,
  documentDirectory,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import { loadVoiceAudioFromUri } from '@/services/voiceImport';
import type { PickedVoiceFile } from '@/services/voiceImport';

export type ShareMediaKind = 'audio' | 'image' | 'video' | 'unknown';

function extOf(name: string, path: string): string {
  const fromName = name.split('.').pop()?.toLowerCase() ?? '';
  if (fromName.length > 0 && fromName.length <= 5) return fromName;
  const clean = path.split('?')[0] ?? '';
  return clean.split('.').pop()?.toLowerCase() ?? '';
}

export function classifyShareFile(file: ShareIntentFile): ShareMediaKind {
  const mime = (file.mimeType ?? '').toLowerCase();
  const name = (file.fileName ?? '').toLowerCase();
  const ext = extOf(name, file.path ?? '');

  if (
    mime.startsWith('audio/') ||
    ['m4a', 'mp3', 'aac', 'wav', 'caf'].includes(ext) ||
    mime === 'public.mpeg-4-audio' ||
    mime.includes('m4a')
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.startsWith('video/') ||
    ['mp4', 'mov', 'm4v'].includes(ext) ||
    (ext === 'mp4' && !mime.startsWith('audio/'))
  ) {
    return 'video';
  }
  /** Dictaphone / Fichiers : souvent `audio/mp4` déjà couvert ; sinon fichier générique .m4a. */
  if (ext === 'mp4' && (mime.includes('audio') || mime === 'public.mpeg-4')) {
    return 'audio';
  }
  return 'unknown';
}

async function copyIntoSandbox(
  sourceUri: string,
  fileName: string | null,
  folder: string,
  fallbackExt: string,
): Promise<string> {
  const base = documentDirectory;
  if (!base) return sourceUri;
  const root = `${base}${folder}/`;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
  const ext = extOf(fileName ?? '', sourceUri) || fallbackExt;
  const dest = `${root}share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const from = sourceUri.startsWith('file://') ? sourceUri : `file://${sourceUri}`;
  await copyAsync({ from, to: dest });
  return dest;
}

export async function ingestSharedVoice(file: ShareIntentFile): Promise<PickedVoiceFile> {
  const from = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
  return loadVoiceAudioFromUri(from, file.fileName ?? null);
}

/** Durée share-intent : souvent ms (comme ImagePicker iOS). */
function shareDurationToMs(duration: number | null | undefined): number | null {
  if (duration == null || !(duration > 0)) return null;
  /** Heuristique : > 1000 → déjà ms ; sinon secondes. */
  if (duration > 1000) return duration;
  return duration * 1000;
}

export async function ingestSharedMediaFiles(
  files: ShareIntentFile[],
): Promise<ImagePicker.ImagePickerAsset[]> {
  const out: ImagePicker.ImagePickerAsset[] = [];
  for (const file of files) {
    const kind = classifyShareFile(file);
    if (kind !== 'image' && kind !== 'video') continue;
    const uri = await copyIntoSandbox(
      file.path,
      file.fileName,
      'petitmo_share_import',
      kind === 'video' ? 'mp4' : 'jpg',
    );
    const durationMs = shareDurationToMs(file.duration);
    out.push({
      uri,
      width: file.width ?? 0,
      height: file.height ?? 0,
      type: kind === 'video' ? 'video' : 'image',
      fileName: file.fileName || null,
      mimeType: file.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      fileSize: file.size ?? undefined,
      duration: durationMs ?? undefined,
      assetId: null,
    });
  }
  return out;
}

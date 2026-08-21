/**
 * Handoff local entre l’écran `/shareintent` et Capturer (voix / import).
 * Pas de réseau — chemins sandbox uniquement.
 */
import type { PickedVoiceFile } from '@/services/voiceImport';
import type * as ImagePicker from 'expo-image-picker';

let pendingVoice: PickedVoiceFile | null = null;
let pendingImportAssets: ImagePicker.ImagePickerAsset[] | null = null;

export function setPendingSharedVoice(file: PickedVoiceFile): void {
  pendingVoice = file;
  pendingImportAssets = null;
}

export function takePendingSharedVoice(): PickedVoiceFile | null {
  const v = pendingVoice;
  pendingVoice = null;
  return v;
}

export function setPendingSharedImport(assets: ImagePicker.ImagePickerAsset[]): void {
  pendingImportAssets = assets.length > 0 ? assets : null;
  pendingVoice = null;
}

export function takePendingSharedImport(): ImagePicker.ImagePickerAsset[] | null {
  const a = pendingImportAssets;
  pendingImportAssets = null;
  return a;
}

export function peekPendingSharedImport(): ImagePicker.ImagePickerAsset[] | null {
  return pendingImportAssets;
}

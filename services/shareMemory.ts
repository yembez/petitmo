/**
 * Partage d’un souvenir via la feuille native (Messages, WhatsApp…).
 * Local-first : fichiers sandbox seulement — pas d’attente cloud.
 */
import { Alert, Platform, Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { Memory } from '@/types/local';
import { pickFirstReadableLocalMediaUri } from '@/utils/localMediaReadable';

export type ShareMemoryMessages = {
  unavailableTitle: string;
  unavailableBody: string;
  mediaMissingTitle: string;
  mediaMissingBody: string;
  failedTitle: string;
  failedBody: string;
};

function extOf(uri: string): string {
  const clean = (uri.split('?')[0] ?? '').trim().toLowerCase();
  return clean.split('.').pop() ?? '';
}

function mimeAndUtiForUri(
  uri: string,
  kind: 'photo' | 'video' | 'voice',
): { mimeType: string; UTI?: string } {
  const ext = extOf(uri);
  if (kind === 'photo') {
    if (ext === 'png') return { mimeType: 'image/png', UTI: 'public.png' };
    if (ext === 'heic' || ext === 'heif') return { mimeType: 'image/heic', UTI: 'public.heic' };
    return { mimeType: 'image/jpeg', UTI: 'public.jpeg' };
  }
  if (kind === 'video') {
    if (ext === 'mov') return { mimeType: 'video/quicktime', UTI: 'com.apple.quicktime-movie' };
    return { mimeType: 'video/mp4', UTI: 'public.mpeg-4' };
  }
  if (ext === 'mp3') return { mimeType: 'audio/mpeg', UTI: 'public.mp3' };
  if (ext === 'wav') return { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' };
  return { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' };
}

function ensureFileUri(uri: string): string {
  const t = uri.trim();
  if (!t) return t;
  if (t.startsWith('file://') || t.startsWith('content:') || t.startsWith('ph://')) return t;
  if (t.startsWith('/')) return `file://${t}`;
  return t;
}

async function shareLocalFile(
  uri: string,
  kind: 'photo' | 'video' | 'voice',
  messages: ShareMemoryMessages,
): Promise<void> {
  const fileUri = ensureFileUri(uri);
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert(messages.unavailableTitle, messages.unavailableBody);
    return;
  }
  const { mimeType, UTI } = mimeAndUtiForUri(fileUri, kind);
  await Sharing.shareAsync(fileUri, {
    mimeType,
    ...(UTI ? { UTI } : {}),
    dialogTitle: undefined,
  });
}

async function resolvePhotoShareUri(memory: Memory): Promise<string | null> {
  let extras: string[] = [];
  try {
    const raw = memory.extra_photo_paths;
    if (Array.isArray(raw)) {
      extras = raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(s => s.trim());
    } else if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        extras = parsed
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .map(s => s.trim());
      }
    }
  } catch {
    extras = [];
  }
  return pickFirstReadableLocalMediaUri([
    memory.local_original_path,
    memory.local_print_path,
    memory.local_display_path,
    memory.local_media_path,
    ...extras,
  ]);
}

async function resolveVideoShareUri(memory: Memory): Promise<string | null> {
  return pickFirstReadableLocalMediaUri([
    memory.edited_media_url,
    memory.local_original_path,
    memory.local_media_path,
  ]);
}

async function resolveVoiceShareUri(memory: Memory): Promise<string | null> {
  return pickFirstReadableLocalMediaUri([
    memory.local_original_path,
    memory.local_media_path,
  ]);
}

function buildTextShareMessage(memory: Memory): string {
  const title = (memory.text_title ?? '').trim();
  const body = (memory.content ?? '').trim();
  if (title && body) return `${title}\n\n${body}`;
  return title || body;
}

/**
 * Ouvre la feuille de partage native pour un souvenir.
 * Texte → `Share.share` ; média → fichier local via `expo-sharing`.
 */
export async function shareMemory(
  memory: Memory,
  messages: ShareMemoryMessages,
): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert(messages.unavailableTitle, messages.unavailableBody);
    return;
  }
  if (memory.id.startsWith('pending_')) return;

  try {
    if (memory.type === 'text') {
      const message = buildTextShareMessage(memory);
      if (!message) {
        Alert.alert(messages.mediaMissingTitle, messages.mediaMissingBody);
        return;
      }
      await Share.share(
        Platform.OS === 'ios' ? { message } : { message, title: (memory.text_title ?? '').trim() || undefined },
      );
      return;
    }

    if (memory.type === 'photo') {
      const uri = await resolvePhotoShareUri(memory);
      if (!uri) {
        Alert.alert(messages.mediaMissingTitle, messages.mediaMissingBody);
        return;
      }
      await shareLocalFile(uri, 'photo', messages);
      return;
    }

    if (memory.type === 'video') {
      const uri = await resolveVideoShareUri(memory);
      if (!uri) {
        Alert.alert(messages.mediaMissingTitle, messages.mediaMissingBody);
        return;
      }
      await shareLocalFile(uri, 'video', messages);
      return;
    }

    if (memory.type === 'voice') {
      const uri = await resolveVoiceShareUri(memory);
      if (!uri) {
        Alert.alert(messages.mediaMissingTitle, messages.mediaMissingBody);
        return;
      }
      await shareLocalFile(uri, 'voice', messages);
      return;
    }

    Alert.alert(messages.unavailableTitle, messages.unavailableBody);
  } catch (e) {
    console.warn('[shareMemory]', e);
    Alert.alert(messages.failedTitle, messages.failedBody);
  }
}

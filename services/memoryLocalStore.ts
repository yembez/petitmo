import { Platform, Image } from 'react-native';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

function safeExtFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? '').toLowerCase();
  if (!ext) return fallback;
  if (ext.length > 6) return fallback;
  return ext;
}

function baseDir(): string | null {
  if (Platform.OS === 'web') return null;
  if (!documentDirectory) return null;
  return `${documentDirectory}petitmo_memories/`;
}

async function ensureDir(dir: string): Promise<void> {
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
}

async function getImagePx(uri: string): Promise<{ w: number; h: number }> {
  return await new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ w, h }),
      err => reject(err)
    );
  });
}

export async function persistOriginalToSandbox(params: {
  memoryId: string;
  type: 'photo' | 'video' | 'voice';
  sourceUri: string;
}): Promise<{ localOriginalUri: string | null }> {
  const { memoryId, type, sourceUri } = params;
  if (Platform.OS === 'web') return { localOriginalUri: null };
  const root = baseDir();
  if (!root) return { localOriginalUri: null };
  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);

  const ext =
    type === 'photo'
      ? safeExtFromUri(sourceUri, 'jpg')
      : type === 'video'
        ? safeExtFromUri(sourceUri, 'mp4')
        : safeExtFromUri(sourceUri, 'm4a');

  const dest = `${dir}original.${ext}`;
  try {
    await copyAsync({ from: sourceUri.trim(), to: dest });
    return { localOriginalUri: dest };
  } catch {
    return { localOriginalUri: null };
  }
}

export async function ensureLocalPhotoDerivatives(params: {
  memoryId: string;
  localOriginalUri: string;
}): Promise<{
  localThumbUri: string | null;
  localDisplayUri: string | null;
  localPrintUri: string | null;
  originalPx: { w: number; h: number } | null;
  printPx: { w: number; h: number } | null;
}> {
  const { memoryId, localOriginalUri } = params;
  if (Platform.OS === 'web') {
    return { localThumbUri: null, localDisplayUri: null, localPrintUri: null, originalPx: null, printPx: null };
  }
  const root = baseDir();
  if (!root) {
    return { localThumbUri: null, localDisplayUri: null, localPrintUri: null, originalPx: null, printPx: null };
  }
  const dir = `${root}${memoryId}/`;
  await ensureDir(dir);

  const thumbDest = `${dir}thumb.jpg`;
  const displayDest = `${dir}display.jpg`;
  const printDest = `${dir}print.jpg`;

  const originalPx = await getImagePx(localOriginalUri).catch(() => null);

  // Dérivés:
  // - thumb: 480px (rapide UI)
  // - display: 1400px (feed/preview)
  // - print: 2600px (A5 240dpi ~ 1820×2551 ; on vise > 240dpi dans la plupart des cas)
  const thumb = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: 480 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
  );
  const display = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: 1400 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
  );
  const print = await ImageManipulator.manipulateAsync(
    localOriginalUri,
    [{ resize: { width: 2600 } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );

  await copyAsync({ from: thumb.uri, to: thumbDest }).catch(() => {});
  await copyAsync({ from: display.uri, to: displayDest }).catch(() => {});
  await copyAsync({ from: print.uri, to: printDest }).catch(() => {});

  const printPx = await getImagePx(printDest).catch(() => null);

  return {
    localThumbUri: thumbDest,
    localDisplayUri: displayDest,
    localPrintUri: printDest,
    originalPx,
    printPx,
  };
}


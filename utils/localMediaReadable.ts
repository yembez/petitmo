import { Platform } from 'react-native';
import { getInfoAsync } from 'expo-file-system/legacy';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';

/** Réinstall / purge sandbox : SQLite conserve encore ces préfixes alors que les fichiers sont absents. */
export function isProbablyStalePetitmoSandboxPath(uriOrPath: string): boolean {
  const s = uriOrPath.trim();
  if (!s || s.startsWith('content:') || s.startsWith('ph://') || s.startsWith('assets-library://')) {
    return false;
  }
  return (
    s.includes('petitmo_memories') ||
    s.includes('petitmo_feed_local_thumbs') ||
    s.includes('petitmo_feed_local_videos')
  );
}

/**
 * Indique si une URI peut être lue sur le disque (réinstall : chemins SQLite encore présents,
 * fichiers sous `petitmo_memories/` déjà supprimés).
 */
export async function isLocalMediaUriReadable(uri: string): Promise<boolean> {
  const u = uri.trim();
  if (!u || Platform.OS === 'web') return false;
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return false;
  if (extractMediaBucketPath(u)) return false;
  if (
    !u.startsWith('file:') &&
    !u.startsWith('/') &&
    !u.startsWith('content:') &&
    !u.startsWith('ph://') &&
    !u.startsWith('assets-library://')
  ) {
    return false;
  }
  try {
    const info = await getInfoAsync(u);
    return info.exists && !info.isDirectory;
  } catch {
    return false;
  }
}

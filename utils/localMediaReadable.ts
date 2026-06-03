import { Platform } from 'react-native';
import { documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';

/**
 * Sous-dossiers du sandbox Petitmo. Sur iOS, le **container d’app change d’UUID** à chaque
 * réinstallation / build : `documentDirectory` devient
 * `file:///var/mobile/Containers/Data/Application/<NOUVEL_UUID>/Documents/`.
 * Les chemins absolus stockés en SQLite gardent l’**ancien** UUID → fichiers « introuvables »
 * alors qu’ils existent toujours sous le nouveau container. On rebase donc sur le préfixe courant.
 */
const PETITMO_SANDBOX_MARKERS = [
  'petitmo_memories/',
  'petitmo_children/',
  'petitmo_feed_local_thumbs/',
  'petitmo_feed_local_videos/',
] as const;

/**
 * Réécrit un chemin sandbox Petitmo (`…/Documents/petitmo_*`) sur le `documentDirectory` courant.
 * Laisse intactes les URL réseau, `data:`, photothèque (`ph://`, `content:`) et chemins bucket.
 */
export function rebaseSandboxUriToCurrentContainer(uriOrPath: string | null | undefined): string {
  const t = (uriOrPath ?? '').trim();
  if (!t || Platform.OS === 'web') return t;
  if (
    /^https?:\/\//i.test(t) ||
    t.startsWith('data:') ||
    t.startsWith('content:') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library://')
  ) {
    return t;
  }
  const doc = documentDirectory;
  if (!doc) return t;
  for (const marker of PETITMO_SANDBOX_MARKERS) {
    const idx = t.lastIndexOf(marker);
    if (idx >= 0) {
      const rel = t.slice(idx);
      const base = doc.endsWith('/') ? doc : `${doc}/`;
      return `${base}${rel}`;
    }
  }
  return t;
}

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

function localUriProbeCandidates(uri: string): string[] {
  const u = uri.trim();
  if (!u) return [];
  const out: string[] = [];
  const push = (c: string) => {
    const t = c.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  // Rebase d’abord : si l’UUID du container a changé, c’est le chemin courant qui existe.
  const rebased = rebaseSandboxUriToCurrentContainer(u);
  push(rebased);
  push(u);
  for (const candidate of [rebased, u]) {
    if (candidate.startsWith('file://')) {
      push(decodeURI(candidate.replace(/^file:\/\//, '')));
    } else if (candidate.startsWith('/')) {
      push(`file://${candidate}`);
    }
  }
  return out;
}

/** HTTP ou chemin bucket Storage — repli cloud légitime après réinstall. */
export function isCloudMediaReference(uri: string): boolean {
  const t = uri.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return !!extractMediaBucketPath(t);
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
  for (const candidate of localUriProbeCandidates(u)) {
    try {
      const info = await getInfoAsync(candidate);
      if (info.exists && !info.isDirectory) return true;
    } catch {
      /* essai variante suivante (file:// vs chemin nu) */
    }
  }
  return false;
}

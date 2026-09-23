import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { rebaseSandboxUriToCurrentContainer } from '@/utils/localMediaReadable';

const UUID_IN_PATH_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Clé canonique Storage (`userId/children/{childId}-ts.ext`) pour comparer des photo_url
 * signées / nues sans se faire tromper par le token de signature.
 */
export function canonicalChildPhotoStorageKey(
  photoUrl: string | null | undefined,
): string {
  const raw = (photoUrl ?? '').trim();
  if (!raw) return '';
  const path = extractMediaBucketPath(raw) ?? raw.split('?')[0] ?? '';
  return path.trim().toLowerCase();
}

/**
 * Convention upload : `{userId}/children/{childId}-{timestamp}.ext`.
 * `true` / `false` si le chemin est décidable ; `null` si format inconnu.
 */
export function photoUrlStoragePathOwnedByChild(
  photoUrl: string | null | undefined,
  childId: string,
): boolean | null {
  const key = canonicalChildPhotoStorageKey(photoUrl);
  const id = childId.trim().toLowerCase();
  if (!key || !id) return null;
  const childrenOwner = key.match(
    /\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i,
  );
  if (childrenOwner?.[1]) {
    return childrenOwner[1].toLowerCase() === id;
  }
  if (key.includes(`/${id}-`) || key.includes(`${id}-`)) return true;
  const uuids = key.match(UUID_IN_PATH_RE) ?? [];
  if (uuids.length === 0) return null;
  const lower = uuids.map(u => u.toLowerCase());
  if (lower.includes(id)) return true;
  // Au moins un UUID et aucun n’est cet enfant → probablement photo d’un autre.
  return false;
}

/**
 * URI affichable pour la photo de profil d’un enfant (expo-image / Image).
 * Priorité au fichier local, sinon URL distante (comme sur l’onglet Capturer).
 */
export function resolveChildProfileImageUri(
  localPhotoPath: string | null | undefined,
  remotePhotoUrl: string | null | undefined,
): string | null {
  const localRaw = (localPhotoPath ?? '').trim();
  // Rebase container iOS (UUID change au build/réinstall) avant de composer `file://`.
  const local = rebaseSandboxUriToCurrentContainer(localRaw);
  if (local) {
    if (
      local.startsWith('file:') ||
      local.startsWith('http://') ||
      local.startsWith('https://') ||
      local.startsWith('content:') ||
      local.startsWith('ph://') ||
      local.startsWith('asset:')
    ) {
      return local;
    }
    const path = local.startsWith('/') ? local : `/${local}`;
    return `file://${path}`;
  }
  const remote = (remotePhotoUrl ?? '').trim();
  return remote || null;
}

/**
 * URI affichage profil : évite le cache natif quand un fichier local est écrasé au même chemin
 * (ex. `petitmo_children/{id}.jpg`) en faisant varier l’URL quand `updated_at` change.
 * Ne pas toucher aux URL http(s) (signatures, etc.).
 */
export function resolveChildProfileImageDisplayUri(
  localPhotoPath: string | null | undefined,
  remotePhotoUrl: string | null | undefined,
  updatedAt: string | null | undefined,
): string | null {
  const base = resolveChildProfileImageUri(localPhotoPath, remotePhotoUrl);
  if (!base) return null;
  const rev = (updatedAt ?? '').trim();
  if (!rev) return base;
  if (
    base.startsWith('file:') ||
    base.startsWith('content:') ||
    base.startsWith('ph://')
  ) {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}petitmo_v=${encodeURIComponent(rev)}`;
  }
  return base;
}

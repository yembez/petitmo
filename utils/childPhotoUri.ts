/**
 * URI affichable pour la photo de profil d’un enfant (expo-image / Image).
 * Priorité au fichier local, sinon URL distante (comme sur l’onglet Capturer).
 */
export function resolveChildProfileImageUri(
  localPhotoPath: string | null | undefined,
  remotePhotoUrl: string | null | undefined,
): string | null {
  const local = (localPhotoPath ?? '').trim()
  if (local) {
    if (
      local.startsWith('file:') ||
      local.startsWith('http://') ||
      local.startsWith('https://') ||
      local.startsWith('content:') ||
      local.startsWith('ph://') ||
      local.startsWith('asset:')
    ) {
      return local
    }
    const path = local.startsWith('/') ? local : `/${local}`
    return `file://${path}`
  }
  const remote = (remotePhotoUrl ?? '').trim()
  return remote || null
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
  const base = resolveChildProfileImageUri(localPhotoPath, remotePhotoUrl)
  if (!base) return null
  const rev = (updatedAt ?? '').trim()
  if (!rev) return base
  if (
    base.startsWith('file:') ||
    base.startsWith('content:') ||
    base.startsWith('ph://')
  ) {
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}petitmo_v=${encodeURIComponent(rev)}`
  }
  return base
}

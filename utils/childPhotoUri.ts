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

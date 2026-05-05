import type * as ImagePicker from 'expo-image-picker';

/** Garde la première occurrence par `assetId` (sélection multiple avec doublons). */
export function dedupePickerAssetsByLibraryId(
  assets: ImagePicker.ImagePickerAsset[]
): ImagePicker.ImagePickerAsset[] {
  const seen = new Set<string>();
  const out: ImagePicker.ImagePickerAsset[] = [];
  for (const a of assets) {
    const id = typeof a.assetId === 'string' ? a.assetId.trim() : '';
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(a);
  }
  return out;
}

/**
 * Empreinte stable pour un post-album : tous les médias doivent avoir un `assetId` distinct.
 * Sinon retourne null (pas de blocage doublon pour cet import).
 */
export function buildAlbumImportFingerprint(
  assetIds: (string | null | undefined)[]
): string | null {
  const raw = assetIds.map(a => (typeof a === 'string' ? a.trim() : ''));
  if (raw.some(id => !id)) return null;
  const uniqSorted = [...new Set(raw)].sort();
  if (uniqSorted.length !== raw.length) return null;
  return `album:${uniqSorted.join(':')}`;
}

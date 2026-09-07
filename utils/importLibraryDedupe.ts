import type * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

/** Au-delà : on n’hash pas tout le fichier (vidéos longues) — échantillon + taille. */
const FULL_MD5_MAX_BYTES = 12 * 1024 * 1024;
const SAMPLE_BYTES = 128 * 1024;

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

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Empreinte contenu locale (SQLite) pour dédoublonner quand `assetId` photothèque
 * est absent (accès limité, explorateur de fichiers, etc.).
 * Préfixe `file:` — distinct des empreintes album (`album:…`).
 */
export async function computeImportContentFingerprint(
  uri: string | null | undefined
): Promise<string | null> {
  const trimmed = typeof uri === 'string' ? uri.trim() : '';
  if (!trimmed) return null;
  try {
    const file = new File(trimmed);
    if (!file.exists) return null;
    const size = typeof file.size === 'number' ? file.size : 0;
    if (size <= 0) return null;

    if (size <= FULL_MD5_MAX_BYTES) {
      const info = file.info({ md5: true });
      const md5 = typeof info.md5 === 'string' ? info.md5.trim().toLowerCase() : '';
      if (md5) return `file:md5:${size}:${md5}`;
    }

    const handle = file.open();
    try {
      handle.offset = 0;
      const sampleLen = Math.min(SAMPLE_BYTES, size);
      const sample = handle.readBytes(sampleLen);
      if (!sample || sample.length === 0) return null;
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, sample);
      return `file:sample:${size}:${bytesToHex(digest)}`;
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Album : conserve le format historique si tous les `assetId` sont là ;
 * sinon complète avec empreintes fichier pour les assets sans id.
 */
export async function buildAlbumImportFingerprintFromAssets(
  assets: Array<{ assetId?: string | null; uri: string }>
): Promise<string | null> {
  if (assets.length === 0) return null;
  const idsOnly = buildAlbumImportFingerprint(assets.map(a => a.assetId));
  if (idsOnly) return idsOnly;

  const parts: string[] = [];
  for (const a of assets) {
    const id = typeof a.assetId === 'string' ? a.assetId.trim() : '';
    if (id) {
      parts.push(`id:${id}`);
      continue;
    }
    const fileFp = await computeImportContentFingerprint(a.uri);
    if (!fileFp) return null;
    parts.push(fileFp);
  }
  const sorted = [...parts].sort();
  if (new Set(sorted).size !== sorted.length) return null;
  return `album:${sorted.join('|')}`;
}

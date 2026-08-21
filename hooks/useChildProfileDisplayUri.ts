import { useEffect, useState } from 'react';
import { getInfoAsync } from 'expo-file-system/legacy';
import { isBareMediaBucketPath, useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import {
  resolveChildProfileImageDisplayUri,
  resolveChildProfileImageUri,
} from '@/utils/childPhotoUri';

type ChildPhotoFields = {
  local_photo_path?: string | null;
  photo_url?: string | null;
  updated_at?: string | null;
};

function stripUriQuery(uri: string): string {
  const q = uri.indexOf('?');
  return q >= 0 ? uri.slice(0, q) : uri;
}

function isSandboxOrDeviceLocalUri(uri: string): boolean {
  if (isBareMediaBucketPath(uri)) return false;
  return (
    uri.startsWith('file:') ||
    uri.startsWith('content:') ||
    uri.startsWith('ph://') ||
    uri.startsWith('asset:')
  );
}

/**
 * URI affichable pour la photo profil enfant (Capturer, avatar, mosaïque).
 * Local sandbox **seulement** s’il existe encore ; sinon URL Storage re-signée.
 * Évite le trou « file:// mort » après TestFlight / réinstall qui masquait `photo_url`.
 */
export function useChildProfileDisplayUri(child: ChildPhotoFields | null | undefined): string {
  const localDisplay =
    resolveChildProfileImageDisplayUri(
      child?.local_photo_path,
      null,
      child?.updated_at,
    ) ?? '';
  const remoteRaw = (child?.photo_url ?? '').trim();
  const remoteBase = remoteRaw ? resolveChildProfileImageUri(null, remoteRaw) : null;
  const signedRemote = useSignedMediaUrl(remoteBase);

  const localCandidate =
    localDisplay && isSandboxOrDeviceLocalUri(localDisplay) ? localDisplay : '';
  const [localUsable, setLocalUsable] = useState(false);

  useEffect(() => {
    if (!localCandidate) {
      setLocalUsable(false);
      return;
    }
    let cancelled = false;
    const uri = stripUriQuery(localCandidate);
    void getInfoAsync(uri)
      .then(info => {
        if (!cancelled) setLocalUsable(!!(info.exists && !info.isDirectory));
      })
      .catch(() => {
        if (!cancelled) setLocalUsable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [localCandidate]);

  if (localUsable && localCandidate) return localCandidate;

  if (signedRemote && !isBareMediaBucketPath(signedRemote)) return signedRemote;
  if (remoteBase && !isBareMediaBucketPath(remoteBase) && /^https?:\/\//i.test(remoteBase)) {
    return remoteBase;
  }
  return '';
}

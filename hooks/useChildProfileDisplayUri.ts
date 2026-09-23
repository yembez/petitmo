import { useEffect, useState } from 'react';
import { getInfoAsync } from 'expo-file-system/legacy';
import { isBareMediaBucketPath, useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import {
  photoUrlStoragePathOwnedByChild,
  resolveChildProfileImageDisplayUri,
  resolveChildProfileImageUri,
} from '@/utils/childPhotoUri';

type ChildPhotoFields = {
  id?: string | null;
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
 * True si le fichier sandbox semble appartenir à un **autre** enfant
 * (`petitmo_children/{otherId}.jpg` alors que `child.id` est différent).
 */
function localPathBelongsToOtherChild(
  localPhotoPath: string | null | undefined,
  childId: string,
): boolean {
  const id = childId.trim();
  const lp = (localPhotoPath ?? '').trim();
  if (!id || !lp || !lp.includes('petitmo_children/')) return false;
  const base = stripUriQuery(lp).split('/').pop() ?? '';
  if (!base) return false;
  // Attendu : `{childId}.ext` — refus si un autre UUID apparaît dans le nom.
  if (base.startsWith(`${id}.`) || base === id) return false;
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(base);
}

/**
 * URI affichable pour la photo profil enfant (Capturer, avatar, mosaïque).
 * Local sandbox **seulement** s’il existe encore ; sinon URL Storage re-signée.
 * Évite le trou « file:// mort » après TestFlight / réinstall qui masquait `photo_url`.
 */
export function useChildProfileDisplayUri(child: ChildPhotoFields | null | undefined): string {
  const childId = (child?.id ?? '').trim();
  const localRawPath = (child?.local_photo_path ?? '').trim();
  const crossed = localPathBelongsToOtherChild(localRawPath, childId);

  const localDisplay =
    !crossed
      ? resolveChildProfileImageDisplayUri(localRawPath || null, null, child?.updated_at) ?? ''
      : '';
  const remoteRaw = (child?.photo_url ?? '').trim();
  /** Refuse une photo_url Storage clairement rattachée à un autre enfant (restore cloud). */
  const remoteForeign =
    !!childId && remoteRaw && photoUrlStoragePathOwnedByChild(remoteRaw, childId) === false;
  const remoteSafe = remoteForeign ? '' : remoteRaw;
  const remoteBase = remoteSafe ? resolveChildProfileImageUri(null, remoteSafe) : null;
  const signedRemote = useSignedMediaUrl(remoteBase);

  const localCandidate =
    localDisplay && isSandboxOrDeviceLocalUri(localDisplay) ? localDisplay : '';
  const localProbe = localCandidate ? stripUriQuery(localCandidate) : '';

  /** `null` = pas encore vérifié pour ce probe — ne jamais réutiliser un true d’un autre path. */
  const [verifiedProbe, setVerifiedProbe] = useState<string | null>(null);

  useEffect(() => {
    setVerifiedProbe(null);
    if (!localProbe) return;
    let cancelled = false;
    void getInfoAsync(localProbe)
      .then(info => {
        if (!cancelled) {
          setVerifiedProbe(info.exists && !info.isDirectory ? localProbe : '');
        }
      })
      .catch(() => {
        if (!cancelled) setVerifiedProbe('');
      });
    return () => {
      cancelled = true;
    };
  }, [childId, localProbe]);

  if (localCandidate && verifiedProbe === localProbe) return localCandidate;

  if (signedRemote && !isBareMediaBucketPath(signedRemote)) return signedRemote;
  if (remoteBase && !isBareMediaBucketPath(remoteBase) && /^https?:\/\//i.test(remoteBase)) {
    return remoteBase;
  }
  return '';
}

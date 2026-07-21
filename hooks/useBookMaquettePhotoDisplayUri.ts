import { useMemo } from 'react';
import type { Memory } from '@/types/local';
import { getPhotoUriForBookMaquetteDisplay } from '@/utils/memoryPhotos';
import { useSignedMediaUrl, extractMediaBucketPath } from '@/lib/mediaSignedUrl';

/**
 * URI photo maquette livre — sync local-first, signature cloud lazy.
 * Pas de pipeline fil (`useFeedPhotoDisplayUrls`) : trop lourd pour N pages montées.
 */
export function useBookMaquettePhotoDisplayUri(
  memory: Memory | null | undefined,
  photoRef?: string | null,
): string {
  const raw = useMemo(() => {
    if (!memory || memory.type !== 'photo') return '';
    return getPhotoUriForBookMaquetteDisplay(memory, photoRef).trim();
  }, [memory, photoRef]);

  const leakedBucket = extractMediaBucketPath(raw);
  const isDeviceLocal =
    !!raw &&
    !leakedBucket &&
    (raw.startsWith('file:') ||
      raw.startsWith('content:') ||
      raw.startsWith('ph://') ||
      raw.startsWith('/'));
  const needsCloudSign = !!raw && (!!leakedBucket || !isDeviceLocal);
  const signed = useSignedMediaUrl(needsCloudSign ? leakedBucket || raw : null);

  return useMemo(() => {
    if (!raw) return '';
    if (!needsCloudSign) return raw;
    const s = (signed ?? '').trim();
    return s || '';
  }, [needsCloudSign, raw, signed]);
}

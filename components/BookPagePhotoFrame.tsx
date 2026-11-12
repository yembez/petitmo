import { memo, useEffect, useRef, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BookInlinePhotoCrop } from '@/components/BookInlinePhotoCrop';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { photoCropNeedsAspectLayout, type PhotoCrop } from '@/src/book/photoCrop';
import { bookPhotoCropImageRect } from '@/utils/bookPhotoCropLayout';
import { useSignedMediaUrl, extractMediaBucketPath } from '@/lib/mediaSignedUrl';

type CropDpiMeta = {
  imgPxW: number;
  imgPxH: number;
  dpiPxW?: number;
  dpiPxH?: number;
  printMmW: number;
  printMmH: number;
};

type InlineCropProps = {
  storageKey: string;
  dpiMeta?: CropDpiMeta;
  onChange: (storageKey: string, crop: PhotoCrop) => void;
  onZoomActiveChange?: (active: boolean) => void;
};

type Props = {
  uri: string;
  frameW: number;
  frameH: number;
  crop?: PhotoCrop;
  rotation?: number;
  /** Présent dans l’éditeur livre : recadrage pinch/pan immédiat (sans tap préalable). */
  inlineCrop?: InlineCropProps;
  showRotateButton?: boolean;
  onRotate?: () => void;
  typoScale?: number;
  /** Couverture : recadrage au ratio réel de la photo (atteint toute la photo en zoomant). */
  coverMode?: boolean;
  /** Dimensions fichier (aperçu / crop aspect). */
  imgPxW?: number;
  imgPxH?: number;
};

function CroppedPhotoStatic({
  uri,
  width,
  height,
  crop,
  coverMode = false,
  imgPxW,
  imgPxH,
}: {
  uri: string;
  width: number;
  height: number;
  crop?: PhotoCrop;
  coverMode?: boolean;
  imgPxW?: number;
  imgPxH?: number;
}) {
  const cropPxW =
    typeof crop?.imgPxW === 'number' && crop.imgPxW > 0 ? crop.imgPxW : 0;
  const cropPxH =
    typeof crop?.imgPxH === 'number' && crop.imgPxH > 0 ? crop.imgPxH : 0;
  const propW = typeof imgPxW === 'number' && imgPxW > 0 ? imgPxW : 0;
  const propH = typeof imgPxH === 'number' && imgPxH > 0 ? imgPxH : 0;
  const seedW = propW || cropPxW;
  const seedH = propH || cropPxH;

  const stickyRef = useRef<{ w: number; h: number } | null>(
    seedW > 0 && seedH > 0 ? { w: seedW, h: seedH } : null,
  );
  if (seedW > 0 && seedH > 0) {
    stickyRef.current = { w: seedW, h: seedH };
  }

  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const aw = stickyRef.current?.w || measured?.w || 0;
  const ah = stickyRef.current?.h || measured?.h || 0;
  const needsAspect = coverMode || photoCropNeedsAspectLayout(crop);

  // Recadrage précis dès que dims connues (props, crop persisté, ou onLoad).
  if ((coverMode || (aw > 0 && ah > 0)) && aw > 0 && ah > 0) {
    const rect = bookPhotoCropImageRect(width, height, aw, ah, crop);
    return (
      <View style={{ width, height, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
        <ExpoImage
          source={{ uri }}
          recyclingKey={uri}
          cachePolicy="memory-disk"
          transition={0}
          priority="high"
          style={{ position: 'absolute', width: rect.width, height: rect.height, left: rect.left, top: rect.top }}
          contentFit="fill"
        />
      </View>
    );
  }

  /**
   * Crop custom sans dims : fond blanc + mesure invisible —
   * évite le flash transform→aspect (mauvais cadrage puis snap).
   */
  if (needsAspect) {
    return (
      <View style={{ width, height, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
        <ExpoImage
          source={{ uri }}
          recyclingKey={`measure:${uri}`}
          cachePolicy="memory-disk"
          transition={0}
          priority="high"
          style={{ width: 1, height: 1, opacity: 0 }}
          onLoad={e => {
            const w = e.source?.width ?? 0;
            const h = e.source?.height ?? 0;
            if (w > 0 && h > 0) {
              stickyRef.current = { w, h };
              setMeasured({ w, h });
            }
          }}
        />
      </View>
    );
  }

  // Crop défaut sans dims : cover plein cadre.
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
      <ExpoImage
        source={{ uri }}
        recyclingKey={uri}
        cachePolicy="memory-disk"
        transition={0}
        priority="high"
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
      />
    </View>
  );
}

function BookPagePhotoFrame({
  uri,
  frameW,
  frameH,
  crop,
  rotation = 0,
  inlineCrop,
  showRotateButton,
  onRotate,
  typoScale = 1,
  coverMode = false,
  imgPxW,
  imgPxH,
}: Props) {
  const { t } = useAppTranslation('common');
  const rawUri = uri.trim();
  // Bundle leak / chemin Storage nu : toujours passer par signature (jamais Image local).
  const leakedBucket = extractMediaBucketPath(rawUri);
  const isDeviceLocal =
    !!rawUri &&
    !leakedBucket &&
    (rawUri.startsWith('file:') ||
      rawUri.startsWith('content:') ||
      rawUri.startsWith('ph://') ||
      rawUri.startsWith('/'));
  const needsCloudSign = !!rawUri && (!!leakedBucket || !isDeviceLocal);
  const signed = useSignedMediaUrl(needsCloudSign ? (leakedBucket || rawUri) : null);
  // Jamais un chemin Storage nu ni Bundle → Expo Image le résout sous Petitmo.app/
  let displayUri = (
    needsCloudSign
      ? (signed ?? '').trim()
      : rawUri
  ).trim();
  if (
    displayUri.includes('/Bundle/Application/') ||
    /\/[^/]+\.app\//i.test(displayUri) ||
    (!!extractMediaBucketPath(displayUri) && !/^https?:\/\//i.test(displayUri))
  ) {
    displayUri = '';
  }

  const dpiMeta = inlineCrop?.dpiMeta;
  const [measuredPx, setMeasuredPx] = useState<{ w: number; h: number } | null>(null);
  /** Une fois les dims connues, ne plus réafficher « Calcul… » (URI signée qui arrive après, etc.). */
  const dimsLatchedRef = useRef(false);

  const propW = imgPxW ?? 0;
  const propH = imgPxH ?? 0;
  const metaW = dpiMeta?.imgPxW ?? 0;
  const metaH = dpiMeta?.imgPxH ?? 0;
  const knownFromParent =
    (propW > 0 && propH > 0) || (metaW > 0 && metaH > 0);

  useEffect(() => {
    // Changement d’URI (local → signed) : ne pas jeter les dims déjà connues côté parent.
    if (knownFromParent) return;
    setMeasuredPx(null);
  }, [displayUri, knownFromParent]);

  useEffect(() => {
    if (knownFromParent) return;
    if (!displayUri) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      /* abandon silencieux — pastille gérée via latch / parent */
    }, 4000);
    RNImage.getSize(
      displayUri,
      (w, h) => {
        if (cancelled) return;
        clearTimeout(timer);
        if (w > 0 && h > 0) setMeasuredPx({ w, h });
      },
      () => {
        clearTimeout(timer);
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [displayUri, knownFromParent]);

  const cropPxW = (propW > 0 ? propW : 0) || (metaW > 0 ? metaW : 0) || measuredPx?.w || 0;
  const cropPxH = (propH > 0 ? propH : 0) || (metaH > 0 ? metaH : 0) || measuredPx?.h || 0;
  const hasCropDims = cropPxW > 0 && cropPxH > 0;
  if (hasCropDims) dimsLatchedRef.current = true;

  /** Fallback mm si meta async absente mais dims fichier connues. */
  const printMmW = dpiMeta?.printMmW && dpiMeta.printMmW > 0 ? dpiMeta.printMmW : hasCropDims ? 190 : 0;
  const printMmH = dpiMeta?.printMmH && dpiMeta.printMmH > 0 ? dpiMeta.printMmH : hasCropDims ? 140 : 0;
  const hasPrintMm = printMmW > 0 && printMmH > 0;
  const isInteractive = !!inlineCrop && hasCropDims && hasPrintMm;
  // Jamais réafficher « Calcul… » une fois qu’on a eu des dims (évite le flash badge → Calcul).
  const isLoadingMeta =
    !!inlineCrop && !isInteractive && !dimsLatchedRef.current && !hasCropDims;
  const useAspectCrop = coverMode || hasCropDims;
  return (
    <View style={styles.host}>
      <View style={[styles.rot, { transform: [{ rotate: `${rotation}deg` }] }]}>
        {displayUri && isInteractive && inlineCrop ? (
          <BookInlinePhotoCrop
            uri={displayUri}
            frameW={frameW}
            frameH={frameH}
            crop={crop}
            imgPxW={cropPxW}
            imgPxH={cropPxH}
            dpiPxW={dpiMeta?.dpiPxW && dpiMeta.dpiPxW > 0 ? dpiMeta.dpiPxW : undefined}
            dpiPxH={dpiMeta?.dpiPxH && dpiMeta.dpiPxH > 0 ? dpiMeta.dpiPxH : undefined}
            printMmW={printMmW}
            printMmH={printMmH}
            onChange={next => inlineCrop.onChange(inlineCrop.storageKey, next)}
            coverMode={useAspectCrop}
            onZoomActiveChange={inlineCrop.onZoomActiveChange}
          />
        ) : displayUri ? (
          <CroppedPhotoStatic
            uri={displayUri}
            width={frameW}
            height={frameH}
            crop={crop}
            coverMode={useAspectCrop}
            imgPxW={cropPxW || undefined}
            imgPxH={cropPxH || undefined}
          />
        ) : (
          <View style={{ width: frameW, height: frameH, backgroundColor: '#FFFFFF' }} />
        )}
      </View>

      {showRotateButton && onRotate ? (
        <Pressable
          style={[
            styles.rotateOverlayBtn,
            {
              width: Math.max(28, Math.round(34 * typoScale)),
              height: Math.max(28, Math.round(34 * typoScale)),
              borderRadius: Math.max(14, Math.round(17 * typoScale)),
              bottom: Math.round(10 * typoScale),
              right: Math.round(10 * typoScale),
            },
          ]}
          onPress={onRotate}
          accessibilityLabel={t('book.photoFit.rotateA11y')}
        >
          <Text style={[styles.rotateOverlayIcon, { fontSize: Math.round(20 * typoScale) }]}>↻</Text>
        </Pressable>
      ) : null}

      {isLoadingMeta ? (
        <View style={styles.hintPill} pointerEvents="none">
          <Text style={styles.hintPillText}>{t('book.photoFit.dpiLoading')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default memo(BookPagePhotoFrame);

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
  },
  rot: {
    width: '100%',
    height: '100%',
  },
  rotateOverlayBtn: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    zIndex: 3,
  },
  rotateOverlayIcon: {
    color: '#1C1C1E',
    fontWeight: '600',
  },
  hintPill: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    left: '20%',
    right: '20%',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(28, 28, 30, 0.45)',
    alignItems: 'center',
    zIndex: 2,
  },
  hintPillText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '500',
  },
});

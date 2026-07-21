import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BookInlinePhotoCrop } from '@/components/BookInlinePhotoCrop';
import type { PhotoCrop } from '@/src/book/photoCrop';
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
  // Même layout aspect que l’éditeur dès que les dims sont connues (cover + pages).
  if ((coverMode || (imgPxW && imgPxH)) && imgPxW && imgPxH) {
    const rect = bookPhotoCropImageRect(width, height, imgPxW, imgPxH, crop);
    return (
      <View style={{ width, height, overflow: 'hidden', backgroundColor: '#F2F2F7' }}>
        <ExpoImage
          source={{ uri }}
          recyclingKey={uri}
          cachePolicy="memory-disk"
          transition={0}
          priority="high"
          style={{ position: 'absolute', width: rect.width, height: rect.height, left: rect.left, top: rect.top }}
          contentFit="cover"
        />
      </View>
    );
  }
  const x = ((crop?.xPct ?? 0) / 100) * width;
  const y = ((crop?.yPct ?? 0) / 100) * height;
  const s = Math.max(1, crop?.scale ?? 1);
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#F2F2F7' }}>
      <ExpoImage
        source={{ uri }}
        recyclingKey={uri}
        cachePolicy="memory-disk"
        transition={0}
        priority="high"
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX: x }, { translateY: y }, { scale: s }] },
        ]}
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
  const cropPxW = imgPxW ?? dpiMeta?.imgPxW ?? 0;
  const cropPxH = imgPxH ?? dpiMeta?.imgPxH ?? 0;
  const hasCropDims = cropPxW > 0 && cropPxH > 0;
  const hasDpiMeta = !!(dpiMeta?.printMmW && dpiMeta?.printMmH);
  const isInteractive = !!inlineCrop && hasCropDims && hasDpiMeta;
  const isLoadingMeta = !!inlineCrop && !isInteractive && !(coverMode && hasCropDims);
  /** Aspect crop : cover explicite, ou toute page dès que dims connues. */
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
            dpiPxW={dpiMeta?.dpiPxW}
            dpiPxH={dpiMeta?.dpiPxH}
            printMmW={dpiMeta.printMmW}
            printMmH={dpiMeta.printMmH}
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
          <View style={{ width: frameW, height: frameH, backgroundColor: '#F2F2F7' }} />
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
          accessibilityLabel="Pivoter la photo"
        >
          <Text style={[styles.rotateOverlayIcon, { fontSize: Math.round(20 * typoScale) }]}>↻</Text>
        </Pressable>
      ) : null}

      {isLoadingMeta ? (
        <View style={styles.hintPill} pointerEvents="none">
          <Text style={styles.hintPillText}>Calcul qualité impression…</Text>
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

import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Rect } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { Video, ResizeMode } from 'expo-av';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import { formatDuration, formatBookLocationShort } from '@/utils/date';
import { splitPhotoNoteTitleBody, splitVideoTitleBody } from '@/src/book/bookTextParts';
import type { PhotoCrop } from '@/src/book/photoCrop';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import {
  getPrimaryPhotoUriForBookPreview,
  getVideoPosterUriForBookPreview,
  getVoiceCoverUriForBookPreview,
} from '@/utils/memoryPhotos';

/** Alinéa (cadratin) en début de paragraphe — typographie roman. */
const EM_QUAD = '\u2003';

/**
 * Découpe un texte en paragraphes (double saut de ligne = nouveau paragraphe)
 * et ajoute un alinéa en début de chaque paragraphe.
 */
function romanParagraphs(text: string): string {
  if (!text.trim()) return text;
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `${EM_QUAD}${p.replace(/\n/g, `\n${EM_QUAD}`)}`)
    // Un seul retour ligne entre paragraphes (évite une "ligne vide" trop marquée).
    .join('\n');
}

/** Lieu affiché dans la maquette livre : forme courte si possible, sinon texte brut. */
function bookMaquetteLocationLabel(memory: Memory): string {
  const raw = (memory.location ?? '').trim();
  if (!raw) return '';
  const short = formatBookLocationShort(memory.location);
  return short || raw;
}

const INK = '#1C1C1E';
const MUTED = '#AEAEB2';
const SAGE = '#6B8F7E';
const VOCAL_BLUE = '#5C8FA6';
const LINE = 'rgba(0,0,0,0.08)';

/** Référence hauteur (~aperçu portrait page intérieure) pour échelle typo ; spread paysage réduit la hauteur → on compense. */
const TYPO_REF_INTERIOR_H = 520;
const TYPO_REF_COVER_H = TYPO_REF_INTERIOR_H * (142 / 216);

function clampTypoScale(s: number): number {
  return Math.max(0.5, Math.min(1.38, s));
}

/** Échelle typo selon le type de page et la hauteur rendue en px (couverture = référence plus basse). */
function typographyScaleForMaquette(pageType: BookPage['type'], heightPx: number): number {
  if (pageType === 'cover') {
    return clampTypoScale(heightPx / TYPO_REF_COVER_H);
  }
  return clampTypoScale(heightPx / TYPO_REF_INTERIOR_H);
}

/** Taille de police / interligne cohérents avec l’échelle de la page. */
function scaledTypo(scale: number, fontSize: number, lineHeight?: number): { fontSize: number; lineHeight?: number } {
  const fs = Math.max(7.5, Math.round(fontSize * scale * 10) / 10);
  if (lineHeight == null) return { fontSize: fs };
  const lh = Math.max(fs + 2, Math.round(lineHeight * scale * 10) / 10);
  return { fontSize: fs, lineHeight: lh };
}

function dateFrCaps(iso: string): string {
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function monthYearCaps(label: string): string {
  return label.replace(/\b\w/g, c => c.toUpperCase());
}

/** Marge haute blanche type maquette page 4 (~6 %). */
const PAGE4_TOP_MARGIN_RATIO = 0.065;
/** Zone photo paysage ~42 % de la hauteur page. */
const PAGE4_IMAGE_HEIGHT_RATIO = 0.42;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAR_W = 3;
const BAR_GAP = 2.5;
const BAR_COUNT = 24;

function CroppedPhotoDisplay({
  uri,
  width,
  height,
  crop,
}: {
  uri: string;
  width: number;
  height: number;
  crop?: PhotoCrop;
}) {
  const x = ((crop?.xPct ?? 0) / 100) * width;
  const y = ((crop?.yPct ?? 0) / 100) * height;
  const s = Math.max(1, crop?.scale ?? 1);
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <ExpoImage
        source={{ uri }}
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX: x }, { translateY: y }, { scale: s }] },
        ]}
        contentFit="cover"
      />
    </View>
  );
}

function barHeightsFromId(id: string): number[] {
  const rand = mulberry32(hashSeed(id));
  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    heights.push(4 + Math.floor(rand() * 17));
  }
  return heights;
}

function Folio({ n, dm400, typoScale }: { n: number; dm400?: string; typoScale: number }) {
  return (
    <Text
      style={[
        styles.folio,
        scaledTypo(typoScale, 11),
        { bottom: Math.max(6, Math.round(10 * typoScale)) },
        dm400 ? { fontFamily: dm400 } : null,
      ]}
    >
      {n}
    </Text>
  );
}

type Props = {
  page: BookPage;
  pageNum: number;
  width: number;
  height: number;
  child: Child;
  memory: Memory | null;
  rotation: number;
  /** Recadrage photo (pan + zoom). */
  photoCrop?: PhotoCrop;
  truncated: boolean;
  coverYearLabel: string;
  /** Ligne de titre affichée sur la couverture (aperçu éditable). */
  coverDisplayTitle?: string;
  /** URL de la photo de couverture (si définie par le livre). */
  coverPhotoUri?: string | null;
  /** Recadrage de la photo de couverture (pan + zoom). */
  coverPhotoCrop?: PhotoCrop;
  /** Ouvre le sélecteur de couverture. */
  onRequestCoverPhoto?: () => void;
  /** Ouvre l’éditeur de recadrage (modal parent). */
  onRequestBookCrop?: (payload: {
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'cover' | 'photo-full' | 'photo-note' | 'audio';
  }) => void;
  /** Texte affiché sur les pages chapitre (éditable). */
  chapterDisplayTitle?: string;
  onRotate: () => void;
  /** Ouvre l’éditeur de texte pour la page courante (couverture ou souvenir). */
  onRequestTextEdit: () => void;
  qrUrl: string;
};

export default function MaquetteBookPages(props: Props) {
  const {
    page,
    pageNum,
    width,
    height,
    child,
    memory,
    rotation,
    photoCrop,
    truncated,
    onRotate,
    coverDisplayTitle,
    coverPhotoUri,
    coverPhotoCrop,
    onRequestCoverPhoto,
    onRequestBookCrop,
    chapterDisplayTitle,
    onRequestTextEdit,
    qrUrl,
    coverYearLabel,
  } = props;

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dmItalic = fontsLoaded ? 'DMSans_400Regular_Italic' : undefined;
  const garamondIt = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const pad = Math.min(28, width * 0.06);
  const typoScale = typographyScaleForMaquette(page.type, height);

  switch (page.type) {
    case 'cover':
      return (
        <MaquetteCover
          child={page.child}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          dm400={dm400}
          garamondIt={garamondIt}
          bookYearLabel={coverYearLabel}
          titleLine={coverDisplayTitle ?? `Journal de ${page.child.name}`}
          coverPhotoUri={coverPhotoUri ?? null}
          coverPhotoCrop={coverPhotoCrop}
          onPressCoverPhoto={onRequestCoverPhoto}
          onRequestBookCrop={onRequestBookCrop}
          onPressTitle={onRequestTextEdit}
        />
      );
    case 'chapter':
      return (
        <View style={[styles.paper, { width, height }]}>
          <Pressable
            style={[styles.chapterCenter, { paddingHorizontal: Math.min(48, Math.round(32 * typoScale)) }]}
            onPress={onRequestTextEdit}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.chapterMonth,
                scaledTypo(typoScale, 12),
                dm400 && { fontFamily: dm400 },
              ]}
            >
              {monthYearCaps(page.month)}
            </Text>
            <Text
              style={[
                styles.chapterTitle,
                scaledTypo(typoScale, 28),
                { marginTop: Math.round(12 * typoScale) },
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              {chapterDisplayTitle ?? 'Notre histoire'}
            </Text>
            <View style={[styles.chapterLine, { marginTop: Math.round(20 * typoScale), width: Math.round(56 * typoScale) }]} />
            <Text
              style={[
                styles.chapterSub,
                scaledTypo(typoScale, 12),
                { marginTop: Math.round(16 * typoScale) },
                dm400 && { fontFamily: dm400 },
              ]}
            >
              Chapitre {page.chapterNum}
            </Text>
          </Pressable>
          <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
        </View>
      );
    case 'photo-full':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquettePhotoSimple
          memory={memory}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          onRequestBookCrop={onRequestBookCrop}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          garamondIt={garamondIt}
        />
      );
    case 'photo-note':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquettePhotoNote
          memory={memory}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          onRequestBookCrop={onRequestBookCrop}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          garamondIt={garamondIt}
        />
      );
    case 'quote':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquetteQuote
          memory={memory}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          truncated={truncated}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          dmItalic={dmItalic}
          garamondIt={garamondIt}
        />
      );
    case 'audio':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquetteAudio
          memory={memory}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          qrUrl={qrUrl}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          onRequestBookCrop={onRequestBookCrop}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          garamondIt={garamondIt}
        />
      );
    case 'video':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquetteVideo
          memory={memory}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          qrUrl={qrUrl}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          garamondIt={garamondIt}
        />
      );
    case 'back-cover':
      return (
        <View style={[styles.paper, { width, height }]}>
          <View style={styles.backCenter}>
            <Text
              style={[
                styles.backLine1,
                scaledTypo(typoScale, 18),
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              Chaque moment compte.
            </Text>
            <Text style={[styles.backLine2, scaledTypo(typoScale, 12), dm400 && { fontFamily: dm400 }]}>
              petitmo · vos souvenirs pour toujours
            </Text>
            <View style={[styles.backRule, { marginTop: Math.round(20 * typoScale), width: Math.round(120 * typoScale) }]} />
          </View>
          <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
        </View>
      );
    default: {
      const _x: never = page;
      return _x;
    }
  }
}

function MaquetteCover({
  child,
  width,
  height,
  pad,
  typoScale,
  dm400,
  garamondIt,
  bookYearLabel,
  titleLine,
  coverPhotoUri,
  coverPhotoCrop,
  onPressCoverPhoto,
  onRequestBookCrop,
  onPressTitle,
}: {
  child: Child;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  dm400?: string;
  garamondIt?: string;
  bookYearLabel: string;
  titleLine: string;
  coverPhotoUri: string | null;
  onPressCoverPhoto?: () => void;
  coverPhotoCrop?: PhotoCrop;
  onRequestBookCrop?: (payload: {
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'cover';
  }) => void;
  onPressTitle: () => void;
}) {
  const photoUri = coverPhotoUri?.trim() || child.photo_url?.trim() || null;
  /** Aligné PDF (`bookPdf.ts`) : bande photo = 142 mm sur page 216 mm. */
  const imgH = height * (142 / 216);
  const y = new Date().getFullYear();
  const periodLine = bookYearLabel || `${y - 1} – ${y}`;

  const canPickCover = !!onPressCoverPhoto;
  const canCropCover = !!onRequestBookCrop && !!photoUri;

  return (
    <View style={[styles.paper, styles.coverPaper, { width, height }]}>
      <Pressable
        style={[styles.coverImgBlock, { height: imgH }]}
        onPress={() => {
          if (canCropCover && photoUri) {
            onRequestBookCrop?.({ storageKey: 'cover', uri: photoUri, frameW: width, frameH: imgH, pageType: 'cover' });
          } else if (canPickCover) {
            onPressCoverPhoto?.();
          }
        }}
        onLongPress={() => {
          if (canPickCover) onPressCoverPhoto?.();
        }}
        delayLongPress={320}
        disabled={!photoUri ? !canPickCover : !canCropCover && !canPickCover}
        accessibilityRole="button"
        accessibilityLabel={canCropCover ? 'Recadrer ou changer la photo de couverture' : 'Choisir la photo de couverture'}
      >
        {photoUri ? (
          <View style={StyleSheet.absoluteFill}>
            <CroppedPhotoDisplay uri={photoUri} width={width} height={imgH} crop={coverPhotoCrop} />
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </Pressable>
      <View style={[styles.coverTextBlock, { paddingHorizontal: pad, paddingTop: Math.round(8 * typoScale) }]}>
        <Pressable onPress={onPressTitle} accessibilityRole="button">
          <Text
            style={[
              styles.coverTitle,
              scaledTypo(typoScale, 26),
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
          >
            {titleLine}
          </Text>
        </Pressable>
        <Text style={[styles.coverYears, scaledTypo(typoScale, 13), dm400 && { fontFamily: dm400 }]}>{periodLine}</Text>
        <View style={[styles.coverHairline, { marginTop: Math.round(16 * typoScale) }]} />
      </View>
    </View>
  );
}

function MaquettePhotoSimple({
  memory,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  rotation,
  photoCrop,
  onRotate,
  onRequestBookCrop,
  onRequestTextEdit,
  dm400,
  garamondIt,
}: {
  memory: Memory;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  onRequestBookCrop?: (payload: {
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'photo-full';
  }) => void;
  onRequestTextEdit: () => void;
  dm400?: string;
  garamondIt?: string;
}) {
  const uri = getPrimaryPhotoUriForBookPreview(memory);
  const caption = (memory.content ?? '').trim();
  const imgH = height * 0.82;
  const bookLoc = bookMaquetteLocationLabel(memory);

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.photoImgWrap, { height: imgH }]}>
        {uri ? (
          <View style={StyleSheet.absoluteFill}>
            <View style={[styles.rot, { transform: [{ rotate: `${rotation}deg` }] }]}>
              <CroppedPhotoDisplay uri={uri} width={width} height={imgH} crop={photoCrop} />
            </View>
            {onRequestBookCrop ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => onRequestBookCrop({ storageKey: memory.id, uri, frameW: width, frameH: imgH, pageType: 'photo-full' })}
                accessibilityRole="button"
                accessibilityLabel="Recadrer la photo"
              />
            ) : null}
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
              <Text style={[styles.rotateOverlayIcon, scaledTypo(typoScale, 20)]}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <Pressable
        style={[styles.photoFooter, { paddingHorizontal: pad }]}
        onPress={onRequestTextEdit}
        accessibilityRole="button"
      >
        <View style={styles.photoDateLocRow}>
          <Text style={[styles.photoDate, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}>
            {dateFrCaps(memory.created_at)}
          </Text>
          {bookLoc ? (
            <Text
              style={[styles.photoLocationBook, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}
              numberOfLines={2}
            >
              {bookLoc}
            </Text>
          ) : null}
        </View>
        {caption.length > 0 ? (
          <Text
            style={[
              styles.photoCaption,
              scaledTypo(typoScale, 17),
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
            numberOfLines={3}
          >
            {romanParagraphs(caption)}
          </Text>
        ) : null}
      </Pressable>
      <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
    </View>
  );
}

function MaquettePhotoNote({
  memory,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  rotation,
  photoCrop,
  onRotate,
  onRequestBookCrop,
  onRequestTextEdit,
  dm400,
  dm600,
  garamondIt,
}: {
  memory: Memory;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  onRequestBookCrop?: (payload: {
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'photo-note';
  }) => void;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  garamondIt?: string;
}) {
  const uri = getPrimaryPhotoUriForBookPreview(memory);
  const legend = (memory.content ?? '').trim();
  const imgH = height * 0.6;
  const bookLoc = bookMaquetteLocationLabel(memory);
  const pb = Math.max(28, Math.round(40 * typoScale));

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.page4ImageBleed, { height: imgH, width }]}>
        {uri ? (
          <View style={StyleSheet.absoluteFill}>
            <View style={[styles.rot, { transform: [{ rotate: `${rotation}deg` }] }]}>
              <CroppedPhotoDisplay uri={uri} width={width} height={imgH} crop={photoCrop} />
            </View>
            {onRequestBookCrop ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => onRequestBookCrop({ storageKey: memory.id, uri, frameW: width, frameH: imgH, pageType: 'photo-note' })}
                accessibilityRole="button"
                accessibilityLabel="Recadrer la photo"
              />
            ) : null}
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
              <Text style={[styles.rotateOverlayIcon, scaledTypo(typoScale, 20)]}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={[styles.page4TextBlock, { flex: 1, minHeight: 0 }]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: pad,
            paddingTop: Math.round(14 * typoScale),
            paddingBottom: pb,
          }}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
            <View style={[styles.page4MetaRow, { marginBottom: Math.round(8 * typoScale) }]}>
              <Text style={[styles.page4Meta, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}>
                {dateFrCaps(memory.created_at)}
              </Text>
              {bookLoc ? (
                <Text
                  style={[styles.page4MetaLocation, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}
                  numberOfLines={2}
                >
                  {bookLoc}
                </Text>
              ) : null}
            </View>
            {legend.length > 0 ? (
              <Text
                style={[
                  styles.page4Body,
                  scaledTypo(typoScale, 15, 24),
                  { marginTop: Math.round(12 * typoScale) },
                  garamondIt ? { fontFamily: garamondIt } : dm400 ? { fontFamily: dm400 } : null,
                ]}
              >
                {romanParagraphs(legend)}
              </Text>
            ) : null}
          </Pressable>
        </ScrollView>
      </View>
      <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
    </View>
  );
}


function MaquetteQuote({
  memory,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  truncated: _truncated,
  onRequestTextEdit,
  dm400,
  dm600,
  dmItalic,
  garamondIt,
}: {
  memory: Memory;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  truncated: boolean;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  dmItalic?: string;
  garamondIt?: string;
}) {
  const raw = memory.content ?? '';
  const body = useMemo(() => {
    const t = raw.trim();
    if (!t) return '';
    /**
     * Objectif:
     * - garder les paragraphes "roman" même si l'utilisateur a mis un seul retour ligne,
     * - éviter les retours "parasites" au milieu des phrases (copier/coller, wrapping).
     *
     * Heuristique:
     * - double retour = nouveau paragraphe (toujours),
     * - retour simple => paragraphe si la ligne précédente "se termine" (ponctuation) ou si la suivante
     *   ressemble à un nouveau départ (majuscule), sinon on concatène avec un espace.
     */
    const norm = t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    const lines = norm.split('\n');
    const paragraphs: string[] = [];
    let current = '';
    const startsNew = (s: string) => /^[A-ZÀ-ÖØ-Þ0-9“"'\(\[]/u.test(s);
    const endsSentence = (s: string) => /[.!?…:;)]\s*$/u.test(s);

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) {
        if (current.trim()) paragraphs.push(current.trim());
        current = '';
        continue;
      }

      if (!current) {
        current = line;
        continue;
      }

      const nextNonEmpty = (() => {
        for (let j = i + 1; j < lines.length; j++) {
          const cand = lines[j].trim();
          if (cand) return cand;
          // stop at blank => paragraph break in source
          break;
        }
        return '';
      })();

      const shouldBreakParagraph = endsSentence(current) || (nextNonEmpty && startsNew(line));
      if (shouldBreakParagraph) {
        paragraphs.push(current.trim());
        current = line;
      } else {
        current = `${current.trim()} ${line}`;
      }
    }
    if (current.trim()) paragraphs.push(current.trim());

    return paragraphs.join('\n\n');
  }, [raw]);

  const fitLevel = useMemo<0 | 1 | 2>(() => {
    if (!body) return 0;
    const paragraphCount = body.split(/\n{2,}/).filter(p => p.trim()).length;
    const approxLines = Math.ceil(body.length / 42) + paragraphCount * 2;
    if (approxLines >= 22 || body.length >= 520 || paragraphCount >= 5) return 2;
    if (approxLines >= 18 || body.length >= 420 || paragraphCount >= 3) return 1;
    return 0;
  }, [body]);

  const bookLoc = bookMaquetteLocationLabel(memory);

  const markScaled =
    fitLevel === 2
      ? scaledTypo(typoScale, 44, 44)
      : fitLevel === 1
        ? scaledTypo(typoScale, 50, 50)
        : scaledTypo(typoScale, 56, 56);

  const bodyScaled =
    fitLevel === 2
      ? scaledTypo(typoScale, 14, 21)
      : fitLevel === 1
        ? scaledTypo(typoScale, 15, 23)
        : scaledTypo(typoScale, 16, 26);

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.quoteScreenCol, { paddingHorizontal: pad }]}>
        <View style={[styles.quoteHeader, { paddingTop: Math.round(16 * typoScale) }]}>
          <View style={styles.quoteHeaderLeft}>
            <View
              style={[
                styles.sageDot,
                {
                  width: Math.max(6, Math.round(8 * typoScale)),
                  height: Math.max(6, Math.round(8 * typoScale)),
                  borderRadius: Math.max(3, Math.round(4 * typoScale)),
                },
              ]}
            />
            <Text
              style={[
                styles.quoteLabel,
                scaledTypo(typoScale, 13),
                dm600 ? { fontFamily: dm600 } : { fontWeight: '600' },
              ]}
            >
              Petits mots
            </Text>
          </View>
        </View>
        <ScrollView
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingTop: Math.round(4 * typoScale),
            paddingBottom: Math.round(8 * typoScale),
          }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
            <View>
              <Text
                style={[
                  styles.quoteMark,
                  markScaled,
                  {
                    marginLeft: Math.round(20 * typoScale),
                    marginTop: Math.round(4 * typoScale),
                  },
                  garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
                ]}
              >
                {'\u201C'}
              </Text>
              <View style={{ paddingHorizontal: Math.round(8 * typoScale) }}>
                <Text
                  style={[
                    styles.quoteBody,
                    bodyScaled,
                    garamondIt ? { fontFamily: garamondIt } : dmItalic ? { fontFamily: dmItalic } : { fontStyle: 'italic' },
                  ]}
                >
                  {romanParagraphs(body)}
                </Text>
              </View>
            </View>
          </Pressable>
        </ScrollView>
        <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
          <View style={[styles.quoteFooter, { paddingBottom: Math.round(36 * typoScale) }]}>
            <View style={[styles.quoteRuleRow, { marginTop: Math.round(8 * typoScale) }]}>
              <View style={styles.quoteRuleSeg} />
              <View
                style={[
                  styles.quoteRuleDot,
                  {
                    width: Math.max(4, Math.round(6 * typoScale)),
                    height: Math.max(4, Math.round(6 * typoScale)),
                    borderRadius: Math.max(2, Math.round(3 * typoScale)),
                    marginHorizontal: Math.round(6 * typoScale),
                  },
                ]}
              />
              <View style={styles.quoteRuleSeg} />
            </View>
            <View style={styles.photoDateLocRow}>
              <Text style={[styles.photoDate, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}>
                {dateFrCaps(memory.created_at)}
              </Text>
              {bookLoc ? (
                <Text
                  style={[styles.photoLocationBook, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}
                  numberOfLines={2}
                >
                  {bookLoc}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      </View>
      <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
    </View>
  );
}

function MaquetteAudio({
  memory,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  qrUrl,
  rotation,
  photoCrop,
  onRotate,
  onRequestBookCrop,
  onRequestTextEdit,
  dm400,
  dm600,
  garamondIt,
}: {
  memory: Memory;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  qrUrl: string;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  onRequestBookCrop?: (payload: {
    storageKey: string;
    uri: string;
    frameW: number;
    frameH: number;
    pageType: 'audio';
  }) => void;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  garamondIt?: string;
}) {
  const heights = useMemo(() => barHeightsFromId(memory.id), [memory.id]);
  const totalSec = memory.duration ?? 0;
  const durLabel = formatDuration(Math.max(0, Math.floor(totalSec)));
  const waveContentW = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  const titleRaw = clampAudioBookAnnotation((memory.content ?? '').trim());
  const qrSize = Math.max(40, Math.round(Math.min(64, width * 0.19) * Math.min(1.15, typoScale)));
  const coverUri = getVoiceCoverUriForBookPreview(memory);
  /** Même `.pn-image` que photo-note / PDF (`pageH * 0.6`). */
  const imgH = height * 0.6;
  const bookLoc = bookMaquetteLocationLabel(memory);
  const ringSize = Math.max(32, Math.round(44 * typoScale));
  const playerGap = Math.max(8, Math.round(10 * typoScale));
  const waveSvgH = Math.max(14, Math.round(18 * typoScale));
  const waveSvgW = Math.max(56, width - 2 * pad - ringSize - playerGap);
  const dotSize = Math.max(6, Math.round(8 * typoScale));

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.page4ImageBleed, { height: imgH, width }]}>
        {coverUri ? (
          <View style={StyleSheet.absoluteFill}>
            <View style={[styles.rot, { transform: [{ rotate: `${rotation}deg` }] }]}>
              <CroppedPhotoDisplay uri={coverUri} width={width} height={imgH} crop={photoCrop} />
            </View>
            {onRequestBookCrop ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() =>
                  onRequestBookCrop({
                    storageKey: memory.id,
                    uri: coverUri,
                    frameW: width,
                    frameH: imgH,
                    pageType: 'audio',
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Recadrer la photo"
              />
            ) : null}
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
              <Text style={[styles.rotateOverlayIcon, scaledTypo(typoScale, 20)]}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={styles.audioBelowPhoto}>
        <View style={[styles.audioMetaRow, { paddingHorizontal: pad }]}>
          <View style={styles.quoteHeaderLeft}>
            <View
              style={[
                styles.vocalDot,
                { width: dotSize, height: dotSize, borderRadius: dotSize / 2 },
              ]}
            />
            <Text style={[styles.vocalLabel, scaledTypo(typoScale, 13), dm600 && { fontFamily: dm600 }]}>
              Vocal
            </Text>
          </View>
          <View style={[styles.page4MetaRow, { flex: 1, minWidth: 0 }]}>
            <Text style={[styles.page4Meta, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}>
              {dateFrCaps(memory.created_at)}
            </Text>
            {bookLoc ? (
              <Text
                style={[styles.page4MetaLocation, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}
                numberOfLines={2}
              >
                {bookLoc}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: pad,
              paddingTop: Math.round(8 * typoScale),
              paddingBottom: Math.round(8 * typoScale),
            }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
              {titleRaw.length > 0 ? (
                <Text
                  style={[
                    styles.audioCaption,
                    scaledTypo(typoScale, 13, 19),
                    garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
                  ]}
                >
                  {romanParagraphs(titleRaw)}
                </Text>
              ) : null}
              <View style={[styles.audioQrCenter, { marginTop: Math.round(8 * typoScale) }]}>
                {qrUrl.trim().length > 0 ? (
                  <QRCode value={qrUrl} size={qrSize} backgroundColor="#FFFFFF" color={INK} />
                ) : (
                  <View
                    style={{
                      width: qrSize,
                      height: qrSize,
                      borderRadius: 4,
                      backgroundColor: '#EEEEEE',
                    }}
                  />
                )}
                <Text style={[styles.audioQrHint, scaledTypo(typoScale, 10), dm400 && { fontFamily: dm400 }]}>
                  Scanner pour écouter
                </Text>
              </View>
            </Pressable>
          </ScrollView>
          <View style={[styles.audioPlayerRow, { paddingHorizontal: pad, paddingTop: Math.round(6 * typoScale) }]}>
            <View
              style={[
                styles.audioRingInline,
                {
                  width: ringSize,
                  height: ringSize,
                  borderRadius: ringSize / 2,
                  borderWidth: Math.max(1, 1.5 * typoScale),
                },
              ]}
            >
              <Text style={[styles.playGlyphInline, scaledTypo(typoScale, 14)]}>▶</Text>
            </View>
            <View style={styles.audioWaveCol}>
              <Svg
                width={waveSvgW}
                height={waveSvgH}
                viewBox={`0 0 ${waveContentW} 24`}
                preserveAspectRatio="xMidYMid meet"
              >
                {heights.map((h, i) => (
                  <Rect
                    key={i}
                    x={i * (BAR_W + BAR_GAP)}
                    y={(24 - h) / 2}
                    width={BAR_W}
                    height={h}
                    rx={1}
                    fill={i < BAR_COUNT * 0.4 ? VOCAL_BLUE : 'rgba(0,0,0,0.12)'}
                  />
                ))}
              </Svg>
              <View style={styles.audioDurRowWide}>
                <Text style={[styles.audioDur, scaledTypo(typoScale, 9), dm400 && { fontFamily: dm400 }]}>0:00</Text>
                <Text style={[styles.audioDur, scaledTypo(typoScale, 9), dm400 && { fontFamily: dm400 }]}>
                  {durLabel}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
      <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
    </View>
  );
}

function MaquetteVideo({
  memory,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  qrUrl,
  onRequestTextEdit,
  dm400,
  dm600,
  garamondIt,
}: {
  memory: Memory;
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  qrUrl: string;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  garamondIt?: string;
}) {
  const posterImageUri = getVideoPosterUriForBookPreview(memory);
  const imgH = height * 0.42;
  const { title: videoTitleRaw, body: videoBodyRaw } = splitVideoTitleBody(memory.content ?? '');
  const title = videoTitleRaw || 'Vidéo';
  const sub = videoBodyRaw.trim() ? videoBodyRaw : 'Regarde ce moment en vidéo.';
  const bookLoc = bookMaquetteLocationLabel(memory);
  const videoQrSize = Math.max(44, Math.round(Math.min(100, width * 0.26) * Math.min(1.1, typoScale)));

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.photoImgWrap, { height: imgH }]}>
        {posterImageUri ? (
          <Image source={{ uri: posterImageUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: pad, paddingTop: Math.round(20 * typoScale) }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Math.round(16 * typoScale) }}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
            <View style={[styles.noteMetaRow, { marginBottom: Math.round(8 * typoScale) }]}>
              <Text style={[styles.noteMeta, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}>
                {dateFrCaps(memory.created_at)}
              </Text>
              {bookLoc ? (
                <Text
                  style={[styles.noteMetaLocation, scaledTypo(typoScale, 11), dm400 && { fontFamily: dm400 }]}
                  numberOfLines={2}
                >
                  {bookLoc}
                </Text>
              ) : null}
            </View>
            <Text
              style={[
                styles.videoTitle,
                scaledTypo(typoScale, 18),
                { marginTop: Math.round(4 * typoScale) },
                dm600 && { fontFamily: dm600 },
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              {title}
            </Text>
            <Text
              style={[
                styles.videoSub,
                scaledTypo(typoScale, 14, 22),
                { marginTop: Math.round(10 * typoScale) },
                garamondIt ? { fontFamily: garamondIt } : dm400 ? { fontFamily: dm400 } : null,
              ]}
            >
              {romanParagraphs(sub)}
            </Text>
          </Pressable>
          <View style={{ alignItems: 'center', marginTop: Math.round(16 * typoScale) }}>
            {qrUrl.trim().length > 0 ? (
              <QRCode value={qrUrl} size={videoQrSize} backgroundColor="#FFFFFF" color={INK} />
            ) : (
              <View
                style={{
                  width: videoQrSize,
                  height: videoQrSize,
                  borderRadius: 4,
                  backgroundColor: '#EEEEEE',
                }}
              />
            )}
            <Text style={[styles.audioQrHint, scaledTypo(typoScale, 10), dm400 && { fontFamily: dm400 }]}>
              Scanner pour regarder
            </Text>
          </View>
        </ScrollView>
      </View>
      <Folio n={pageNum} dm400={dm400} typoScale={typoScale} />
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  folio: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    fontSize: 11,
    color: MUTED,
  },
  coverPaper: {
    position: 'relative',
  },
  coverImgBlock: {
    width: '100%',
    overflow: 'hidden',
  },
  coverPh: {
    flex: 1,
    backgroundColor: '#E8E8ED',
  },
  coverTextBlock: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 8,
  },
  coverTitle: {
    fontSize: 26,
    color: INK,
    fontWeight: '400',
  },
  coverYears: {
    marginTop: 8,
    fontSize: 13,
    color: MUTED,
  },
  coverHairline: {
    marginTop: 16,
    height: StyleSheet.hairlineWidth,
    backgroundColor: LINE,
    width: '100%',
  },
  chapterCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  chapterMonth: {
    fontSize: 12,
    color: MUTED,
    letterSpacing: 0.6,
  },
  chapterTitle: {
    marginTop: 12,
    fontSize: 28,
    color: INK,
    textAlign: 'center',
  },
  chapterLine: {
    marginTop: 20,
    width: 56,
    height: StyleSheet.hairlineWidth,
    backgroundColor: LINE,
  },
  chapterSub: {
    marginTop: 16,
    fontSize: 12,
    color: MUTED,
  },
  photoImgWrap: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  rot: { flex: 1, overflow: 'hidden' },
  page4TopBand: {
    backgroundColor: '#FFFFFF',
  },
  page4ImageBleed: {
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  page4TextBlock: {
    flex: 1,
  },
  page4Scroll: {
    flex: 1,
  },
  page4ScrollContent: {
    paddingTop: 14,
  },
  page4MetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  page4Meta: {
    fontSize: 11,
    color: '#636366',
    letterSpacing: 0.2,
    flexShrink: 0,
  },
  page4MetaLocation: {
    fontSize: 11,
    color: '#636366',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    minWidth: 0,
  },
  page4Title: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '700',
    color: INK,
  },
  page4Body: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 24,
    color: INK,
    textAlign: 'justify' as const,
  },
  photoFooter: {
    paddingTop: 14,
    paddingBottom: 36,
    flex: 1,
    minHeight: 36,
  },
  photoDateLocRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    flexShrink: 0,
  },
  photoDate: {
    fontSize: 11,
    color: '#636366',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  photoLocationBook: {
    fontSize: 11,
    color: '#3A3A3C',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    minWidth: 0,
    letterSpacing: 0.15,
  },
  photoCaption: {
    marginTop: 6,
    fontSize: 17,
    color: INK,
    textAlign: 'justify' as const,
  },
  noteMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  noteMeta: {
    fontSize: 11,
    color: '#636366',
    flexShrink: 0,
  },
  noteMetaLocation: {
    fontSize: 11,
    color: '#3A3A3C',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    minWidth: 0,
  },
  noteTitle: {
    marginTop: 8,
    fontSize: 18,
    color: INK,
    fontWeight: '600',
  },
  noteBody: {
    marginTop: 10,
    fontSize: 14,
    color: INK,
    lineHeight: 22,
    textAlign: 'justify' as const,
  },
  quoteScreenCol: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    width: '100%',
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 16,
    flexShrink: 0,
  },
  quoteMid: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
    overflow: 'hidden',
  },
  quoteHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SAGE },
  vocalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: VOCAL_BLUE },
  quoteLabel: { fontSize: 13, color: SAGE, fontWeight: '600' },
  vocalLabel: { fontSize: 13, color: VOCAL_BLUE, fontWeight: '600' },
  quoteDate: { fontSize: 11, color: MUTED },
  quoteMark: {
    fontSize: 56,
    color: 'rgba(0,0,0,0.06)',
    marginLeft: 20,
    marginTop: 4,
    lineHeight: 56,
  },
  quoteMarkFit1: {
    fontSize: 50,
    lineHeight: 50,
  },
  quoteMarkFit2: {
    fontSize: 44,
    lineHeight: 44,
  },
  quoteBody: {
    fontSize: 16,
    color: INK,
    lineHeight: 26,
    textAlign: 'justify' as const,
  },
  quoteBodyFit1: {
    fontSize: 15,
    color: INK,
    lineHeight: 23,
    textAlign: 'justify' as const,
  },
  quoteBodyFit2: {
    fontSize: 14,
    color: INK,
    lineHeight: 21,
    textAlign: 'justify' as const,
  },
  quoteFooter: { width: '100%', paddingBottom: 36, flexShrink: 0, marginTop: 'auto' },
  quoteRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  quoteRuleSeg: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA' },
  quoteRuleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 6,
  },
  /** Même squelette que le PDF : photo-note en haut, bandeau (meta → texte → QR → play + onde). */
  audioBelowPhoto: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
  },
  audioMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
    gap: 14,
  },
  audioLower: {
    flex: 1,
    minHeight: 0,
    paddingTop: 8,
    flexDirection: 'column',
  },
  audioTopBlock: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  audioCaption: {
    marginTop: 0,
    fontSize: 13,
    lineHeight: 19,
    color: INK,
    textAlign: 'justify' as const,
  },
  audioQrCenter: {
    alignItems: 'center',
    marginTop: 8,
  },
  audioPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 10,
    paddingTop: 6,
  },
  audioRingInline: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(92,143,166,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyphInline: {
    fontSize: 14,
    color: VOCAL_BLUE,
    marginLeft: 2,
  },
  audioWaveCol: {
    flex: 1,
    minWidth: 0,
  },
  audioDurRowWide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 4,
  },
  audioDur: { fontSize: 9, color: MUTED },
  audioQrHint: { marginTop: 6, fontSize: 10, color: MUTED },
  videoTitle: { marginTop: 4, fontSize: 18, color: INK },
  videoSub: { marginTop: 10, fontSize: 14, color: '#6B7280', lineHeight: 22, textAlign: 'justify' as const },
  rotateOverlayBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    zIndex: 20,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateOverlayIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 22,
  },
  backCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  backLine1: {
    fontSize: 18,
    color: MUTED,
    textAlign: 'center',
  },
  backLine2: {
    marginTop: 12,
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
  },
  backRule: {
    marginTop: 20,
    width: 120,
    height: StyleSheet.hairlineWidth,
    backgroundColor: LINE,
  },
});

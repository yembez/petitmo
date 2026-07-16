import { memo, useMemo, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Rect, Path } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import type { BookPage, PhotoFullVariant } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import { formatBookLocationShort } from '@/utils/date';
import { formatFamilyAgesLine } from '@/utils/childrenAge';
import type { PhotoCrop } from '@/src/book/photoCrop';
import { bookPhotoCropImageRect } from '@/utils/bookPhotoCropLayout';
import BookPagePhotoFrame from '@/components/BookPagePhotoFrame';
import CoverPageSpineOverlay from '@/components/CoverPageSpineOverlay';
import { clampMediaBookCaption } from '@/lib/mediaBookCaption';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { MEMORY_TEXT_FONT_FALLBACK } from '@/constants/memoryTextFont';
import { bookPortraitPerfRender } from '@/utils/bookPortraitSpreadPerf';
import { useBookVideoPosterDisplayUrl } from '@/hooks/useBookVideoPosterDisplayUrl';
import { useBookMaquettePhotoDisplayUri } from '@/hooks/useBookMaquettePhotoDisplayUri';
import {
  getVoiceCoverUriForBookEditorDisplay,
  getVoiceCoverUriForBookPreview,
  isDeviceLocalMediaUri,
} from '@/utils/memoryPhotos';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { memoryBookDisplayDateIso } from '@/utils/memoryBookDisplayDate';
import {
  resolveTextMemoryBookLayout,
  textMemoryBodyAlignCenter,
  textMemoryBodyTextAlign,
  type TextMemoryLayoutVariant,
  type TextMemorySizeTier,
} from '@/src/book/quoteFitLevel';
import {
  pdfChapterMonthStyle,
  pdfChapterSubStyle,
  pdfChapterTitleStyle,
  pdfCoverPeriodStyle,
  pdfCoverTitleStyle,
  pdfFolioStyle,
  pdfLabelStyle,
  PDF_MEDIA_QR_GAP_MM,
  PDF_MEDIA_QR_PULL_UP_MM,
  PDF_MEDIA_QR_CARD_BORDER_COLOR,
  PDF_MEDIA_QR_MUTED_COLOR,
  PDF_MEDIA_TEXT_PAD_X_MM,
  pdfMediaQrCardLayoutPx,
  pdfMediaCaptionStyle,
  pdfMmToPreviewPxH,
  pdfMmToPreviewPxUniform,
  pdfMmToPreviewPxW,
  pdfPhotoCaptionStyle,
  pdfPhotoNoteBodyStyle,
  pdfPtToPreviewPx,
  pdfQuoteMarkStyle,
  pdfQuotePagePadX,
  pdfQuotePagePadY,
  PDF_GUILLEMET_RULE_MM,
  PDF_DROPCAP_PARA_GAP_MM,
  PDF_GUILLEMET_BODY_MARGIN_BOTTOM_MM,
  PDF_GUILLEMET_MARK_MARGIN_BOTTOM_MM,
  PDF_GUILLEMET_RULE_MARGIN_TOP_MM,
  PDF_TEXT_MEMORY_TITLE_BLOCK_MARGIN_MM,
  PDF_TEXT_MEMORY_TITLE_RULE_MM,
  pdfTextMemoryColumnMaxWidthPx,
  pdfTextMemoryBodyStyle,
  pdfTextMemoryDropcapBodyStyle,
  pdfTextMemoryDropCapStyle,
  pdfTextMemoryGuillemetBodyStyle,
  pdfTextMemoryTitleStyle,
  BOOK_VISUAL_MARGIN_MM,
  PHOTO_FULL_BAND_HEIGHT_RATIO,
  PHOTO_NOTE_BAND_HEIGHT_MM,
  PHOTO_FULL_FP_FOOTER_MM,
  PHOTO_FULL_FP_IMAGE_HEIGHT_MM,
} from '@/src/book/pdfPreviewTypo';

/** Alinéa (cadratin) en début de paragraphe — typographie roman. */
const EM_QUAD = '\u2003';

/** Style corps souvenir — Roboto, pas d’italique hérité (parité fil). */
function memoryTextStyle(fontFamily: string) {
  return {
    fontFamily,
    fontStyle: 'normal' as const,
    fontWeight: '400' as const,
  };
}

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
    .join('\n');
}

/** Paragraphes centrés sans alinéa (maquette titre + corps centré). */
function centeredBookParagraphs(text: string): string {
  if (!text.trim()) return text;
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.replace(/\n/g, '\n'))
    .join('\n\n');
}

function editorialTextStyle(garamond?: string, memoryTextFont?: string) {
  if (garamond) {
    return { fontFamily: garamond, fontStyle: 'normal' as const, fontWeight: '400' as const };
  }
  return memoryTextStyle(memoryTextFont ?? MEMORY_TEXT_FONT_FALLBACK);
}

function firstGrapheme(s: string): string {
  const m = s.match(/^\s*(\p{L}|\p{N})/u);
  return m?.[0] ?? s.charAt(0);
}

function textMemoryTitleBlockMargin(tier: TextMemorySizeTier, pageHeightPx: number): number {
  return pdfMmToPreviewPxH(PDF_TEXT_MEMORY_TITLE_BLOCK_MARGIN_MM[tier], pageHeightPx);
}

function splitBookParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
}

function textMemoryMidJustify(
  variant: TextMemoryLayoutVariant,
  _tier: TextMemorySizeTier,
): 'center' | 'flex-start' {
  if (variant === 'dropcap' || variant === 'titled') return 'center';
  if (_tier === 'sm') return 'flex-start';
  return 'center';
}

function TextMemoryQuoteHeader({
  width,
  dm600,
}: {
  width: number;
  dm600?: string;
}) {
  return (
    <View style={styles.quoteHeader}>
      <View style={styles.quoteHeaderLeft}>
        <View
          style={[
            styles.sageDot,
            {
              width: Math.max(4, pdfPtToPreviewPx(6, width)),
              height: Math.max(4, pdfPtToPreviewPx(6, width)),
              borderRadius: Math.max(2, pdfPtToPreviewPx(3, width)),
            },
          ]}
        />
        <Text
          style={[
            styles.quoteLabel,
            pdfLabelStyle(width),
            dm600 ? { fontFamily: dm600 } : { fontWeight: '600' },
          ]}
        >
          Petits mots
        </Text>
      </View>
    </View>
  );
}

function TextMemoryQuoteFooter({
  memory,
  familyChildren,
  width,
  height,
  dm400,
  onRequestTextEdit,
}: {
  memory: Memory;
  familyChildren: Child[];
  width: number;
  height: number;
  dm400?: string;
  onRequestTextEdit: () => void;
}) {
  const bookLoc = bookMaquetteLocationLabel(memory);
  const folioClearance = pdfMmToPreviewPxH(8, height) + pdfPtToPreviewPx(9, width);
  return (
    <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
      <View style={[styles.quoteFooter, { paddingBottom: folioClearance }]}>
        <View style={[styles.quoteRuleRow, { marginTop: pdfMmToPreviewPxH(6, height) }]}>
          <View style={styles.quoteRuleSeg} />
          <View
            style={[
              styles.quoteRuleDot,
              {
                width: Math.max(4, pdfPtToPreviewPx(4, width)),
                height: Math.max(4, pdfPtToPreviewPx(4, width)),
                borderRadius: Math.max(2, pdfPtToPreviewPx(2, width)),
                marginHorizontal: pdfPtToPreviewPx(4, width),
              },
            ]}
          />
          <View style={styles.quoteRuleSeg} />
        </View>
        <View style={styles.photoDateLocRow}>
          <Text style={[styles.photoDate, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}>
            {dateWithAgeCaps(memory, familyChildren)}
          </Text>
          {bookLoc ? (
            <Text
              style={[styles.photoLocationBook, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}
              numberOfLines={2}
            >
              {bookLoc}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function TextMemoryBodyContent({
  body,
  variant,
  tier,
  width,
  height,
  memoryTextFont,
  garamond,
  garamondIt,
  centerBody,
  bodyTextAlign,
  columnMaxW,
}: {
  body: string;
  variant: TextMemoryLayoutVariant;
  tier: TextMemorySizeTier;
  width: number;
  height: number;
  memoryTextFont: string;
  garamond?: string;
  garamondIt?: string;
  centerBody: boolean;
  bodyTextAlign: 'center' | 'left' | 'justify';
  columnMaxW?: number;
}) {
  const bodyScaled =
    variant === 'guillemet' ? pdfTextMemoryGuillemetBodyStyle(width) : pdfTextMemoryBodyStyle(tier, width);
  const bodyFont = editorialTextStyle(garamond, memoryTextFont);
  const bodyText = centerBody ? centeredBookParagraphs(body) : romanParagraphs(body);
  const bodyWrapStyle = columnMaxW
    ? { maxWidth: columnMaxW, alignSelf: 'center' as const, width: '100%' as const }
    : undefined;

  if (variant === 'dropcap') {
    const trimmed = body.trim();
    if (!trimmed) return null;
    const paragraphs = splitBookParagraphs(trimmed);
    if (paragraphs.length === 0) return null;
    const bodyScaled = pdfTextMemoryDropcapBodyStyle(tier, width);
    const capStyle = pdfTextMemoryDropCapStyle(tier, width);
    const paraGap = pdfMmToPreviewPxH(PDF_DROPCAP_PARA_GAP_MM, height);
    const firstPara = paragraphs[0]!;
    const cap = firstGrapheme(firstPara);
    const capIdx = firstPara.search(/\p{L}|\p{N}/u);
    const afterCap = capIdx >= 0 ? firstPara.slice(capIdx + cap.length) : firstPara.slice(1);
    const firstBody = afterCap.replace(/\n/g, `\n${EM_QUAD}`);
    const restParas = paragraphs.slice(1);
    return (
      <View style={bodyWrapStyle}>
        <View style={styles.textMemoryDropCapRow}>
          <Text
            style={[
              styles.textMemoryDropCap,
              capStyle,
              garamond ? { fontFamily: garamond } : { fontFamily: memoryTextFont },
              { marginRight: pdfPtToPreviewPx(3, width) },
            ]}
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          >
            {cap}
          </Text>
          <Text
            style={[
              styles.quoteBody,
              bodyScaled,
              bodyFont,
              { flex: 1, textAlign: 'left' as const },
            ]}
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          >
            {firstBody}
          </Text>
        </View>
        {restParas.map((para, idx) => (
          <Text
            key={`dropcap-p-${idx}`}
            style={[
              styles.quoteBody,
              bodyScaled,
              bodyFont,
              { textAlign: 'left' as const, marginTop: paraGap },
            ]}
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          >
            {`${EM_QUAD}${para.replace(/\n/g, `\n${EM_QUAD}`)}`}
          </Text>
        ))}
      </View>
    );
  }

  if (variant === 'guillemet') {
    const markScaled = pdfQuoteMarkStyle(width);
    const ruleW = pdfMmToPreviewPxW(PDF_GUILLEMET_RULE_MM, width);
    const markFont = garamondIt
      ? { fontFamily: garamondIt, fontStyle: 'normal' as const }
      : garamond
        ? { fontFamily: garamond, fontStyle: 'italic' as const }
        : { fontFamily: memoryTextFont, fontStyle: 'normal' as const };
    return (
      <View style={bodyWrapStyle}>
        <Text
          style={[
            styles.quoteMark,
            markScaled,
            markFont,
            {
              color: SAGE,
              marginTop: 0,
              marginLeft: 0,
              marginBottom: pdfMmToPreviewPxH(PDF_GUILLEMET_MARK_MARGIN_BOTTOM_MM, height),
              textAlign: 'center' as const,
              alignSelf: 'center' as const,
            },
          ]}
          {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
        >
          {'\u201C'}
        </Text>
        <Text
          style={[
            styles.quoteBody,
            bodyScaled,
            bodyFont,
            { textAlign: bodyTextAlign, marginBottom: pdfMmToPreviewPxH(PDF_GUILLEMET_BODY_MARGIN_BOTTOM_MM, height) },
          ]}
          {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
        >
          {bodyText}
        </Text>
        <View
          style={[
            styles.textMemoryGuillemetRule,
            {
              width: ruleW,
              marginTop: pdfMmToPreviewPxH(PDF_GUILLEMET_RULE_MARGIN_TOP_MM, height),
              alignSelf: 'center' as const,
            },
          ]}
        />
      </View>
    );
  }

  if (variant === 'titled' && tier === 'sm') {
    const paragraphs = splitBookParagraphs(body.trim());
    if (paragraphs.length === 0) return null;
    const paraGap = pdfMmToPreviewPxH(PDF_DROPCAP_PARA_GAP_MM, height);
    return (
      <View style={bodyWrapStyle}>
        {paragraphs.map((para, idx) => (
          <Text
            key={`titled-sm-p-${idx}`}
            style={[
              styles.quoteBody,
              bodyScaled,
              bodyFont,
              {
                textAlign: bodyTextAlign,
                marginTop: idx > 0 ? paraGap : 0,
              },
            ]}
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          >
            {`${EM_QUAD}${para.replace(/\n/g, `\n${EM_QUAD}`)}`}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <View style={bodyWrapStyle}>
      <Text
        style={[
          styles.quoteBody,
          bodyScaled,
          bodyFont,
          { textAlign: bodyTextAlign },
        ]}
        {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
      >
        {bodyText}
      </Text>
    </View>
  );
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
  // Plancher bas pour rester proportionnel jusqu'à la vue spread (vignettes ~moitié de page).
  return Math.max(0.4, Math.min(1.38, s));
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
  const fs = Math.max(1, Math.round(fontSize * scale * 10) / 10);
  if (lineHeight == null) return { fontSize: fs };
  const lh = Math.max(fs + 1, Math.round(lineHeight * scale * 10) / 10);
  return { fontSize: fs, lineHeight: lh };
}

function dateFrCaps(iso: string): string {
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Libellé date + âges famille à la date du souvenir (`memories.created_at`).
 * Parité PDF serveur : Phase 2 (`htmlBook.ts` utilise encore un seul `birthdate`).
 */
function dateWithAgeCaps(memory: Memory, familyChildren: Child[]): string {
  const iso = memoryBookDisplayDateIso(memory);
  const date = dateFrCaps(iso);
  const age = formatFamilyAgesLine(familyChildren, iso);
  return age ? `${date} · ${age}` : date;
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
  if (coverMode && imgPxW && imgPxH) {
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

/**
 * Marge blanche autour des visuels — parité `--visual-margin` dans `htmlBook.ts`.
 */

type InlineCropConfig = {
  dpiMetaByKey: Record<
    string,
    {
      imgPxW: number;
      imgPxH: number;
      dpiPxW?: number;
      dpiPxH?: number;
      printMmW: number;
      printMmH: number;
      blurScore?: number | null;
    }
  >;
  onChange: (storageKey: string, crop: PhotoCrop) => void;
};

function buildInlineCropProps(config: InlineCropConfig | undefined, storageKey: string) {
  if (!config) return undefined;
  return {
    storageKey,
    dpiMeta: config.dpiMetaByKey[storageKey],
    onChange: config.onChange,
  };
}

/** Bandeau visuel à pleine largeur de page, avec marge blanche autour de l'image (cadre inséré). */
function VisualBand({
  width,
  height,
  bandH,
  children,
}: {
  width: number;
  height: number;
  bandH: number;
  children: (frameW: number, frameH: number) => ReactNode;
}) {
  const mx = pdfMmToPreviewPxUniform(BOOK_VISUAL_MARGIN_MM, width, height);
  const my = mx;
  const frameW = Math.max(1, width - 2 * mx);
  const frameH = Math.max(1, bandH - 2 * my);
  return (
    <View style={{ width, height: bandH, backgroundColor: '#FFFFFF' }}>
      <View
        style={{
          position: 'absolute',
          left: mx,
          top: my,
          width: frameW,
          height: frameH,
          overflow: 'hidden',
          backgroundColor: '#F2F2F7',
        }}
      >
        {children(frameW, frameH)}
      </View>
    </View>
  );
}

/** Bande photo pleine largeur sans marge [FP] — parité `.pf-variant-fp .pf-image`. */
function FullBleedBand({
  width,
  bandH,
  children,
}: {
  width: number;
  bandH: number;
  children: (frameW: number, frameH: number) => ReactNode;
}) {
  return (
    <View style={{ width, height: bandH, overflow: 'hidden', backgroundColor: '#F2F2F7' }}>
      {children(width, bandH)}
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

function Folio({
  n,
  dm400,
  pageWidthPx,
  pageHeightPx,
}: {
  n: number;
  dm400?: string;
  pageWidthPx: number;
  pageHeightPx: number;
}) {
  const folio = pdfFolioStyle(pageWidthPx, pageHeightPx);
  return (
    <Text
      style={[
        styles.folio,
        { fontSize: folio.fontSize, bottom: folio.bottom },
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
  /** Tous les enfants famille (SQLite) — âges à la date du souvenir. Défaut : `[child]`. */
  familyChildren?: Child[];
  memory: Memory | null;
  /** Slot photo album pour les pages photo (URL favorite / couverture). */
  memoryPhotoRef?: string | null;
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
  /** Dimensions fichier couverture (aperçu lecture seule au ratio réel). */
  coverPhotoImgPxW?: number;
  coverPhotoImgPxH?: number;
  /** Force le remontage visuel après changement de couverture. */
  coverPhotoRenderKey?: string;
  /** Ouvre le sélecteur de couverture. */
  onRequestCoverPhoto?: () => void;
  /** Recadrage in-place (éditeur livre) : pinch/pan dans le cadre de la page. */
  inlineCropConfig?: InlineCropConfig;
  /** Texte affiché sur les pages chapitre (éditable). */
  chapterDisplayTitle?: string;
  onRotate: () => void;
  /** Ouvre l’éditeur de texte pour la page courante (couverture ou souvenir). */
  onRequestTextEdit: () => void;
  qrUrl: string;
  /** Typo chargée une fois par l’écran livre (évite `useFonts` par page / spread). */
  typography: BookMaquetteTypography;
  /** Contexte perf debug (ex. `portrait-browse`). */
  perfContext?: string;
};

function MaquetteBookPages(props: Props) {
  const {
    page,
    pageNum,
    width,
    height,
    child,
    memory,
    memoryPhotoRef,
    rotation,
    photoCrop,
    truncated,
    onRotate,
    coverDisplayTitle,
    coverPhotoUri,
    coverPhotoCrop,
    coverPhotoImgPxW,
    coverPhotoImgPxH,
    coverPhotoRenderKey,
    onRequestCoverPhoto,
    inlineCropConfig,
    chapterDisplayTitle,
    onRequestTextEdit,
    qrUrl,
    coverYearLabel,
    familyChildren: familyChildrenProp,
    typography,
    perfContext,
  } = props;

  if (perfContext) {
    bookPortraitPerfRender('MaquetteBookPages', {
      perfContext,
      pageType: page.type,
      pageNum,
      memoryId: memory?.id?.slice(0, 8),
      w: Math.round(width),
      h: Math.round(height),
      hasQr: Boolean(qrUrl),
    });
  }

  const familyChildren = familyChildrenProp ?? [child];

  const dm400 = typography.dm400;
  const dm600 = typography.dm600;
  const dmItalic = typography.dmItalic;
  const garamondIt = typography.garamondIt;
  const garamond = typography.garamond;
  const memoryTextFont = typography.memoryTextFont;

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
          coverPhotoImgPxW={coverPhotoImgPxW}
          coverPhotoImgPxH={coverPhotoImgPxH}
          coverPhotoRenderKey={coverPhotoRenderKey}
          onPressCoverPhoto={onRequestCoverPhoto}
          inlineCropConfig={inlineCropConfig}
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
                pdfChapterMonthStyle(width),
                dm400 && { fontFamily: dm400 },
              ]}
            >
              {monthYearCaps(page.month)}
            </Text>
            <Text
              style={[
                styles.chapterTitle,
                pdfChapterTitleStyle(width),
                { marginTop: pdfMmToPreviewPxH(8, height) },
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              {chapterDisplayTitle ?? 'Notre histoire'}
            </Text>
            <View style={[styles.chapterLine, { marginTop: pdfMmToPreviewPxH(14, height), width: pdfMmToPreviewPxW(20, width) }]} />
            <Text
              style={[
                styles.chapterSub,
                pdfChapterSubStyle(width),
                { marginTop: pdfMmToPreviewPxH(10, height) },
                dm400 && { fontFamily: dm400 },
              ]}
            >
              Chapitre {page.chapterNum}
            </Text>
          </Pressable>
          <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
        </View>
      );
    case 'photo-full':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquettePhotoSimple
          memory={memory}
          memoryPhotoRef={memoryPhotoRef}
          familyChildren={familyChildren}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          inlineCropConfig={inlineCropConfig}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          memoryTextFont={memoryTextFont}
          garamond={garamond}
          variant={page.variant}
        />
      );
    case 'photo-note':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquettePhotoNote
          memory={memory}
          memoryPhotoRef={memoryPhotoRef}
          familyChildren={familyChildren}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          inlineCropConfig={inlineCropConfig}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          memoryTextFont={memoryTextFont}
          garamond={garamond}
        />
      );
    case 'quote':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquetteQuote
          memory={memory}
          familyChildren={familyChildren}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          truncated={truncated}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          dm600={dm600}
          garamond={garamond}
          garamondIt={garamondIt}
          memoryTextFont={memoryTextFont}
        />
      );
    case 'audio':
    case 'video':
      if (!memory) return <View style={[styles.paper, { width, height }]} />;
      return (
        <MaquetteMediaQr
          kind={page.type}
          memory={memory}
          familyChildren={familyChildren}
          width={width}
          height={height}
          pad={pad}
          typoScale={typoScale}
          pageNum={pageNum}
          qrUrl={qrUrl}
          rotation={rotation}
          photoCrop={photoCrop}
          onRotate={onRotate}
          inlineCropConfig={inlineCropConfig}
          onRequestTextEdit={onRequestTextEdit}
          dm400={dm400}
          garamond={garamond}
          memoryTextFont={memoryTextFont}
        />
      );
    case 'back-cover':
      return (
        <View style={[styles.paper, { width, height }]}>
          <View style={styles.backCenter}>
            <Text
              style={[
                styles.backLine1,
                { fontSize: pdfPtToPreviewPx(13, width), lineHeight: pdfPtToPreviewPx(13 * 1.4, width) },
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              Chaque moment compte.
            </Text>
            <Text style={[styles.backLine2, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}>
              petitmo · vos souvenirs pour toujours
            </Text>
            <View style={[styles.backRule, { marginTop: pdfPtToPreviewPx(12, width), width: pdfMmToPreviewPxW(20, width) }]} />
          </View>
          <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
        </View>
      );
    default: {
      const _x: never = page;
      return _x;
    }
  }
}

export default memo(MaquetteBookPages);

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
  coverPhotoImgPxW,
  coverPhotoImgPxH,
  coverPhotoRenderKey,
  onPressCoverPhoto,
  inlineCropConfig,
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
  coverPhotoImgPxW?: number;
  coverPhotoImgPxH?: number;
  coverPhotoRenderKey?: string;
  inlineCropConfig?: InlineCropConfig;
  onPressTitle: () => void;
}) {
  const photoUri = coverPhotoUri?.trim() || child.photo_url?.trim() || null;
  /** Aligné PDF (`BOOK_COVER_PHOTO_HEIGHT_RATIO` = 142/216) : ~65,7 % de la hauteur page. */
  const imgH = height * (142 / 216);
  const y = new Date().getFullYear();
  const periodLine = bookYearLabel || `${y - 1} – ${y}`;

  const canPickCover = !!onPressCoverPhoto;
  const coverInline = buildInlineCropProps(inlineCropConfig, 'cover');
  const coverImgPxW = coverPhotoImgPxW ?? coverInline?.dpiMeta?.imgPxW;
  const coverImgPxH = coverPhotoImgPxH ?? coverInline?.dpiMeta?.imgPxH;

  const coverHasDims = (coverImgPxW ?? 0) > 0 && (coverImgPxH ?? 0) > 0;
  const coverUseInlineCrop = !!coverInline && coverHasDims;

  return (
    <View style={[styles.paper, styles.coverPaper, { width, height }]}>
      <View style={[styles.coverImgBlock, { height: imgH }]}>
        {photoUri ? (
          <View key={coverPhotoRenderKey ?? photoUri} style={StyleSheet.absoluteFill}>
            {coverUseInlineCrop ? (
              <BookPagePhotoFrame
                uri={photoUri}
                frameW={width}
                frameH={imgH}
                crop={coverPhotoCrop}
                inlineCrop={coverInline}
                coverMode
                imgPxW={coverImgPxW}
                imgPxH={coverImgPxH}
              />
            ) : canPickCover ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => onPressCoverPhoto?.()}
                accessibilityRole="button"
                accessibilityLabel="Choisir la photo de couverture"
              >
                <CroppedPhotoDisplay
                  uri={photoUri}
                  width={width}
                  height={imgH}
                  crop={coverPhotoCrop}
                  coverMode
                  imgPxW={coverImgPxW}
                  imgPxH={coverImgPxH}
                />
              </Pressable>
            ) : (
              <CroppedPhotoDisplay
                uri={photoUri}
                width={width}
                height={imgH}
                crop={coverPhotoCrop}
                coverMode
                imgPxW={coverImgPxW}
                imgPxH={coverImgPxH}
              />
            )}
          </View>
        ) : canPickCover ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => onPressCoverPhoto?.()}
            accessibilityRole="button"
            accessibilityLabel="Choisir la photo de couverture"
          >
            <View style={[styles.coverPh, { height: imgH }]} />
          </Pressable>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={[styles.coverTextBlock, { paddingHorizontal: pad, paddingTop: Math.round(8 * typoScale) }]}>
        <Pressable onPress={onPressTitle} accessibilityRole="button">
          <Text
            style={[
              styles.coverTitle,
              pdfCoverTitleStyle(width),
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
          >
            {titleLine}
          </Text>
        </Pressable>
        <Text style={[styles.coverYears, pdfCoverPeriodStyle(width), dm400 && { fontFamily: dm400 }]}>{periodLine}</Text>
        <View style={[styles.coverHairline, { marginTop: Math.round(16 * typoScale) }]} />
      </View>
      <CoverPageSpineOverlay />
    </View>
  );
}

function MaquettePhotoSimple({
  memory,
  memoryPhotoRef,
  familyChildren,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  rotation,
  photoCrop,
  onRotate,
  inlineCropConfig,
  onRequestTextEdit,
  dm400,
  memoryTextFont,
  garamond,
  variant,
}: {
  memory: Memory;
  memoryPhotoRef?: string | null;
  familyChildren: Child[];
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  inlineCropConfig?: InlineCropConfig;
  onRequestTextEdit: () => void;
  dm400?: string;
  memoryTextFont: string;
  garamond?: string;
  variant: PhotoFullVariant;
}) {
  const uri = useBookMaquettePhotoDisplayUri(memory, memoryPhotoRef);
  const caption = (memory.content ?? '').trim();
  const mediaPad = Math.round(pdfMmToPreviewPxW(PDF_MEDIA_TEXT_PAD_X_MM, width));
  const isFp = variant === 'FP';
  const imgH = isFp
    ? pdfMmToPreviewPxH(PHOTO_FULL_FP_IMAGE_HEIGHT_MM, height)
    : height * PHOTO_FULL_BAND_HEIGHT_RATIO;
  const footerH = isFp ? pdfMmToPreviewPxH(PHOTO_FULL_FP_FOOTER_MM, height) : undefined;
  const bookLoc = bookMaquetteLocationLabel(memory);
  const photoInline = buildInlineCropProps(inlineCropConfig, memory.id);

  const imageBand = isFp ? (
    <FullBleedBand width={width} bandH={imgH}>
      {(fw, fh) =>
        uri ? (
          <BookPagePhotoFrame
            uri={uri}
            frameW={fw}
            frameH={fh}
            crop={photoCrop}
            rotation={rotation}
            inlineCrop={photoInline}
            showRotateButton={!!photoInline}
            onRotate={onRotate}
            typoScale={typoScale}
            recyclingKey={`book-photo-${memory.id}`}
          />
        ) : null
      }
    </FullBleedBand>
  ) : (
    <VisualBand width={width} height={height} bandH={imgH}>
      {(fw, fh) =>
        uri ? (
          <BookPagePhotoFrame
            uri={uri}
            frameW={fw}
            frameH={fh}
            crop={photoCrop}
            rotation={rotation}
            inlineCrop={photoInline}
            showRotateButton={!!photoInline}
            onRotate={onRotate}
            typoScale={typoScale}
            recyclingKey={`book-photo-${memory.id}`}
          />
        ) : null
      }
    </VisualBand>
  );

  return (
    <View style={[styles.paper, { width, height }]}>
      {imageBand}
      <Pressable
        style={[
          styles.photoFooter,
          {
            paddingHorizontal: mediaPad,
            marginTop: isFp ? 0 : pdfMmToPreviewPxH(-PDF_MEDIA_QR_PULL_UP_MM, height),
            paddingTop: isFp ? pdfMmToPreviewPxH(3.7, height) : 0,
            paddingBottom: pdfMmToPreviewPxH(10, height),
            minHeight: 0,
            ...(footerH != null
              ? {
                  height: footerH,
                  flexBasis: footerH,
                  flexShrink: 0,
                  flexGrow: 0,
                  maxHeight: footerH,
                }
              : null),
          },
        ]}
        onPress={onRequestTextEdit}
        accessibilityRole="button"
      >
        <View style={[styles.photoDateLocRow, { gap: pdfMmToPreviewPxW(3, width) }]}>
          <Text style={[styles.photoDate, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}>
            {dateWithAgeCaps(memory, familyChildren)}
          </Text>
          {bookLoc ? (
            <Text
              style={[styles.photoLocationBook, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}
              numberOfLines={2}
            >
              {bookLoc}
            </Text>
          ) : null}
        </View>
        <View style={styles.mediaQrBodyWrap}>
          {caption.length > 0 ? (
            <Text
              style={[
                styles.photoCaption,
                pdfPhotoCaptionStyle(width),
                { marginTop: 0 },
                editorialTextStyle(garamond, memoryTextFont),
              ]}
            >
              {romanParagraphs(caption)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
    </View>
  );
}

function MaquettePhotoNote({
  memory,
  memoryPhotoRef,
  familyChildren,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  rotation,
  photoCrop,
  onRotate,
  inlineCropConfig,
  onRequestTextEdit,
  dm400,
  dm600,
  memoryTextFont,
  garamond,
}: {
  memory: Memory;
  memoryPhotoRef?: string | null;
  familyChildren: Child[];
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  inlineCropConfig?: InlineCropConfig;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  memoryTextFont: string;
  garamond?: string;
}) {
  const uri = useBookMaquettePhotoDisplayUri(memory, memoryPhotoRef);
  const legend = (memory.content ?? '').trim();
  const mediaPad = Math.round(pdfMmToPreviewPxW(PDF_MEDIA_TEXT_PAD_X_MM, width));
  const imgH = pdfMmToPreviewPxH(PHOTO_NOTE_BAND_HEIGHT_MM, height);
  const bookLoc = bookMaquetteLocationLabel(memory);
  const photoInline = buildInlineCropProps(inlineCropConfig, memory.id);

  return (
    <View style={[styles.paper, { width, height }]}>
      <VisualBand width={width} height={height} bandH={imgH}>
        {(fw, fh) =>
          uri ? (
            <BookPagePhotoFrame
              uri={uri}
              frameW={fw}
              frameH={fh}
              crop={photoCrop}
              rotation={rotation}
              inlineCrop={photoInline}
              showRotateButton={!!photoInline}
              onRotate={onRotate}
              typoScale={typoScale}
              recyclingKey={`book-photo-${memory.id}`}
            />
          ) : null
        }
      </VisualBand>
      <View style={[styles.page4TextBlock, { flex: 1, minHeight: 0 }]}>
        <Pressable
          onPress={onRequestTextEdit}
          accessibilityRole="button"
          style={{
            flex: 1,
            flexDirection: 'column',
            paddingHorizontal: mediaPad,
            marginTop: pdfMmToPreviewPxH(-PDF_MEDIA_QR_PULL_UP_MM, height),
            paddingTop: 0,
            paddingBottom: pdfMmToPreviewPxH(14, height),
          }}
        >
          <View
            style={[
              styles.page4MetaRow,
              { marginBottom: pdfMmToPreviewPxH(2, height), gap: pdfMmToPreviewPxW(3, width) },
            ]}
          >
            <Text style={[styles.page4Meta, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}>
              {dateWithAgeCaps(memory, familyChildren)}
            </Text>
            {bookLoc ? (
              <Text
                style={[styles.page4MetaLocation, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}
                numberOfLines={2}
              >
                {bookLoc}
              </Text>
            ) : null}
          </View>
          <View style={styles.mediaQrBodyWrap}>
            {legend.length > 0 ? (
              <Text
                style={[
                  styles.page4Body,
                  pdfPhotoNoteBodyStyle(width),
                  { marginTop: 0 },
                  editorialTextStyle(garamond, memoryTextFont),
                ]}
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                {romanParagraphs(legend)}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>
      <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
    </View>
  );
}


function MaquetteQuote({
  memory,
  familyChildren,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  truncated: _truncated,
  onRequestTextEdit,
  dm400,
  dm600,
  garamond,
  garamondIt,
  memoryTextFont,
}: {
  memory: Memory;
  familyChildren: Child[];
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  truncated: boolean;
  onRequestTextEdit: () => void;
  dm400?: string;
  dm600?: string;
  garamond?: string;
  garamondIt?: string;
  memoryTextFont: string;
}) {
  const layout = useMemo(() => resolveTextMemoryBookLayout(memory), [memory]);
  const { body, tier, variant, title } = layout;
  const centerBody = textMemoryBodyAlignCenter(tier, variant);
  const bodyTextAlign = textMemoryBodyTextAlign(tier, variant);
  const titleScaled = pdfTextMemoryTitleStyle(tier, width);
  const titleRuleW = pdfMmToPreviewPxW(PDF_TEXT_MEMORY_TITLE_RULE_MM[tier], width);
  const quotePadX = pdfQuotePagePadX(width);
  const quotePadY = pdfQuotePagePadY(tier, height);
  const columnMaxW = pdfTextMemoryColumnMaxWidthPx(tier, variant, width);

  return (
    <View style={[styles.paper, { width, height, flexDirection: 'column' }]}>
      <View
        style={[
          styles.quoteScreenCol,
          {
            flex: 1,
            minHeight: 0,
            paddingHorizontal: quotePadX,
            paddingTop: quotePadY,
            paddingBottom: quotePadY,
          },
        ]}
      >
        <TextMemoryQuoteHeader width={width} dm600={dm600} />
        <View
          style={{
            flex: 1,
            minHeight: 0,
            justifyContent: textMemoryMidJustify(variant, tier),
            paddingHorizontal: pdfMmToPreviewPxW(3, width),
          }}
        >
          <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
            <View style={{ width: '100%', alignItems: 'center' }}>
              <View style={{ width: '100%', maxWidth: columnMaxW }}>
                {variant === 'titled' && title ? (
                  <View
                    style={[
                      styles.textMemoryTitleBlock,
                      { marginBottom: textMemoryTitleBlockMargin(tier, height) },
                    ]}
                  >
                    <Text
                      style={[
                        styles.textMemoryTitle,
                        titleScaled,
                        garamond ? { fontFamily: garamond } : memoryTextStyle(memoryTextFont),
                        { textAlign: 'center' as const },
                      ]}
                      {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                    >
                      {title}
                    </Text>
                    <View
                      style={[
                        styles.textMemoryTitleRule,
                        { width: titleRuleW, marginTop: pdfMmToPreviewPxH(3, height) },
                      ]}
                    />
                  </View>
                ) : null}
                <TextMemoryBodyContent
                  body={body}
                  variant={variant}
                  tier={tier}
                  width={width}
                  height={height}
                  memoryTextFont={memoryTextFont}
                  garamond={garamond}
                  garamondIt={garamondIt}
                  centerBody={centerBody}
                  bodyTextAlign={bodyTextAlign}
                  columnMaxW={columnMaxW}
                />
              </View>
            </View>
          </Pressable>
        </View>
        <TextMemoryQuoteFooter
          memory={memory}
          familyChildren={familyChildren}
          width={width}
          height={height}
          dm400={dm400}
          onRequestTextEdit={onRequestTextEdit}
        />
      </View>
      <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
    </View>
  );
}

type MediaQrKind = 'audio' | 'video';

const BookMaquetteQrCode = memo(function BookMaquetteQrCode({
  value,
  size,
  color,
}: {
  value: string;
  size: number;
  color: string;
}) {
  return (
    <QRCode value={value} size={size} backgroundColor="#FFFFFF" color={color} />
  );
});

function MediaQrVisualFallback({
  kind,
  width,
  frameW,
  frameH,
  memoryId,
  typoScale,
}: {
  kind: MediaQrKind;
  width: number;
  frameW: number;
  frameH: number;
  memoryId: string;
  typoScale: number;
}) {
  const heights = useMemo(() => barHeightsFromId(memoryId), [memoryId]);
  const accent = kind === 'audio' ? VOCAL_BLUE : SAGE;
  const ringSize = Math.max(28, Math.round(Math.min(frameW, frameH) * 0.2));
  const waveContentW = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  const waveW = Math.min(frameW * 0.7, pdfMmToPreviewPxW(118, width));
  const waveH = Math.max(12, Math.round(18 * typoScale));

  return (
    <View style={[styles.mediaQrFallback, { width: frameW, height: frameH }]}>
      <View
        style={[
          styles.mediaQrFallbackRing,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderColor: `${accent}73`,
          },
        ]}
      >
        <Text style={[styles.mediaQrFallbackPlay, { fontSize: ringSize * 0.34, color: accent }]}>▶</Text>
      </View>
      {kind === 'audio' ? (
        <Svg
          width={waveW}
          height={waveH}
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
      ) : null}
    </View>
  );
}

/** Pictogramme type média (haut-parleur / caméra) — tracé identique au PDF (`mediaTypeIconSvg`). */
function MediaTypeIcon({
  kind,
  size,
  color,
}: {
  kind: MediaQrKind;
  size: number;
  color: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === 'audio' ? (
        <>
          <Path d="M11 5 6 9H2v6h4l5 4z" />
          <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      ) : (
        <>
          <Path d="M23 7 16 12 23 17Z" />
          <Path d="M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
        </>
      )}
    </Svg>
  );
}

/** Poster vidéo — local-first : pas de signature cloud si fichier sandbox. */
function MaquetteVideoPosterVisual({
  memory,
  frameW,
  frameH,
  fallback,
}: {
  memory: Memory;
  frameW: number;
  frameH: number;
  fallback: ReactNode;
}) {
  const raw = useBookVideoPosterDisplayUrl(memory).trim();
  if (!raw) return <>{fallback}</>;
  const baseUri = (raw.split('?')[0] ?? raw).trim();
  if (isDeviceLocalMediaUri(baseUri)) {
    return (
      <BookPagePhotoFrame
        uri={raw}
        frameW={frameW}
        frameH={frameH}
        recyclingKey={`book-video-poster-${memory.id}-${memory.updated_at ?? ''}`}
      />
    );
  }
  return (
    <MaquetteVideoPosterCloudFrame
      memoryId={memory.id}
      cacheKey={memory.updated_at ?? memory.poster_print_url ?? ''}
      raw={raw}
      frameW={frameW}
      frameH={frameH}
      fallback={fallback}
    />
  );
}

function MaquetteVideoPosterCloudFrame({
  memoryId,
  cacheKey,
  raw,
  frameW,
  frameH,
  fallback,
}: {
  memoryId: string;
  cacheKey?: string;
  raw: string;
  frameW: number;
  frameH: number;
  fallback: ReactNode;
}) {
  const signed = useSignedMediaUrl(raw);
  const uri = (signed ?? raw).trim();
  if (!uri) return <>{fallback}</>;
  return (
    <BookPagePhotoFrame
      uri={uri}
      frameW={frameW}
      frameH={frameH}
      recyclingKey={`book-video-poster-${memoryId}-${cacheKey ?? ''}`}
    />
  );
}

/** Page audio / vidéo : visuel (optionnel) + méta + légende + carte QR (bordure grise). */
function MaquetteMediaQr({
  kind,
  memory,
  familyChildren,
  width,
  height,
  pad,
  typoScale,
  pageNum,
  qrUrl,
  rotation,
  photoCrop,
  onRotate,
  inlineCropConfig,
  onRequestTextEdit,
  dm400,
  garamond,
  memoryTextFont,
}: {
  kind: MediaQrKind;
  memory: Memory;
  familyChildren: Child[];
  width: number;
  height: number;
  pad: number;
  typoScale: number;
  pageNum: number;
  qrUrl: string;
  rotation: number;
  photoCrop?: PhotoCrop;
  onRotate: () => void;
  inlineCropConfig?: InlineCropConfig;
  onRequestTextEdit: () => void;
  dm400?: string;
  garamond?: string;
  memoryTextFont: string;
}) {
  const captionRaw = clampMediaBookCaption((memory.content ?? '').trim());
  const mediaPad = Math.round(pdfMmToPreviewPxUniform(PDF_MEDIA_TEXT_PAD_X_MM, width, height));
  const qrCard = pdfMediaQrCardLayoutPx(width, height);
  const photoInline = kind === 'audio' ? buildInlineCropProps(inlineCropConfig, memory.id) : undefined;
  const voiceVisualUri =
    kind === 'audio'
      ? photoInline
        ? getVoiceCoverUriForBookEditorDisplay(memory)
        : getVoiceCoverUriForBookPreview(memory)
      : '';
  const imgH = pdfMmToPreviewPxH(PHOTO_NOTE_BAND_HEIGHT_MM, height);
  const bookLoc = bookMaquetteLocationLabel(memory);
  const bodyGap = Math.round(pdfMmToPreviewPxUniform(PDF_MEDIA_QR_GAP_MM, width, height));
  const typeLabel = kind === 'audio' ? 'Audio' : 'Video';
  const qrHint = kind === 'audio' ? 'Scanner pour écouter' : 'Scanner pour visionner';

  return (
    <View style={[styles.paper, { width, height }]}>
      <VisualBand width={width} height={height} bandH={imgH}>
        {(fw, fh) => {
          const fallback = (
            <MediaQrVisualFallback
              kind={kind}
              width={width}
              frameW={fw}
              frameH={fh}
              memoryId={memory.id}
              typoScale={typoScale}
            />
          );
          if (kind === 'video') {
            return (
              <MaquetteVideoPosterVisual
                memory={memory}
                frameW={fw}
                frameH={fh}
                fallback={fallback}
              />
            );
          }
          if (voiceVisualUri) {
            return (
              <BookPagePhotoFrame
                uri={voiceVisualUri}
                frameW={fw}
                frameH={fh}
                crop={photoCrop}
                rotation={rotation}
                inlineCrop={photoInline}
                showRotateButton={!!photoInline}
                onRotate={onRotate}
                typoScale={typoScale}
                recyclingKey={`book-voice-${memory.id}`}
              />
            );
          }
          return fallback;
        }}
      </VisualBand>
      <View
        style={[
          styles.audioBelowPhoto,
          {
            marginTop: pdfMmToPreviewPxH(-PDF_MEDIA_QR_PULL_UP_MM, height),
            paddingTop: 0,
            paddingBottom: pdfMmToPreviewPxH(14, height),
          },
        ]}
      >
        <View
          style={[
            styles.audioMetaRow,
            {
              paddingHorizontal: mediaPad,
              paddingBottom: pdfMmToPreviewPxH(2, height),
            },
          ]}
        >
          <View
            style={[
              styles.page4MetaRow,
              { marginBottom: 0, gap: pdfMmToPreviewPxW(3, width), width: '100%' },
            ]}
          >
            <Text style={[styles.page4Meta, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}>
              {dateWithAgeCaps(memory, familyChildren)}
            </Text>
            {bookLoc ? (
              <Text
                style={[styles.page4MetaLocation, pdfLabelStyle(width), dm400 && { fontFamily: dm400 }]}
                numberOfLines={2}
              >
                {bookLoc}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.mediaQrSep, { marginHorizontal: mediaPad }]} />
        <View style={styles.mediaQrBodyWrap}>
          <View
            style={[
              styles.mediaQrBodyRow,
              {
                paddingHorizontal: mediaPad,
                gap: bodyGap,
              },
            ]}
          >
            <Pressable
              onPress={onRequestTextEdit}
              accessibilityRole="button"
              style={styles.mediaQrCaptionCol}
            >
              {captionRaw.length > 0 ? (
                <Text
                  style={[
                    styles.mediaQrCaption,
                    pdfMediaCaptionStyle(width),
                    editorialTextStyle(garamond, memoryTextFont),
                  ]}
                  {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                >
                  {romanParagraphs(captionRaw)}
                </Text>
              ) : null}
            </Pressable>
            <View
              style={[
                styles.mediaQrCard,
                {
                  width: qrCard.cardW,
                  minWidth: qrCard.cardW,
                  maxWidth: qrCard.cardW,
                  height: qrCard.cardH,
                  minHeight: qrCard.cardH,
                  maxHeight: qrCard.cardH,
                  padding: qrCard.cardPad,
                  borderRadius: qrCard.cardRadius,
                  borderColor: PDF_MEDIA_QR_CARD_BORDER_COLOR,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.45}
                ellipsizeMode="tail"
                style={[
                  styles.mediaQrCardHint,
                  {
                    fontSize: qrCard.hintFontSize,
                    lineHeight: qrCard.hintLineH,
                    height: qrCard.hintLineH,
                  },
                  dm400 && { fontFamily: dm400 },
                ]}
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                {qrHint}
              </Text>
              <View
                style={[
                  styles.mediaQrCardQr,
                  {
                    marginTop: qrCard.qrMarginV,
                    width: qrCard.qrSize,
                    height: qrCard.qrSize,
                    alignSelf: 'center',
                  },
                ]}
              >
                {qrUrl.trim().length > 0 ? (
                  <BookMaquetteQrCode value={qrUrl} size={qrCard.qrSize} color={INK} />
                ) : (
                  <View
                    style={{
                      width: qrCard.qrSize,
                      height: qrCard.qrSize,
                      borderRadius: 4,
                      backgroundColor: '#EEEEEE',
                    }}
                  />
                )}
              </View>
              <View
                style={[
                  styles.mediaQrCardType,
                  {
                    marginTop: qrCard.qrMarginV,
                    height: qrCard.typeRowH,
                    minHeight: qrCard.typeRowH,
                    maxHeight: qrCard.typeRowH,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.mediaQrCardTypeLabel,
                    {
                      fontSize: qrCard.typeLabelFontSize,
                      lineHeight: qrCard.typeRowH,
                      height: qrCard.typeRowH,
                    },
                    dm400 && { fontFamily: dm400 },
                  ]}
                  {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                >
                  {typeLabel}
                </Text>
                <View
                  style={{
                    width: qrCard.typeIconSize,
                    height: qrCard.typeIconSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <MediaTypeIcon
                    kind={kind}
                    size={qrCard.typeIconSize}
                    color={PDF_MEDIA_QR_MUTED_COLOR}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
      <Folio n={pageNum} dm400={dm400} pageWidthPx={width} pageHeightPx={height} />
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
    position: 'relative',
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
    color: '#636366',
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
    color: '#636366',
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
    color: INK,
    textAlign: 'justify' as const,
  },
  textMemoryTitleBlock: {
    alignItems: 'center',
  },
  textMemoryTitle: {
    color: INK,
    fontWeight: '400',
  },
  textMemoryTitleRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignSelf: 'center',
  },
  textMemoryGuillemetRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  textMemoryDropCapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  textMemoryDropCap: {
    color: INK,
    marginRight: 4,
    marginTop: 2,
    fontWeight: '400',
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
  quoteFooter: { width: '100%', flexShrink: 0 },
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
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  mediaQrSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: LINE,
    flexShrink: 0,
  },
  mediaQrBodyWrap: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
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
  mediaQrBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  mediaQrCaptionCol: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  mediaQrCaption: {
    color: INK,
    textAlign: 'left' as const,
  },
  mediaQrCard: {
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
    overflow: 'hidden',
  },
  mediaQrCardHint: {
    color: PDF_MEDIA_QR_MUTED_COLOR,
    textAlign: 'left' as const,
  },
  mediaQrCardQr: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mediaQrCardType: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mediaQrCardTypeLabel: {
    color: PDF_MEDIA_QR_MUTED_COLOR,
    flex: 1,
    minWidth: 0,
    marginRight: 2,
  },
  audioQrCenter: {
    alignItems: 'center',
    marginTop: 8,
  },
  audioPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
    paddingTop: 6,
  },
  audioBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    marginTop: 'auto',
  },
  audioWaveColNarrow: {
    flexGrow: 0,
    flexShrink: 0,
  },
  audioQrCorner: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
    flexShrink: 0,
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
    fontSize: 12,
    color: VOCAL_BLUE,
    marginLeft: 1,
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
  mediaQrFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    gap: 10,
  },
  mediaQrFallbackRing: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  mediaQrFallbackPlay: {
    marginLeft: 2,
    lineHeight: undefined,
  },
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

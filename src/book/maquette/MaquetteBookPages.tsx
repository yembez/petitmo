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
import { formatDuration } from '@/utils/date';
import { splitPhotoNoteTitleBody, splitVideoTitleBody } from '@/src/book/bookTextParts';
import type { PhotoCrop } from '@/src/book/photoCrop';
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

const INK = '#1C1C1E';
const MUTED = '#AEAEB2';
const SAGE = '#6B8F7E';
const VOCAL_BLUE = '#5C8FA6';
const LINE = 'rgba(0,0,0,0.08)';

function dateFrCaps(iso: string): string {
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function dateTimeFrCaps(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const t = time.replace(':', 'H').replace(/\s/g, '');
  return `${date} · ${t}`.toUpperCase();
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

function Folio({ n, dm400 }: { n: number; dm400?: string }) {
  return (
    <Text style={[styles.folio, dm400 ? { fontFamily: dm400 } : null]}>{n}</Text>
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

  switch (page.type) {
    case 'cover':
      return (
        <MaquetteCover
          child={page.child}
          width={width}
          height={height}
          pad={pad}
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
          <Pressable style={styles.chapterCenter} onPress={onRequestTextEdit} accessibilityRole="button">
            <Text style={[styles.chapterMonth, dm400 && { fontFamily: dm400 }]}>
              {monthYearCaps(page.month)}
            </Text>
            <Text
              style={[
                styles.chapterTitle,
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              {chapterDisplayTitle ?? 'Notre histoire'}
            </Text>
            <View style={styles.chapterLine} />
            <Text style={[styles.chapterSub, dm400 && { fontFamily: dm400 }]}>
              Chapitre {page.chapterNum}
            </Text>
          </Pressable>
          <Folio n={pageNum} dm400={dm400} />
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
                garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
              ]}
            >
              Chaque moment compte.
            </Text>
            <Text style={[styles.backLine2, dm400 && { fontFamily: dm400 }]}>
              petitmo · vos souvenirs pour toujours
            </Text>
            <View style={styles.backRule} />
          </View>
          <Folio n={pageNum} dm400={dm400} />
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
  const imgH = height * 0.68;
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
      <View style={[styles.coverTextBlock, { paddingHorizontal: pad }]}>
        <Pressable onPress={onPressTitle} accessibilityRole="button">
          <Text
            style={[
              styles.coverTitle,
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
          >
            {titleLine}
          </Text>
        </Pressable>
        <Text style={[styles.coverYears, dm400 && { fontFamily: dm400 }]}>{periodLine}</Text>
        <View style={styles.coverHairline} />
      </View>
    </View>
  );
}

function MaquettePhotoSimple({
  memory,
  width,
  height,
  pad,
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
            <Pressable style={styles.rotateOverlayBtn} onPress={onRotate} accessibilityLabel="Pivoter la photo">
              <Text style={styles.rotateOverlayIcon}>↻</Text>
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
        <Text style={[styles.photoDate, dm400 && { fontFamily: dm400 }]}>{dateFrCaps(memory.created_at)}</Text>
        {caption.length > 0 ? (
          <Text
            style={[
              styles.photoCaption,
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
            numberOfLines={3}
          >
            {romanParagraphs(caption)}
          </Text>
        ) : null}
      </Pressable>
      <Folio n={pageNum} dm400={dm400} />
    </View>
  );
}

function MaquettePhotoNote({
  memory,
  width,
  height,
  pad,
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
  // Dans le viewer, sous la photo on n'affiche pas "titre + corps" : seulement une légende.
  // On évite aussi le fallback "Sans titre" lié au découpage.
  const legend = (memory.content ?? '').trim();
  const imgH = height * 0.6; // 3/5 de la page
  const MAX_PHOTO_NOTE_CHARS = 420;
  const legendLimited = legend.length > MAX_PHOTO_NOTE_CHARS ? `${legend.slice(0, MAX_PHOTO_NOTE_CHARS).trimEnd()}…` : legend;

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
            <Pressable style={styles.rotateOverlayBtn} onPress={onRotate} accessibilityLabel="Pivoter la photo">
              <Text style={styles.rotateOverlayIcon}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={[styles.page4TextBlock, { overflow: 'hidden' }]}>
        <Pressable
          onPress={onRequestTextEdit}
          accessibilityRole="button"
          style={[styles.page4ScrollContent, { paddingHorizontal: pad, paddingBottom: 40 }]}
        >
          <Text style={[styles.page4Meta, dm400 && { fontFamily: dm400 }]}>
            {dateTimeFrCaps(memory.created_at)}
          </Text>
          {legendLimited.length > 0 ? (
            <Text
              style={[
                styles.page4Body,
                garamondIt ? { fontFamily: garamondIt } : dm400 ? { fontFamily: dm400 } : null,
              ]}
            >
              {romanParagraphs(legendLimited)}
            </Text>
          ) : null}
        </Pressable>
      </View>
      <Folio n={pageNum} dm400={dm400} />
    </View>
  );
}


function MaquetteQuote({
  memory,
  width,
  height,
  pad,
  pageNum,
  truncated,
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

  const time = new Date(memory.created_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const bodyStyle =
    fitLevel === 2 ? styles.quoteBodyFit2 : fitLevel === 1 ? styles.quoteBodyFit1 : styles.quoteBody;

  return (
    <Pressable
      style={[styles.paper, { width, height }]}
      onPress={onRequestTextEdit}
      accessibilityRole="button"
    >
      <View style={[styles.quoteScreenCol, { paddingHorizontal: pad }]}>
        <View style={styles.quoteHeader}>
          <View style={styles.quoteHeaderLeft}>
            <View style={styles.sageDot} />
            <Text style={[styles.quoteLabel, dm600 ? { fontFamily: dm600 } : { fontWeight: '600' }]}>
              Petits mots
            </Text>
          </View>
        </View>
        <View style={styles.quoteMid}>
          <Text
            style={[
              styles.quoteMark,
              fitLevel === 2 ? styles.quoteMarkFit2 : fitLevel === 1 ? styles.quoteMarkFit1 : null,
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
          >
            {'\u201C'}
          </Text>
          <View
            style={{
              paddingHorizontal: 8,
              overflow: 'hidden',
            }}
          >
            <Text
              style={[
                bodyStyle,
                garamondIt ? { fontFamily: garamondIt } : dmItalic ? { fontFamily: dmItalic } : { fontStyle: 'italic' },
              ]}
            >
              {romanParagraphs(body)}
            </Text>
          </View>
        </View>
        <View style={styles.quoteFooter}>
          <View style={styles.quoteRuleRow}>
            <View style={styles.quoteRuleSeg} />
            <View style={styles.quoteRuleDot} />
            <View style={styles.quoteRuleSeg} />
          </View>
          <Text style={[styles.quoteTime, dm400 && { fontFamily: dm400 }]}>
            {new Date(memory.created_at).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}{' '}
            · {time}
          </Text>
        </View>
      </View>
      <Folio n={pageNum} dm400={dm400} />
    </Pressable>
  );
}

function MaquetteAudio({
  memory,
  width,
  height,
  pad,
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
  const waveW = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  const titleRaw = (memory.content ?? '').trim();
  const qrSize = Math.min(120, width * 0.28);
  const coverUri = getVoiceCoverUriForBookPreview(memory);
  const imgH = height * 0.6;
  const ringSize = 56;
  const playerGap = 14;
  const waveSvgW = Math.max(96, width - 2 * pad - ringSize - playerGap);

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
            <Pressable style={styles.rotateOverlayBtn} onPress={onRotate} accessibilityLabel="Pivoter la photo">
              <Text style={styles.rotateOverlayIcon}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={styles.audioBelowPhoto}>
        <View style={[styles.audioMetaRow, { paddingHorizontal: pad }]}>
          <View style={styles.quoteHeaderLeft}>
            <View style={styles.vocalDot} />
            <Text style={[styles.vocalLabel, dm600 && { fontFamily: dm600 }]}>Vocal</Text>
          </View>
          <Text style={[styles.page4Meta, dm400 && { fontFamily: dm400 }]}>{dateTimeFrCaps(memory.created_at)}</Text>
        </View>
        <View style={[styles.audioLower, { paddingHorizontal: pad, paddingBottom: 48 }]}>
          <ScrollView
            style={styles.audioScroll}
            contentContainerStyle={styles.audioScrollInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
              {titleRaw.length > 0 ? (
                <Text
                  style={[
                    styles.page4Body,
                    { marginTop: 0 },
                    garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
                  ]}
                >
                  {romanParagraphs(titleRaw)}
                </Text>
              ) : null}
              <View style={styles.audioQrCenter}>
                <QRCode value={qrUrl} size={qrSize} backgroundColor="#FFFFFF" color={INK} />
                <Text style={[styles.audioQrHint, dm400 && { fontFamily: dm400 }]}>Scanner pour écouter</Text>
              </View>
            </Pressable>
          </ScrollView>
          <View style={styles.audioPlayerRow}>
            <View style={styles.audioRingInline}>
              <Text style={styles.playGlyphInline}>▶</Text>
            </View>
            <View style={styles.audioWaveCol}>
              <Svg width={waveSvgW} height={24} viewBox={`0 0 ${waveW} 24`} preserveAspectRatio="xMidYMid meet">
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
                <Text style={[styles.audioDur, dm400 && { fontFamily: dm400 }]}>0:00</Text>
                <Text style={[styles.audioDur, dm400 && { fontFamily: dm400 }]}>{durLabel}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
      <Folio n={pageNum} dm400={dm400} />
    </View>
  );
}

function MaquetteVideo({
  memory,
  width,
  height,
  pad,
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

  return (
    <View style={[styles.paper, { width, height }]}>
      <View style={[styles.photoImgWrap, { height: imgH }]}>
        {posterImageUri ? (
          <Image source={{ uri: posterImageUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[styles.coverPh, { height: imgH }]} />
        )}
      </View>
      <View style={{ flex: 1, overflow: 'hidden', paddingHorizontal: pad, paddingTop: 20 }}>
        <Pressable onPress={onRequestTextEdit} accessibilityRole="button">
          <Text style={[styles.noteMeta, dm400 && { fontFamily: dm400 }]}>
            {dateTimeFrCaps(memory.created_at)}
          </Text>
          <Text
            style={[
              styles.videoTitle,
              dm600 && { fontFamily: dm600 },
              garamondIt ? { fontFamily: garamondIt } : { fontStyle: 'italic' },
            ]}
          >
            {title}
          </Text>
          <Text
            style={[
              styles.videoSub,
              garamondIt ? { fontFamily: garamondIt } : dm400 ? { fontFamily: dm400 } : null,
            ]}
          >
            {romanParagraphs(sub)}
          </Text>
        </Pressable>
        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <QRCode value={qrUrl} size={Math.min(100, width * 0.26)} backgroundColor="#FFFFFF" color={INK} />
          <Text style={[styles.audioQrHint, dm400 && { fontFamily: dm400 }]}>Scanner pour regarder</Text>
        </View>
      </View>
      <Folio n={pageNum} dm400={dm400} />
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
  page4Meta: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.2,
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
  },
  photoDate: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.3,
  },
  photoCaption: {
    marginTop: 6,
    fontSize: 17,
    color: INK,
    textAlign: 'justify' as const,
  },
  noteMeta: {
    fontSize: 11,
    color: MUTED,
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
  quoteTime: {
    alignSelf: 'flex-end',
    textAlign: 'right',
    marginTop: 8,
    fontSize: 11,
    color: MUTED,
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
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  audioLower: {
    flex: 1,
    minHeight: 0,
    paddingTop: 12,
  },
  audioScroll: {
    flex: 1,
    minHeight: 0,
    flexGrow: 1,
  },
  audioScrollInner: {
    flexGrow: 1,
    paddingBottom: 10,
  },
  audioQrCenter: {
    alignItems: 'center',
    marginTop: 18,
  },
  audioPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 14,
    paddingTop: 10,
  },
  audioRingInline: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(92,143,166,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyphInline: {
    fontSize: 18,
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
    marginTop: 6,
  },
  audioDur: { fontSize: 10, color: MUTED },
  audioQrHint: { marginTop: 8, fontSize: 11, color: MUTED },
  videoTitle: { marginTop: 10, fontSize: 18, color: INK },
  videoSub: { marginTop: 10, fontSize: 14, color: '#6B7280', lineHeight: 22, textAlign: 'justify' as const },
  rotateOverlayBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
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

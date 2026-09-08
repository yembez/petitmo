import { memo, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type { PhotoCrop } from '@/src/book/photoCrop';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { bookCoverThemeForId } from '@/constants/bookCoverColors';
import { BookBrowseLeaf } from '@/components/BookBrowseLeaf';
import { PORTRAIT_BROWSE_ROW_GAP, PORTRAIT_BROWSE_SPINE_W, type BookSpreadRow } from '@/utils/bookSpreadLayout';
import {
  bookPortraitPerfMemoBreak,
  bookPortraitPerfRender,
  diffPortraitRowProps,
} from '@/utils/bookPortraitSpreadPerf';
import { scale, verticalScale } from '@/utils/responsive';

/**
 * Bords couverture autour d’une double page ouverte (mode browse portrait).
 * Liseré discret : les bandes haute / basse sont nettement plus fines que les latérales.
 */
/** Bandes verticales (gauche / droite). */
const COVER_EDGE_W = scale(6);
/** Bandes horizontales (haut / bas). */
const COVER_RIM_H = scale(3);

type PageRow = { page: BookPage; pageNum: number; folio: number | null };

export type BookPortraitSpreadRowProps = {
  item: BookSpreadRow;
  pageW: number;
  pageH: number;
  child: Child;
  familyChildren: Child[];
  coverYearLabel: string;
  coverColorId?: string | null;
  coverTitleLine: string | null;
  chapterTitleLine: string | null;
  coverPhotoBrowseUri: string | null;
  cropDpiMetaCover?: { imgPxW: number; imgPxH: number };
  cropDpiMetaByKey?: Record<string, { imgPxW: number; imgPxH: number }>;
  photoCrops: Record<string, PhotoCrop>;
  rotations: Record<string, number>;
  typography: BookMaquetteTypography;
  folioFont?: string;
  memoryPhotoRefs?: Record<string, string>;
  getMemoryForPage: (page: BookPage) => Memory | null;
  getPrefetchUri: (row: PageRow) => string | null;
  onOpenEditor: (pageIndex: number) => void;
  onPrefetchImage: (uri: string | null) => void;
  /** Fingerprint médias (posters / updated_at) — force re-render après save poster vidéo. */
  mediaRevision?: string;
};

function BookPortraitSpreadRowInner({
  item,
  pageW,
  pageH,
  child,
  familyChildren,
  coverYearLabel,
  coverColorId,
  coverTitleLine,
  chapterTitleLine,
  coverPhotoBrowseUri,
  cropDpiMetaCover,
  cropDpiMetaByKey,
  photoCrops,
  rotations,
  typography,
  folioFont,
  memoryPhotoRefs,
  getMemoryForPage,
  getPrefetchUri,
  onOpenEditor,
  onPrefetchImage,
  mediaRevision,
}: BookPortraitSpreadRowProps) {
  const spreadIndex = item.spreadIndex;
  const leftPage = item.left?.pageNum;
  const rightPage = item.right?.pageNum;
  bookPortraitPerfRender('BookPortraitSpreadRow', { spreadIndex, leftPage, rightPage });

  const isPair = Boolean(item.left && item.right);
  const coverTheme = useMemo(() => bookCoverThemeForId(coverColorId), [coverColorId]);

  const renderLeaf = (row: PageRow) => {
    const mem = getMemoryForPage(row.page);
    const dpi = mem ? cropDpiMetaByKey?.[mem.id] : undefined;
    return (
      <BookBrowseLeaf
        row={row}
        pageW={pageW}
        pageH={pageH}
        child={child}
        familyChildren={familyChildren}
        memory={mem}
        coverYearLabel={coverYearLabel}
        coverColorId={coverColorId}
        coverTitleLine={coverTitleLine}
        chapterTitleLine={chapterTitleLine}
        coverPhotoBrowseUri={coverPhotoBrowseUri}
        cropDpiMetaCover={cropDpiMetaCover}
        photoCrops={photoCrops}
        rotations={rotations}
        typography={typography}
        folioFont={folioFont}
        memoryPhotoRef={
          mem
            ? ((row.page.type === 'photo-full' || row.page.type === 'photo-note'
                ? row.page.photoRef
                : undefined) ??
              memoryPhotoRefs?.[mem.id])
            : undefined
        }
        memoryImgPxW={dpi?.imgPxW}
        memoryImgPxH={dpi?.imgPxH}
        prefetchUri={getPrefetchUri(row)}
        onOpenEditor={onOpenEditor}
        onPrefetchImage={onPrefetchImage}
        mediaRevision={mediaRevision}
      />
    );
  };

  if (isPair) {
    return (
      <View style={styles.browseRow}>
        <View style={styles.browsePairWrap}>
          {/**
           * Plan couverture derrière les pages seulement (pas les folios).
           * Déborde dans le padding latéral / l’espace folio pour simuler le carton ouvert.
           */}
          <View
            pointerEvents="none"
            style={[
              styles.coverBoard,
              {
                backgroundColor: coverTheme.paper,
                top: -COVER_RIM_H,
                left: -COVER_EDGE_W,
                width: pageW * 2 + COVER_EDGE_W * 2,
                height: pageH + COVER_RIM_H * 2,
              },
            ]}
          >
            <View
              style={[styles.coverBoardInnerLine, { borderColor: coverTheme.line }]}
              pointerEvents="none"
            />
          </View>
          <View style={styles.browsePairRow}>
            {item.left ? renderLeaf(item.left) : null}
            {item.right ? renderLeaf(item.right) : null}
          </View>
          <LinearGradient
            colors={[
              'rgba(0,0,0,0)',
              'rgba(0,0,0,0.14)',
              'rgba(0,0,0,0.30)',
              'rgba(0,0,0,0.14)',
              'rgba(0,0,0,0)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            pointerEvents="none"
            style={[
              styles.browseSpine,
              { height: pageH, width: PORTRAIT_BROWSE_SPINE_W, left: pageW - PORTRAIT_BROWSE_SPINE_W / 2 },
            ]}
          >
            <View style={styles.browseSpineLine} pointerEvents="none" />
          </LinearGradient>
        </View>
      </View>
    );
  }

  const only = item.left ?? item.right;
  if (!only) return <View style={styles.browseRow} />;

  if (only.page.type === 'cover') {
    return (
      <View style={[styles.browseRow, styles.browseRowSingle]}>
        <View style={styles.browsePairWrap}>
          {/**
           * Livre fermé : pas de liseré (un plat de couverture n’en montre pas), mais
           * un vrai volume — deux calques d’ombre au format exact de la page.
           * Diffusion large d’abord, contact serré ensuite : RN ne gère qu’une ombre
           * par vue, on les empile.
           */}
          <View
            pointerEvents="none"
            style={[
              styles.coverBoard,
              styles.coverSoloAmbient,
              { backgroundColor: coverTheme.paper, top: 0, left: 0, width: pageW, height: pageH },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.coverBoard,
              styles.coverSoloContact,
              { backgroundColor: coverTheme.paper, top: 0, left: 0, width: pageW, height: pageH },
            ]}
          />
          <View style={styles.browsePairRow}>{renderLeaf(only)}</View>
        </View>
      </View>
    );
  }

  return <View style={[styles.browseRow, styles.browseRowSingle]}>{renderLeaf(only)}</View>;
}

function portraitRowPropsEqual(a: BookPortraitSpreadRowProps, b: BookPortraitSpreadRowProps): boolean {
  const changed = diffPortraitRowProps(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>,
  );
  if (changed.length > 0) {
    bookPortraitPerfMemoBreak('BookPortraitSpreadRow', changed);
    return false;
  }
  return true;
}

export const BookPortraitSpreadRow = memo(BookPortraitSpreadRowInner, portraitRowPropsEqual);

const styles = StyleSheet.create({
  browseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    /** Doit matcher `computePortraitBrowseLayout().rowHeight` (gap inclus dans getItemLayout). */
    marginBottom: PORTRAIT_BROWSE_ROW_GAP,
  },
  browseRowSingle: {
    justifyContent: 'center',
  },
  browsePairWrap: {
    position: 'relative',
  },
  browsePairRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 1,
  },
  coverBoard: {
    position: 'absolute',
    zIndex: 0,
    /**
     * Ombre portée extérieure : le carton ouvert repose sur le fond.
     * Plus large et plus douce que celle des pages (`browseLeafShadow`) pour rester dessous.
     * Android : pas d’`elevation` — elle primerait sur `zIndex` et ferait passer le plan
     * couverture par-dessus les pages. Ombre iOS / web uniquement.
     */
    ...Platform.select({
      android: {},
      default: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(6) },
        shadowOpacity: 0.2,
        shadowRadius: scale(16),
      },
    }),
  },
  /** Couverture seule : diffusion large, le livre fermé décolle du fond. */
  coverSoloAmbient: {
    ...Platform.select({
      android: {},
      default: {
        shadowOffset: { width: 0, height: verticalScale(14) },
        shadowOpacity: 0.26,
        shadowRadius: scale(24),
      },
    }),
  },
  /** Couverture seule : ombre de contact, ancre le bas du livre. */
  coverSoloContact: {
    ...Platform.select({
      android: {},
      default: {
        shadowOffset: { width: 0, height: verticalScale(3) },
        shadowOpacity: 0.22,
        shadowRadius: scale(6),
      },
    }),
  },
  coverBoardInnerLine: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
  },
  browseSpine: {
    position: 'absolute',
    top: 0,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseSpineLine: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type { PhotoCrop } from '@/src/book/photoCrop';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { BookBrowseLeaf } from '@/components/BookBrowseLeaf';
import { PORTRAIT_BROWSE_ROW_GAP, PORTRAIT_BROWSE_SPINE_W, type BookSpreadRow } from '@/utils/bookSpreadLayout';
import {
  bookPortraitPerfMemoBreak,
  bookPortraitPerfRender,
  diffPortraitRowProps,
} from '@/utils/bookPortraitSpreadPerf';

type PageRow = { page: BookPage; pageNum: number; folio: number | null };

export type BookPortraitSpreadRowProps = {
  item: BookSpreadRow;
  pageW: number;
  pageH: number;
  child: Child;
  familyChildren: Child[];
  coverYearLabel: string;
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
  },
  browseSpine: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseSpineLine: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});

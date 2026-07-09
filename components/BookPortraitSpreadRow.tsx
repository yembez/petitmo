import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type { PhotoCrop } from '@/src/book/photoCrop';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { BookBrowseLeaf } from '@/components/BookBrowseLeaf';
import { PORTRAIT_BROWSE_SPINE_W, type BookSpreadRow } from '@/utils/bookSpreadLayout';
import {
  bookPortraitPerfMemoBreak,
  bookPortraitPerfRender,
  diffPortraitRowProps,
} from '@/utils/bookPortraitSpreadPerf';

type PageRow = { page: BookPage; pageNum: number };

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
  photoCrops: Record<string, PhotoCrop>;
  rotations: Record<string, number>;
  typography: BookMaquetteTypography;
  folioFont?: string;
  getMemoryForPage: (page: BookPage) => Memory | null;
  getPrefetchUri: (row: PageRow) => string | null;
  onOpenEditor: (pageIndex: number) => void;
  onPrefetchImage: (uri: string | null) => void;
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
  photoCrops,
  rotations,
  typography,
  folioFont,
  getMemoryForPage,
  getPrefetchUri,
  onOpenEditor,
  onPrefetchImage,
}: BookPortraitSpreadRowProps) {
  const spreadIndex = item.spreadIndex;
  const leftPage = item.left?.pageNum;
  const rightPage = item.right?.pageNum;
  bookPortraitPerfRender('BookPortraitSpreadRow', { spreadIndex, leftPage, rightPage });

  const isPair = Boolean(item.left && item.right);

  const renderLeaf = (row: PageRow) => {
    const mem = getMemoryForPage(row.page);
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
        prefetchUri={getPrefetchUri(row)}
        onOpenEditor={onOpenEditor}
        onPrefetchImage={onPrefetchImage}
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
          <View
            pointerEvents="none"
            style={[
              styles.browseSpine,
              { height: pageH, width: PORTRAIT_BROWSE_SPINE_W, left: pageW - PORTRAIT_BROWSE_SPINE_W / 2 },
            ]}
          >
            <View style={styles.browseSpineShadeLeft} />
            <View style={styles.browseSpineLine} />
            <View style={styles.browseSpineShadeRight} />
          </View>
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
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  browseSpineShadeLeft: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  browseSpineLine: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  browseSpineShadeRight: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
});

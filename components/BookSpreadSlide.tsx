import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type { PhotoCrop } from '@/src/book/photoCrop';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { useBookQrUrl } from '@/lib/bookQrTokenStore';
import MaquetteBookPages from '@/src/book/maquette/MaquetteBookPages';
import { BookPreviewZoomWrap } from '@/components/BookPreviewZoomWrap';
import { computeLandscapeSpreadLayout, type BookSpreadRow } from '@/utils/bookSpreadLayout';

type PageRow = { page: BookPage; pageNum: number };

function memoryForMaquette(page: BookPage, memory: Memory | null): Memory | null {
  switch (page.type) {
    case 'cover':
    case 'chapter':
    case 'back-cover':
      return null;
    case 'photo-full':
    case 'photo-note':
    case 'quote':
    case 'audio':
    case 'video':
      return memory;
    default:
      return null;
  }
}

type BookSpreadSlideProps = {
  item: BookSpreadRow;
  screenWidth: number;
  availHLandscape: number;
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
  memoryPhotoRefs?: Record<string, string>;
  getMemoryForPage: (page: BookPage) => Memory | null;
  onRequestTextEditForPage: (pageNum: number) => void;
};

function SpreadMaquettePage({
  row,
  dims,
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
  memoryPhotoRefs,
  getMemoryForPage,
  onRequestTextEditForPage,
}: {
  row: PageRow;
  dims: { width: number; height: number };
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
  memoryPhotoRefs?: Record<string, string>;
  getMemoryForPage: (page: BookPage) => Memory | null;
  onRequestTextEditForPage: (pageNum: number) => void;
}) {
  const mem = memoryForMaquette(row.page, getMemoryForPage(row.page));
  const needsQr = row.page.type === 'audio' || row.page.type === 'video';
  const qrUrl = useBookQrUrl(needsQr ? mem?.id : undefined);

  return (
    <View style={[styles.spreadPageCenter, { width: dims.width, height: dims.height }]}>
      <MaquetteBookPages
        page={row.page}
        pageNum={row.pageNum}
        width={dims.width}
        height={dims.height}
        child={child}
        familyChildren={familyChildren}
        memory={mem}
        memoryPhotoRef={
          mem
            ? ((row.page.type === 'photo-full' || row.page.type === 'photo-note'
                ? row.page.photoRef
                : undefined) ??
              memoryPhotoRefs?.[mem.id])
            : undefined
        }
        rotation={mem ? rotations[mem.id] ?? 0 : 0}
        photoCrop={
          mem &&
          (row.page.type === 'photo-full' ||
            row.page.type === 'photo-note' ||
            row.page.type === 'audio')
            ? photoCrops[mem.id]
            : undefined
        }
        truncated={false}
        coverYearLabel={coverYearLabel}
        coverDisplayTitle={
          row.page.type === 'cover' ? (coverTitleLine ?? `Journal de ${child.name}`) : undefined
        }
        coverPhotoUri={row.page.type === 'cover' ? coverPhotoBrowseUri : null}
        coverPhotoCrop={photoCrops.cover}
        coverPhotoImgPxW={row.page.type === 'cover' ? cropDpiMetaCover?.imgPxW : undefined}
        coverPhotoImgPxH={row.page.type === 'cover' ? cropDpiMetaCover?.imgPxH : undefined}
        chapterDisplayTitle={row.page.type === 'chapter' ? (chapterTitleLine ?? undefined) : undefined}
        onRotate={() => {}}
        onRequestTextEdit={() => onRequestTextEditForPage(row.pageNum - 1)}
        qrUrl={qrUrl}
        typography={typography}
      />
    </View>
  );
}

function BookSpreadSlideInner({
  item,
  screenWidth,
  availHLandscape,
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
  memoryPhotoRefs,
  getMemoryForPage,
  onRequestTextEditForPage,
}: BookSpreadSlideProps) {
  const left = item.left;
  const right = item.right;
  const layout = computeLandscapeSpreadLayout(left, right, screenWidth, availHLandscape);
  const showSpine = Boolean(left && right && layout.spineWidth > 0);

  const spreadPageProps = {
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
    memoryPhotoRefs,
    getMemoryForPage,
    onRequestTextEditForPage,
  };

  return (
    <View style={[styles.pageSlide, { width: screenWidth, height: availHLandscape }]}>
      <BookPreviewZoomWrap
        width={screenWidth}
        height={availHLandscape}
        isPagerActive
        zoomEnabled={false}
      >
        <View style={styles.spreadZoomInner}>
          <View style={styles.spreadRow}>
            {layout.left ? (
              <View style={[styles.spreadCell, layout.left]}>
                {left ? (
                  <SpreadMaquettePage row={left} dims={layout.left} {...spreadPageProps} />
                ) : null}
              </View>
            ) : null}
            {showSpine ? (
              <View style={[styles.spreadSpine, { width: layout.spineWidth, height: layout.rowHeight }]}>
                <View style={styles.spreadSpineHairline} />
              </View>
            ) : null}
            {layout.right ? (
              <View style={[styles.spreadCell, layout.right]}>
                {right ? (
                  <SpreadMaquettePage row={right} dims={layout.right} {...spreadPageProps} />
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </BookPreviewZoomWrap>
    </View>
  );
}

function spreadSlidePropsEqual(a: BookSpreadSlideProps, b: BookSpreadSlideProps): boolean {
  if (a.item !== b.item) return false;
  if (a.screenWidth !== b.screenWidth || a.availHLandscape !== b.availHLandscape) return false;
  if (a.child !== b.child || a.familyChildren !== b.familyChildren) return false;
  if (a.coverYearLabel !== b.coverYearLabel) return false;
  if (a.coverTitleLine !== b.coverTitleLine || a.chapterTitleLine !== b.chapterTitleLine) return false;
  if (a.coverPhotoBrowseUri !== b.coverPhotoBrowseUri) return false;
  if (a.cropDpiMetaCover !== b.cropDpiMetaCover) return false;
  if (a.photoCrops !== b.photoCrops || a.rotations !== b.rotations) return false;
  if (a.typography !== b.typography) return false;
  if (a.memoryPhotoRefs !== b.memoryPhotoRefs) return false;
  if (a.getMemoryForPage !== b.getMemoryForPage) return false;
  if (a.onRequestTextEditForPage !== b.onRequestTextEditForPage) return false;
  return true;
}

export const BookSpreadSlide = memo(BookSpreadSlideInner, spreadSlidePropsEqual);

const styles = StyleSheet.create({
  pageSlide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadZoomInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  spreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadCell: {
    overflow: 'hidden',
  },
  spreadPageCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadSpine: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadSpineHairline: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
    backgroundColor: '#C8C8CC',
  },
});

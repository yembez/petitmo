import { memo, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import type { PhotoCrop } from '@/src/book/photoCrop';
import type { BookMaquetteTypography } from '@/constants/bookMaquetteTypography';
import { useBookQrUrl } from '@/lib/bookQrTokenStore';
import MaquetteBookPages from '@/src/book/maquette/MaquetteBookPages';
import {
  bookPortraitPerfMemoBreak,
  bookPortraitPerfPrefetch,
  bookPortraitPerfRender,
  diffBrowseLeafProps,
} from '@/utils/bookPortraitSpreadPerf';

type PageRow = { page: BookPage; pageNum: number };

export type BookBrowseLeafProps = {
  row: PageRow;
  pageW: number;
  pageH: number;
  child: Child;
  familyChildren: Child[];
  memory: Memory | null;
  coverYearLabel: string;
  coverTitleLine: string | null;
  chapterTitleLine: string | null;
  coverPhotoBrowseUri: string | null;
  cropDpiMetaCover?: { imgPxW: number; imgPxH: number };
  photoCrops: Record<string, PhotoCrop>;
  rotations: Record<string, number>;
  typography: BookMaquetteTypography;
  folioFont?: string;
  memoryPhotoRef?: string | null;
  memoryImgPxW?: number;
  memoryImgPxH?: number;
  prefetchUri: string | null;
  onOpenEditor: (pageIndex: number) => void;
  onPrefetchImage: (uri: string | null) => void;
  mediaRevision?: string;
};

function BookBrowseLeafInner({
  row,
  pageW,
  pageH,
  child,
  familyChildren,
  memory,
  coverYearLabel,
  coverTitleLine,
  chapterTitleLine,
  coverPhotoBrowseUri,
  cropDpiMetaCover,
  photoCrops,
  rotations,
  typography,
  folioFont,
  memoryPhotoRef,
  memoryImgPxW,
  memoryImgPxH,
  prefetchUri,
  onOpenEditor,
  onPrefetchImage,
  mediaRevision: _mediaRevision,
}: BookBrowseLeafProps) {
  const pageIndex = row.pageNum - 1;
  const showFolio = row.page.type !== 'cover' && row.page.type !== 'back-cover';
  const needsQr = row.page.type === 'audio' || row.page.type === 'video';
  const qrUrl = useBookQrUrl(needsQr ? memory?.id : undefined);

  bookPortraitPerfRender('BookBrowseLeaf', {
    pageNum: row.pageNum,
    pageType: row.page.type,
    memoryId: memory?.id?.slice(0, 8),
    hasQr: Boolean(qrUrl),
  });

  const handlePress = useCallback(() => onOpenEditor(pageIndex), [onOpenEditor, pageIndex]);
  const handlePressIn = useCallback(() => {
    bookPortraitPerfPrefetch(prefetchUri, `pressIn-p${row.pageNum}`);
    onPrefetchImage(prefetchUri);
  }, [onPrefetchImage, prefetchUri, row.pageNum]);

  return (
    <View style={styles.browseLeafCol}>
      <View style={[styles.browseLeafShadow, { width: pageW, height: pageH }]}>
        <Pressable
          onPressIn={handlePressIn}
          onPress={handlePress}
          style={[styles.browseLeafCard, { width: pageW, height: pageH }]}
          accessibilityRole="button"
          accessibilityLabel={`Modifier la page ${row.pageNum}`}
        >
          <MaquetteBookPages
            page={row.page}
            pageNum={row.pageNum}
            width={pageW}
            height={pageH}
            child={child}
            familyChildren={familyChildren}
            memory={memory}
            memoryPhotoRef={memoryPhotoRef}
            rotation={memory ? rotations[memory.id] ?? 0 : 0}
            photoCrop={
              memory &&
              (row.page.type === 'photo-full' ||
                row.page.type === 'photo-note' ||
                row.page.type === 'audio' ||
                row.page.type === 'video')
                ? photoCrops[memory.id]
                : undefined
            }
            photoImgPxW={memoryImgPxW}
            photoImgPxH={memoryImgPxH}
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
            onRequestTextEdit={handlePress}
            qrUrl={qrUrl}
            typography={typography}
            perfContext="portrait-browse"
          />
        </Pressable>
      </View>
      <Text style={[styles.browseFolio, folioFont ? { fontFamily: folioFont } : null]}>
        {showFolio ? String(row.pageNum) : ' '}
      </Text>
    </View>
  );
}

function browseLeafPropsEqual(a: BookBrowseLeafProps, b: BookBrowseLeafProps): boolean {
  const changed = diffBrowseLeafProps(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>,
  );
  if (changed.length > 0) {
    bookPortraitPerfMemoBreak('BookBrowseLeaf', changed);
    return false;
  }
  return true;
}

export const BookBrowseLeaf = memo(BookBrowseLeafInner, browseLeafPropsEqual);

const styles = StyleSheet.create({
  browseLeafCol: {
    alignItems: 'center',
  },
  browseLeafShadow: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  browseLeafCard: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  browseFolio: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(60,60,67,0.5)',
    textAlign: 'center',
  },
});

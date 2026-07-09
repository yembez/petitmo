import { StyleSheet } from 'react-native';
import { BOOK_PAGE_H_MM, BOOK_PAGE_W_MM } from '@/utils/bookPhotoPrintDpi';
import type { BookPage } from '@/src/book/BookEngine';

export type BookSpreadPageRow = { page: BookPage; pageNum: number };

export type BookSpreadRow = {
  kind: 'spread';
  spreadIndex: number;
  left: BookSpreadPageRow | null;
  right: BookSpreadPageRow | null;
};

/** Marge sous chaque rangée de spread portrait (folio + espacement). */
export const PORTRAIT_BROWSE_ROW_GAP = 24;
/** Espace sous la carte page : folio (marginTop 8 + ligne ~14). */
export const PORTRAIT_BROWSE_FOLIO_BELOW = 22;
export const PORTRAIT_BROWSE_SIDE_PAD = 16;
export const PORTRAIT_BROWSE_SPINE_W = 16;

export function computePortraitBrowseLayout(screenWidth: number): {
  pageW: number;
  pageH: number;
  rowHeight: number;
  contentPaddingTop: number;
} {
  const availW = screenWidth - PORTRAIT_BROWSE_SIDE_PAD * 2;
  const pageW = Math.max(1, Math.floor(availW / 2));
  const pageH = Math.max(1, Math.round((pageW * BOOK_PAGE_H_MM) / BOOK_PAGE_W_MM));
  const rowHeight = pageH + PORTRAIT_BROWSE_FOLIO_BELOW + PORTRAIT_BROWSE_ROW_GAP;
  return {
    pageW,
    pageH,
    rowHeight,
    contentPaddingTop: PORTRAIT_BROWSE_ROW_GAP,
  };
}

export function gelatoTrimPagePx(
  availW: number,
  availH: number,
  opts?: { pageCount?: number; spineTotal?: number },
): { width: number; height: number } {
  const pageCount = opts?.pageCount ?? 1;
  const spineTotal = opts?.spineTotal ?? 0;
  const s = Math.min((availW - spineTotal) / (BOOK_PAGE_W_MM * pageCount), availH / BOOK_PAGE_H_MM);
  const width = Math.max(1, Math.floor(s * BOOK_PAGE_W_MM));
  const height = Math.max(1, Math.round((width * BOOK_PAGE_H_MM) / BOOK_PAGE_W_MM));
  return { width, height };
}

export function computeLandscapeSpreadLayout(
  left: BookSpreadPageRow | null,
  right: BookSpreadPageRow | null,
  availW: number,
  availH: number,
): {
  left: { width: number; height: number } | null;
  right: { width: number; height: number } | null;
  spineWidth: number;
  rowHeight: number;
} {
  const spineMargin = 6;
  const hairline = Math.max(StyleSheet.hairlineWidth, 1);
  const spineTotal = spineMargin + hairline + spineMargin;

  if (!left && !right) {
    return { left: null, right: null, spineWidth: 0, rowHeight: 0 };
  }

  if (!left && right) {
    const { width, height } = gelatoTrimPagePx(availW, availH);
    return { left: null, right: { width, height }, spineWidth: 0, rowHeight: height };
  }

  if (left && !right) {
    const { width, height } = gelatoTrimPagePx(availW, availH);
    return { left: { width, height }, right: null, spineWidth: 0, rowHeight: height };
  }

  const { width: pw, height: ph } = gelatoTrimPagePx(availW, availH, {
    pageCount: 2,
    spineTotal,
  });
  return {
    left: { width: pw, height: ph },
    right: { width: pw, height: ph },
    spineWidth: spineTotal,
    rowHeight: ph,
  };
}

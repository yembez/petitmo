import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';
import { scale } from '@/utils/responsive';

/** Miniature couverture liste Livres — ratio Gelato 21×28 (aligné maquette / PDF). */
export const BOOK_COVER_THUMB_WIDTH = scale(120);
export const BOOK_COVER_THUMB_HEIGHT = BOOK_COVER_THUMB_WIDTH / BOOK_PAGE_RATIO;

/** Proportion bande photo couverture (142 mm sur trim historique 216 mm) — aligné PDF / maquette. */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = 142 / 216;

export type BookCoverColorTheme = {
  paper: string;
  ink: string;
  muted: string;
  line: string;
  placeholder: string;
};

export const BOOK_COVER_THEME_DEFAULT: BookCoverColorTheme = {
  paper: '#FFFFFF',
  ink: '#1C1C1E',
  muted: '#6B7280',
  line: 'rgba(0,0,0,0.10)',
  placeholder: '#E8E8ED',
};

export const BOOK_COVER_THEME_WARM: BookCoverColorTheme = {
  paper: '#FBF8F4',
  ink: '#1C1C1E',
  muted: '#6B7280',
  line: 'rgba(0,0,0,0.09)',
  placeholder: '#EDE8E0',
};

import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';
import { scale } from '@/utils/responsive';
import {
  BOOK_COVER_PHOTO_HEIGHT_RATIO as COVER_PHOTO_H_RATIO,
  type BookCoverColorTheme,
} from '@/constants/bookCoverColors';

export type { BookCoverColorTheme };

/** Miniature couverture liste Livres — ratio Gelato 21×28 (aligné maquette / PDF). */
export const BOOK_COVER_THUMB_WIDTH = scale(120);
export const BOOK_COVER_THUMB_HEIGHT = BOOK_COVER_THUMB_WIDTH / BOOK_PAGE_RATIO;

/** @deprecated Prefer layout mm in `bookCoverColors` — ratio cadre photo / page. */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = COVER_PHOTO_H_RATIO;

/** Carte « Créer un livre » — habillage de l’état vide, pas une couleur de couverture. */
export const BOOK_COVER_THEME_WARM: BookCoverColorTheme = {
  paper: '#DFD5CB',
  ink: '#1C1C1E',
  muted: '#6B635C',
  line: 'rgba(28,28,30,0.16)',
  placeholder: '#D2C6BA',
};

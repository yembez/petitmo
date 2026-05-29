import { scale, verticalScale } from '@/utils/responsive';

/** Miniature couverture liste Livres — angles droits (pas de border radius). */
export const BOOK_COVER_THUMB_WIDTH = scale(120);
export const BOOK_COVER_THUMB_HEIGHT = verticalScale(170);
export const BOOK_COVER_SPINE_WIDTH = scale(10);

/** Bande photo = 142 mm sur page 216 mm (aligné maquette / PDF). */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = 142 / 216;

export type BookCoverColorTheme = {
  paper: string;
  spineStart: string;
  spineEnd: string;
  ink: string;
  muted: string;
  line: string;
  placeholder: string;
};

export const BOOK_COVER_THEME_DEFAULT: BookCoverColorTheme = {
  paper: '#FFFFFF',
  spineStart: '#8A8580',
  spineEnd: '#5C5854',
  ink: '#1C1C1E',
  muted: '#6B7280',
  line: 'rgba(0,0,0,0.10)',
  placeholder: '#E8E8ED',
};

export const BOOK_COVER_THEME_WARM: BookCoverColorTheme = {
  paper: '#FBF8F4',
  spineStart: '#9A8B7A',
  spineEnd: '#6B5E52',
  ink: '#1C1C1E',
  muted: '#6B7280',
  line: 'rgba(0,0,0,0.09)',
  placeholder: '#EDE8E0',
};

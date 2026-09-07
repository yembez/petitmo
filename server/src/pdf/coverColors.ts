/**
 * Miroir `constants/bookCoverColors.ts` (serveur PDF isolé — pas d’import Expo).
 */

export const BOOK_COVER_COLOR_IDS = [
  'white',
  'cream',
  'olive',
  'navy',
  'charcoal',
  'black',
] as const;

export type BookCoverColorId = (typeof BOOK_COVER_COLOR_IDS)[number];

export const DEFAULT_BOOK_COVER_COLOR_ID: BookCoverColorId = 'white';

export type CoverColorTheme = {
  id: BookCoverColorId;
  paper: string;
  ink: string;
  muted: string;
  line: string;
  dark: boolean;
};

const SWATCHES: readonly CoverColorTheme[] = [
  {
    id: 'white',
    dark: false,
    paper: '#EBE8E7',
    ink: '#1C1C1E',
    muted: '#6B7280',
    line: 'rgba(28,28,30,0.18)',
  },
  {
    id: 'cream',
    dark: false,
    paper: '#DFD5CB',
    ink: '#1C1C1E',
    muted: '#6B635C',
    line: 'rgba(28,28,30,0.16)',
  },
  {
    id: 'olive',
    dark: true,
    paper: '#5C5741',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
  },
  {
    id: 'navy',
    dark: true,
    paper: '#202932',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
  },
  {
    id: 'charcoal',
    dark: true,
    paper: '#4A4643',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
  },
  {
    id: 'black',
    dark: true,
    paper: '#111111',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
  },
];

const BY_ID = new Map(SWATCHES.map(s => [s.id, s]));

export function parseBookCoverColorId(raw: unknown): BookCoverColorId {
  return typeof raw === 'string' && BY_ID.has(raw as BookCoverColorId)
    ? (raw as BookCoverColorId)
    : DEFAULT_BOOK_COVER_COLOR_ID;
}

export function bookCoverThemeForId(id: unknown): CoverColorTheme {
  return BY_ID.get(parseBookCoverColorId(id)) ?? SWATCHES[0]!;
}

export const COVER_PHOTO_INSET_MM = 26;
export const COVER_PHOTO_TOP_MM = 28;
export const COVER_PHOTO_FRAME_H_MM = 134;
export const COVER_PHOTO_FRAME_W_MM = 210 - 2 * COVER_PHOTO_INSET_MM;
export const COVER_TEXT_GAP_MM = 14;
export const COVER_HAIRLINE_W_MM = 40;
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = COVER_PHOTO_FRAME_H_MM / 280;

/**
 * Couleurs de fond couverture livre (unis, sans texture) + encre associée.
 * Parité serveur : `server/src/pdf/coverColors.ts`.
 */

export type BookCoverColorTheme = {
  paper: string;
  ink: string;
  muted: string;
  line: string;
  placeholder: string;
};

export const BOOK_COVER_COLOR_IDS = [
  'white',
  'cream',
  'olive',
  'navy',
  'charcoal',
  'black',
] as const;

export type BookCoverColorId = (typeof BOOK_COVER_COLOR_IDS)[number];

export const DEFAULT_BOOK_COVER_COLOR_ID: BookCoverColorId = 'charcoal';

type CoverSwatch = BookCoverColorTheme & {
  id: BookCoverColorId;
  label: string;
  /** Fond sombre → encre claire. */
  dark: boolean;
};

/** Hex échantillonnés sur les maquettes Livre_couv_* (+ noir demandé). */
export const BOOK_COVER_COLOR_SWATCHES: readonly CoverSwatch[] = [
  {
    id: 'white',
    label: 'Blanc',
    dark: false,
    paper: '#EBE8E7',
    ink: '#1C1C1E',
    muted: '#6B7280',
    line: 'rgba(28,28,30,0.18)',
    placeholder: '#E0DCDA',
  },
  {
    id: 'cream',
    label: 'Crème',
    dark: false,
    paper: '#DFD5CB',
    ink: '#1C1C1E',
    muted: '#6B635C',
    line: 'rgba(28,28,30,0.16)',
    placeholder: '#D2C6BA',
  },
  {
    id: 'olive',
    label: 'Olive',
    dark: true,
    paper: '#5C5741',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
    placeholder: '#4A4635',
  },
  {
    id: 'navy',
    label: 'Marine',
    dark: true,
    paper: '#202932',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
    placeholder: '#171E24',
  },
  {
    id: 'charcoal',
    label: 'Anthracite',
    dark: true,
    paper: '#4A4643',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
    placeholder: '#3A3734',
  },
  {
    id: 'black',
    label: 'Noir',
    dark: true,
    paper: '#111111',
    ink: '#F4F1EC',
    muted: 'rgba(244,241,236,0.72)',
    line: 'rgba(244,241,236,0.28)',
    placeholder: '#0A0A0A',
  },
] as const;

const BY_ID = new Map(BOOK_COVER_COLOR_SWATCHES.map(s => [s.id, s]));

export function isBookCoverColorId(v: unknown): v is BookCoverColorId {
  return typeof v === 'string' && BY_ID.has(v as BookCoverColorId);
}

export function parseBookCoverColorId(raw: unknown): BookCoverColorId {
  return isBookCoverColorId(raw) ? raw : DEFAULT_BOOK_COVER_COLOR_ID;
}

export function bookCoverThemeForId(id: unknown): CoverSwatch {
  return BY_ID.get(parseBookCoverColorId(id)) ?? BY_ID.get(DEFAULT_BOOK_COVER_COLOR_ID)!;
}

/**
 * Layout couverture inset (parité PDF `server/src/pdf/coverColors.ts`).
 * Trim 210×280 mm.
 */
export const COVER_PHOTO_INSET_MM = 26;
export const COVER_PHOTO_TOP_MM = 28;
/** Hauteur cadre photo (~48 % de 280). Remplace l’ancien bandeau 142/216 plein largeur. */
export const COVER_PHOTO_FRAME_H_MM = 134;
export const COVER_PHOTO_FRAME_W_MM = 210 - 2 * COVER_PHOTO_INSET_MM;
export const COVER_TEXT_GAP_MM = 14;
export const COVER_HAIRLINE_W_MM = 40;

/** Ratio hauteur photo / page (miniature + DPI). */
export const BOOK_COVER_PHOTO_HEIGHT_RATIO = COVER_PHOTO_FRAME_H_MM / 280;

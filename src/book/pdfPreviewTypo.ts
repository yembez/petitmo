/**
 * Proportions typographiques alignées sur le PDF HTML (`server/src/pdf/htmlBook.ts`) :
 * format Gelato 21×28 cm trim (210 × 280 mm), tailles en pt comme en print CSS.
 * La largeur/hauteur du `View` page en px sert d’échelle (même ratio que le PDF).
 */

import type { TextMemorySizeTier } from '@/src/book/quoteFitLevel';

/** Format Gelato 21×28cm trim — portrait, ratio 3/4.
 *  Nom BOOK_DIGITAL_… conservé pour l'instant (rename dans un prompt séparé). */
export const BOOK_DIGITAL_PAGE_WIDTH_MM = 210;
export const BOOK_DIGITAL_PAGE_HEIGHT_MM = 280;

/** Ratio largeur/hauteur page (210/280 = 0.75). Identique au ratio 3:4 photo portrait smartphone. */
export const BOOK_PAGE_RATIO = BOOK_DIGITAL_PAGE_WIDTH_MM / BOOK_DIGITAL_PAGE_HEIGHT_MM;

/** Marge blanche autour des visuels [M] — parité `--visual-margin` dans `htmlBook.ts`. */
export const BOOK_VISUAL_MARGIN_MM = 12;

/**
 * Décalage extra du bloc titre couverture vers la droite (marge de sécurité reliure / hinge).
 * Parité `COVER_TITLE_SPINE_SAFE_EXTRA_MM` dans `server/src/constants/pdfDigitalSpec.ts`.
 */
export const COVER_TITLE_SPINE_SAFE_EXTRA_MM = 10;

/** Hauteur bande photo pleine page (`.pf-image`) — 75 % de la page trim. */
export const PHOTO_FULL_BAND_HEIGHT_RATIO = 0.75;

/** Zone image utile photo-note / audio (carré dans la zone safe 186 mm). */
export const PHOTO_NOTE_INNER_MM = 186;

/** Hauteur bande conteneur `.pn-image` (padding 12 mm inclus → intérieur 186×186 mm). */
export const PHOTO_NOTE_BAND_HEIGHT_MM =
  PHOTO_NOTE_INNER_MM + 2 * BOOK_VISUAL_MARGIN_MM;

/** Pied blanc fixe photo-full [FP] (date + légende courte). */
export const PHOTO_FULL_FP_FOOTER_MM = 45;

/** Hauteur zone image photo-full [FP] sur trim 280 mm → 235 mm. */
export const PHOTO_FULL_FP_IMAGE_HEIGHT_MM =
  BOOK_DIGITAL_PAGE_HEIGHT_MM - PHOTO_FULL_FP_FOOTER_MM;

/** pt (1/72 in) → px sur une largeur de page = largeur trim Gelato en mm. */
export function pdfPtToPreviewPx(pt: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return Math.round(pt);
  return (pt / 72) * 25.4 * (pageWidthPx / BOOK_DIGITAL_PAGE_WIDTH_MM);
}

/** mm le long de la largeur page (même échelle que la largeur trim). */
export function pdfMmToPreviewPxW(mm: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_WIDTH_MM) * pageWidthPx;
}

/** mm le long de la hauteur page (même échelle que la hauteur trim). */
export function pdfMmToPreviewPxH(mm: number, pageHeightPx: number): number {
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_HEIGHT_MM) * pageHeightPx;
}

/**
 * Échelle mm→px unique pour une page (carrés QR, bande 186×186, marges [M]).
 * Utilise min(largeur, hauteur) pour éviter l’écrasement si les px arrondis dérivent du ratio 210:280.
 */
export function pdfPageUniformScalePx(pageWidthPx: number, pageHeightPx: number): number {
  const sw = pageWidthPx / BOOK_DIGITAL_PAGE_WIDTH_MM;
  const sh = pageHeightPx / BOOK_DIGITAL_PAGE_HEIGHT_MM;
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0) return 1;
  return Math.min(sw, sh);
}

/** mm → px avec la même échelle sur les deux axes (parité spread + PDF). */
export function pdfMmToPreviewPxUniform(
  mm: number,
  pageWidthPx: number,
  pageHeightPx: number,
): number {
  return mm * pdfPageUniformScalePx(pageWidthPx, pageHeightPx);
}

/**
 * Garde minimal anti sous-pixel. Volontairement très bas : la maquette doit rester
 * STRICTEMENT proportionnelle à la largeur de page, y compris en vue spread (vignettes
 * ~moitié de page). À pleine largeur (éditeur) ces tailles dépassent largement ce garde,
 * donc l'éditeur est inchangé ; seul l'aperçu réduit cesse d'être « trop gros ».
 */
const MIN_FS = 1;

/** Réduction légère globale des corps souvenirs (DM Sans) — parité `htmlBook.ts` (×15/16). */
const MEMORY_TEXT_SCALE = 15 / 16;

function memorySouvenirPt(basePt: number): number {
  return Math.round(basePt * MEMORY_TEXT_SCALE * 100) / 100;
}

/** QR dans la carte audio / vidéo — parité `.media-qr-card .qr`. */
export const PDF_MEDIA_QR_QR_MM = 18;

/** Carte QR (bordure grise, **angles carrés**) à droite de la légende audio / vidéo. */
export const PDF_MEDIA_QR_CARD_W_MM = 38;
export const PDF_MEDIA_QR_CARD_PAD_MM = 4;
export const PDF_MEDIA_QR_CARD_RADIUS_MM = 0;
/** Gouttière entre la colonne légende et la carte QR. */
export const PDF_MEDIA_QR_GAP_MM = 6;
/** Pictogramme type (haut-parleur / caméra) sous le QR. */
export const PDF_MEDIA_QR_TYPE_ICON_MM = 4;
/** Libellés carte (hint + type) — parité `.label` 7 pt. */
export const PDF_MEDIA_QR_CARD_LABEL_PT = 7;
/** Bordure carte + libellés gris (hint, type). */
export const PDF_MEDIA_QR_CARD_BORDER_COLOR = '#D8D8DD';
export const PDF_MEDIA_QR_MUTED_COLOR = '#AEAEB2';

/** Légende audio / vidéo — EB Garamond droit, alignée sur le texte long (14 pt), ~50 car/ligne. */
export const PDF_MEDIA_CAPTION_PT = 14;
export const PDF_MEDIA_CAPTION_LH = 1.5;

/** Remontée du bandeau bas (méta+légende) dans la marge blanche du visuel, pour coller la méta à la photo. */
export const PDF_MEDIA_QR_PULL_UP_MM = 7;

/**
 * Marge horizontale dédiée aux **textes sous les médias** (photo pleine page, photo-note,
 * audio/vidéo QR) — plus large que `--pad-x` (15 mm) des pages texte/chapitre/citation,
 * pour aérer la colonne et laisser plus de blanc des deux côtés.
 * Parité `--media-pad-x` dans `htmlBook.ts`.
 */
export const PDF_MEDIA_TEXT_PAD_X_MM = 22;

/** Corps souvenir Roboto — 12 pt historique → 11.25 pt. */
export const PDF_MEMORY_BODY_PT = memorySouvenirPt(12);
/** Légende sous photo pleine page — EB Garamond, alignée sur le texte long (14 pt). */
export const PDF_PHOTO_CAPTION_PT = 14;
/** Texte long sous photo (photo-note) — EB Garamond, aligné sur le texte long (14 pt). */
export const PDF_PHOTO_NOTE_BODY_PT = 14;
/** Description vidéo (corps souvenir) — 10.5 pt historique → ~9.85 pt. */
export const PDF_VIDEO_SUB_PT = memorySouvenirPt(10.5);

/** Guillemet citation — palier court (sans titre), vert sauge maquette. */
export const PDF_QUOTE_MARK_PT = 52;
export const PDF_QUOTE_MARK_COLOR = '#6B8F7E';

/** Corps citation guillemet (1–8 lignes, sans `text_title`). */
export const PDF_GUILLEMET_BODY_PT = 22;
export const PDF_GUILLEMET_BODY_LH = 1.48;

/** Filet court sous le bloc citation. */
export const PDF_GUILLEMET_RULE_MM = 28;

/** Corps citation « Petits mots » — EB Garamond droit (pas Roboto). */
export const PDF_TEXT_MEMORY_BODY_PT: Record<TextMemorySizeTier, number> = {
  lg: 20,
  md: 16,
  sm: 14,
};

export const PDF_TEXT_MEMORY_BODY_LH: Record<TextMemorySizeTier, number> = {
  lg: 1.52,
  md: 1.5,
  sm: 1.52,
};

/** Titre souvenir texte (EB Garamond) — palier lignes. */
export const PDF_TEXT_MEMORY_TITLE_PT: Record<TextMemorySizeTier, number> = {
  lg: 28,
  md: 26,
  sm: 24,
};

/** Marges page citation — parité `--pad-x` + `.quote-tier-*` dans `htmlBook.ts`. */
export const PDF_QUOTE_PAD_X_MM = 18;

/**
 * Largeur colonne titre + corps (maquette : marges latérales généreuses).
 * Sur trim 210 mm : lg 128 mm, md 140 mm → ~34–41 mm de marge visuelle par côté.
 */
export const PDF_TEXT_MEMORY_COLUMN_MM: Record<TextMemorySizeTier, number> = {
  lg: 128,
  md: 140,
  sm: 152,
};

export const PDF_TEXT_MEMORY_COLUMN_GUILLEMET_LG_MM = 112;

/** Colonne titre + corps long (16–28 lignes, avec `text_title`). */
export const PDF_TEXT_MEMORY_COLUMN_TITLED_SM_MM = 132;

export function pdfTextMemoryColumnMaxWidthPx(
  tier: TextMemorySizeTier,
  variant: 'guillemet' | 'titled' | 'dropcap',
  pageWidthPx: number,
): number {
  if (variant === 'guillemet' && tier === 'lg') {
    return pdfMmToPreviewPxW(PDF_TEXT_MEMORY_COLUMN_GUILLEMET_LG_MM, pageWidthPx);
  }
  if (variant === 'dropcap') {
    const key: 'md' | 'sm' = tier === 'sm' ? 'sm' : 'md';
    return pdfMmToPreviewPxW(PDF_TEXT_MEMORY_COLUMN_DROPCAP_MM[key], pageWidthPx);
  }
  if (variant === 'titled' && tier === 'sm') {
    return pdfMmToPreviewPxW(PDF_TEXT_MEMORY_COLUMN_TITLED_SM_MM, pageWidthPx);
  }
  return pdfMmToPreviewPxW(PDF_TEXT_MEMORY_COLUMN_MM[tier], pageWidthPx);
}

export function pdfQuotePagePadX(pageWidthPx: number): number {
  return pdfMmToPreviewPxW(PDF_QUOTE_PAD_X_MM, pageWidthPx);
}

export function pdfQuotePagePadY(tier: TextMemorySizeTier, pageHeightPx: number): number {
  const mm = tier === 'lg' ? 13 : tier === 'md' ? 12 : 11;
  return pdfMmToPreviewPxH(mm, pageHeightPx);
}

/** Lettrine sans titre (9+ lignes) — corps aligné à gauche, centré verticalement dans la page. */
export const PDF_DROPCAP_BODY_PT: Record<'md' | 'sm', number> = {
  md: 16,
  sm: 14,
};

export const PDF_DROPCAP_BODY_LH = 1.52;

/** Colonne texte lettrine — ~66 % du trim (marges latérales généreuses). */
export const PDF_TEXT_MEMORY_COLUMN_DROPCAP_MM: Record<'md' | 'sm', number> = {
  md: 136,
  sm: 130,
};

/** Lettrine — hauteur ~3 lignes de corps. */
export const PDF_TEXT_MEMORY_DROPCAP_PT: Record<'md' | 'sm', number> = {
  md: 52,
  sm: 46,
};

/** Espace entre paragraphes (lettrine + titled sm). Source de vérité — miroir `htmlBook.ts`. */
export const PDF_TEXT_MEMORY_PARA_GAP_MM = 5.5;

/** @deprecated Préférer `PDF_TEXT_MEMORY_PARA_GAP_MM` */
export const PDF_DROPCAP_PARA_GAP_MM = PDF_TEXT_MEMORY_PARA_GAP_MM;

/** Marge sous le bloc titre (souvenir texte avec `text_title`). */
export const PDF_TEXT_MEMORY_TITLE_BLOCK_MARGIN_MM: Record<TextMemorySizeTier, number> = {
  lg: 5,
  md: 4.5,
  sm: 4,
};

/** Largeur filet sous le titre souvenir. */
export const PDF_TEXT_MEMORY_TITLE_RULE_MM: Record<TextMemorySizeTier, number> = {
  lg: 24,
  md: 30,
  sm: 30,
};

/** Guillemet : marges verticales (maquette + PDF). */
export const PDF_GUILLEMET_MARK_MARGIN_BOTTOM_MM = 4;
export const PDF_GUILLEMET_BODY_MARGIN_BOTTOM_MM = 5;
export const PDF_GUILLEMET_RULE_MARGIN_TOP_MM = 2;

/** @deprecated */
export const PDF_QUOTE_BODY_FIT_PT = {
  0: PDF_TEXT_MEMORY_BODY_PT.lg,
  1: PDF_TEXT_MEMORY_BODY_PT.md,
  2: PDF_TEXT_MEMORY_BODY_PT.sm,
} as const;

/** PDF `.label` — 7 pt (méta date/lieu, folio, pastilles). */
export function pdfLabelStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(7, pageWidthPx)) };
}

/** Dimensions carte QR audio/vidéo — parité `htmlBook.ts` `.media-qr-card` (hauteur figée, QR 18×18 mm). */
export type PdfMediaQrCardLayoutPx = {
  cardW: number;
  cardH: number;
  cardPad: number;
  cardRadius: number;
  qrSize: number;
  qrMarginV: number;
  typeIconSize: number;
  typeRowH: number;
  hintFontSize: number;
  hintLineH: number;
  typeLabelFontSize: number;
};

export function pdfMediaQrCardLayoutPx(
  pageWidthPx: number,
  pageHeightPx: number,
): PdfMediaQrCardLayoutPx {
  const u = (mm: number) =>
    Math.max(1, Math.round(pdfMmToPreviewPxUniform(mm, pageWidthPx, pageHeightPx)));
  const cardW = u(PDF_MEDIA_QR_CARD_W_MM);
  const cardPad = u(PDF_MEDIA_QR_CARD_PAD_MM);
  const cardRadius = u(PDF_MEDIA_QR_CARD_RADIUS_MM);
  const qrSize = u(PDF_MEDIA_QR_QR_MM);
  const qrMarginV = cardPad;
  const typeIconSize = u(PDF_MEDIA_QR_TYPE_ICON_MM);
  const typeRowH = typeIconSize;
  const hintFontSize = Math.max(
    MIN_FS,
    pdfPtToPreviewPx(PDF_MEDIA_QR_CARD_LABEL_PT, pageWidthPx),
  );
  const hintLineH = Math.max(hintFontSize, u(2.5));
  const typeLabelFontSize = hintFontSize;
  const cardH = Math.round(
    cardPad + hintLineH + qrMarginV + qrSize + qrMarginV + typeRowH + cardPad,
  );
  return {
    cardW,
    cardH,
    cardPad,
    cardRadius,
    qrSize,
    qrMarginV,
    typeIconSize,
    typeRowH,
    hintFontSize,
    hintLineH,
    typeLabelFontSize,
  };
}

/** PDF `.body` (citation niveau 0) — 11 pt, interligne 1.65 */
export function pdfBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(11, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(11 * 1.65, pageWidthPx) };
}

/** Interligne légende photo pleine page — parité `.pf-caption` dans `htmlBook.ts`. */
export const PDF_PHOTO_CAPTION_LINE_HEIGHT = 1.3;
/** Interligne texte photo-note — parité `.photo-note .pn-text .memory-text`. */
export const PDF_PHOTO_NOTE_LINE_HEIGHT = 1.35;

/** `.pf-caption` */
export function pdfPhotoCaptionStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_PHOTO_CAPTION_PT, pageWidthPx));
  return {
    fontSize: fs,
    lineHeight: pdfPtToPreviewPx(PDF_PHOTO_CAPTION_PT * PDF_PHOTO_CAPTION_LINE_HEIGHT, pageWidthPx),
  };
}

/** `.photo-note .pn-text .memory-text` */
export function pdfPhotoNoteBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_PHOTO_NOTE_BODY_PT, pageWidthPx));
  return {
    fontSize: fs,
    lineHeight: pdfPtToPreviewPx(PDF_PHOTO_NOTE_BODY_PT * PDF_PHOTO_NOTE_LINE_HEIGHT, pageWidthPx),
  };
}

export type QuotePdfFitLevel = 0 | 1 | 2;

/** Corps souvenir Roboto — parité `.memory-text`. */
export function pdfMemoryTextBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_MEMORY_BODY_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(PDF_MEMORY_BODY_PT * 1.588, pageWidthPx) };
}

/** Légende audio / vidéo (EB Garamond) — parité `.media-qr-caption`. */
export function pdfMediaCaptionStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_MEDIA_CAPTION_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(PDF_MEDIA_CAPTION_PT * PDF_MEDIA_CAPTION_LH, pageWidthPx) };
}

/** `.quote-body` — palier typo lignes livre. */
export function pdfTextMemoryBodyStyle(
  tier: TextMemorySizeTier,
  pageWidthPx: number,
): { fontSize: number; lineHeight: number } {
  const pt = PDF_TEXT_MEMORY_BODY_PT[tier];
  const lh = PDF_TEXT_MEMORY_BODY_LH[tier];
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
    lineHeight: pdfPtToPreviewPx(pt * lh, pageWidthPx),
  };
}

/** Titre centré au-dessus du corps (souvenir texte avec `text_title`). */
export function pdfTextMemoryTitleStyle(
  tier: TextMemorySizeTier,
  pageWidthPx: number,
): { fontSize: number; lineHeight: number } {
  const pt = PDF_TEXT_MEMORY_TITLE_PT[tier];
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
    lineHeight: pdfPtToPreviewPx(pt * 1.2, pageWidthPx),
  };
}

/** Lettrine — 1ʳᵉ lettre sans titre (9+ lignes). */
export function pdfTextMemoryDropCapStyle(
  tier: TextMemorySizeTier,
  pageWidthPx: number,
): { fontSize: number; lineHeight: number } {
  const key: 'md' | 'sm' = tier === 'sm' ? 'sm' : 'md';
  const pt = PDF_TEXT_MEMORY_DROPCAP_PT[key];
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
    lineHeight: pdfPtToPreviewPx(pt * 0.82, pageWidthPx),
  };
}

/** Corps page lettrine (texte long sans titre). */
export function pdfTextMemoryDropcapBodyStyle(
  tier: TextMemorySizeTier,
  pageWidthPx: number,
): { fontSize: number; lineHeight: number } {
  const key: 'md' | 'sm' = tier === 'sm' ? 'sm' : 'md';
  const pt = PDF_DROPCAP_BODY_PT[key];
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
    lineHeight: pdfPtToPreviewPx(pt * PDF_DROPCAP_BODY_LH, pageWidthPx),
  };
}

/** Guillemet `.quote-mark` — vert sauge, grande taille. */
export function pdfQuoteMarkStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_QUOTE_MARK_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: fs };
}

/** Corps page citation courte (guillemet). */
export function pdfTextMemoryGuillemetBodyStyle(
  pageWidthPx: number,
): { fontSize: number; lineHeight: number } {
  const pt = PDF_GUILLEMET_BODY_PT;
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
    lineHeight: pdfPtToPreviewPx(pt * PDF_GUILLEMET_BODY_LH, pageWidthPx),
  };
}

/** @deprecated — utiliser `pdfTextMemoryBodyStyle` */
export function pdfQuoteBodyStyle(fit: QuotePdfFitLevel, pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const tier: TextMemorySizeTier = fit === 0 ? 'lg' : fit === 1 ? 'md' : 'sm';
  return pdfTextMemoryBodyStyle(tier, pageWidthPx);
}

export function pdfChapterMonthStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfChapterTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfChapterSubStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfCoverTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfCoverPeriodStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(11, pageWidthPx)) };
}

export function pdfVideoTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(13.5, pageWidthPx)) };
}

export function pdfVideoSubStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_VIDEO_SUB_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(PDF_VIDEO_SUB_PT * 1.5, pageWidthPx) };
}

/** `.folio` — 7 pt, bas 8 mm (htmlBook). */
export function pdfFolioStyle(
  pageWidthPx: number,
  pageHeightPx: number
): { fontSize: number; bottom: number } {
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(7, pageWidthPx)),
    bottom: pdfMmToPreviewPxH(8, pageHeightPx),
  };
}

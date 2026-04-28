/**
 * Charte couleur Petitmo — typographies (encre / gris), fonds neutres, accent bleu ardoise.
 * Exception : sur le **fil**, le cœur favori sélectionné reste en terracotta (`feedFavoriteTerracotta`).
 */
export const THEME = {
  bg: '#FFFFFF',
  /** Fonds d’écran doux (remplace le beige #F5F5F0) */
  bgScreen: '#F5F7FA',
  textPrimary: '#1C1C1E',
  textMuted: '#6B7280',
  textSecondary: '#8E8E93',
  /** Cœur favori **plein** sous un post du fil (inchangé — terracotta brique) */
  feedFavoriteTerracotta: '#D4784A',
  /** Fond **rond** du bouton favori (fil) quand sélectionné — même brique, plus doux que le plein */
  feedFavoriteTerracottaSoftBg: 'rgba(212, 120, 74, 0.28)',
  /** CTA primaires, liens, spinners (hors cœur du fil) — noir (remplace le bleu). */
  accent: '#1C1C1E',
  /** Variations plus douces (utile pour hover / badges / backgrounds). */
  accentMuted: '#3A3A3C',
  accentDeep: '#0A0A0A',
  accentSoft: '#8E8E93',
} as const;

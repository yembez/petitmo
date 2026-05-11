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
  /** Couleur de marque terracotta (charte) */
  brandTerracotta: '#D06235',
  /** Overlay terracotta foncé (onboarding) */
  brandTerracottaTopOverlay: 'rgba(68, 28, 16, 0.55)',
  /** Cœur favori **plein** sous un post du fil (terracotta brique) */
  feedFavoriteTerracotta: '#D06235',
  /**
   * Fond du CTA pill « Écrire un souvenir » — écran Capturer uniquement.
   */
  captureWriteCtaBackground: '#FFFFFF',
  /** Fond icône carte « Enregistrer » — écran Capturer (maquette v4). */
  captureRecordIconBackground: '#7C4FD6',
  /** Fond icône carte « Importer » — écran Capturer (maquette v4). */
  captureImportIconBackground: '#2B7FFF',
  /** CTA primaires, liens, spinners (hors cœur du fil) — noir (remplace le bleu). */
  accent: '#1C1C1E',
  /** Fond type paywall — espace parent, création / édition profil enfant */
  familyFlowScreenBg: '#F6F4F1',
  /** Séparateurs légers (cartes header) alignés paywall */
  familyFlowLine: 'rgba(0,0,0,0.08)',
  /** Variations plus douces (utile pour hover / badges / backgrounds). */
  accentMuted: '#3A3A3C',
  accentDeep: '#0A0A0A',
  accentSoft: '#8E8E93',
} as const;

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
  /** Terracotta doux clair — onglet Capturer (cœur, prénom, CTA Enregistrer, liens). */
  captureCtaSoftTerracotta: '#E8A078',
  /** Fond CTA rond « Écrire » — écran Capturer uniquement. */
  captureCoralCtaBackground: '#ff9c84',
  /** Fond CTA rond « Importer » — écran Capturer uniquement. */
  captureImportCtaBackground: '#ffd9cd',
  /** Fond CTA rond « Enregistrer » — écran Capturer uniquement. */
  captureRecordCtaBackground: '#f2f2f2',
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

  /** Accent CTA écran Capturer — couleur charte (`#FFD34E`). */
  captureAccentYellow: '#FFD34E',
  /** @deprecated violet maquette initiale — conservé si besoin legacy. */
  captureMaquetteViolet: '#5B47D6',
  /** Icône + libellé onglet actif tab bar. */
  tabBarActiveTint: '#1C1C1E',
  /** Icône + libellé onglets inactifs. */
  tabBarInactiveTint: '#8E8E93',
  /** Fond de la tab bar flottante (off-white). */
  tabBarSurface: '#F2F0F6',
  /** Pastille onglet actif tab bar — gris très léger. */
  tabBarActivePill: '#F2F2F4',
  /** @deprecated anneau lavande (tab bar violette) — non utilisé sur le bandeau blanc actuel. */
  tabBarOuterRing: '#D5CEEB',
} as const;

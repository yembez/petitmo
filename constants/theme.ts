/** Rosé charte — couleur d’accent / CTA / marque (remplace ardoise + terracotta). */
const BRAND_PRIMARY = '#FC5757';
const BRAND_PRIMARY_RGB = '252, 87, 87';
/** Corail brique — fond splash natif (`app.json` `splash.backgroundColor`), adaptive icon. */
const BRAND_SPLASH_BRICK = '#D9683A';
/** Orange CTA — disques Capturer, onglet actif tab bar, accents chaleureux. */
const BRAND_CTA_ORANGE = '#FF7F4F';
const BRAND_CTA_ORANGE_RGB = '255, 127, 79';
/** Gris — CTA secondaires (paywall, livres, modales, favoris, memory-view…). */
const BRAND_CTA_GRAY = '#51545E';
const BRAND_CTA_GRAY_RGB = '81, 84, 94';
/** Ardoise — CTA crayon du fil uniquement (hors rosé charte). */
const FEED_PENCIL_SLATE = '#526779';
const FEED_PENCIL_SLATE_RGB = '82, 103, 121';

/**
 * Charte couleur Petitmo — typographies (encre / gris), fonds neutres, accent rosé (`brandPrimary`).
 */
export const THEME = {
  bg: '#FFFFFF',
  /** Fonds d’écran doux (remplace le beige #F5F5F0) */
  bgScreen: '#F5F7FA',
  textPrimary: '#1C1C1E',
  textMuted: '#6B7280',
  textSecondary: '#8E8E93',
  /** Logo header, filigranes — gris très clair sur fond beige/blanc. */
  textTertiary: '#C7C7CC',

  /** Couleur de marque — CTA, cœurs favoris, paywall, spinners d’accent… */
  brandPrimary: BRAND_PRIMARY,
  /** Fond splash (Expo / Android / iOS) — corail brique, distinct du rosé `brandPrimary`. */
  splashScreenBackground: BRAND_SPLASH_BRICK,
  /** Orange CTA charte — disques Capturer, tab bar active, point âge / cœur titre… */
  brandCtaOrange: BRAND_CTA_ORANGE,
  /** Accents disques Capturer — cœur titre, point pilule âge (orange charte). */
  captureDiscCtaBackground: BRAND_CTA_ORANGE,
  /** @deprecated — `brandPrimary` */
  brandTerracotta: BRAND_PRIMARY,
  /** Vignette onboarding / hero photo (dérivé du rosé). */
  brandPrimaryTopOverlay: 'rgba(90, 22, 22, 0.55)',
  /** @deprecated — `brandPrimaryTopOverlay` */
  brandTerracottaTopOverlay: 'rgba(90, 22, 22, 0.55)',
  /** Cœur favori plein (fil, galerie, livres…). */
  feedFavoriteTerracotta: BRAND_PRIMARY,
  /** Accents doux sur fond clair (prénom Capturer, liens secondaires). */
  brandPrimarySoft: '#F4A0A0',
  /** @deprecated — `brandPrimarySoft` */
  captureCtaSoftTerracotta: '#F4A0A0',

  /** Fond CTA rond « Importer » — dérivé clair de l’orange charte. */
  captureImportCtaBackground: '#FBD1C1',
  /** Fond CTA rond « Enregistrer » — écran Capturer (maquette V3). */
  captureRecordCtaBackground: '#FFFFFF',
  /** Liseré disque « Enregistrer » — écran Capturer (orange charte). */
  captureRecordCtaBorderColor: BRAND_CTA_ORANGE,
  /** Fond CTA rond « Écrire » — écran Capturer (orange charte). */
  captureWriteCtaBackground: BRAND_CTA_ORANGE,
  /** Icônes dans les disques CTA Capturer — marron fondu bas hero. */
  captureCtaIconColor: '#3C3126',
  /** Fond bas Capturer — dégradé photo, bandeau CTA (blanc cassé beige). */
  captureScreenBg: '#FAFAF7',
  /** Libellés sous les disques CTA Capturer. */
  captureCtaLabelColor: '#3C3126',
  /** CTA primaires, liens, spinners (hors cœur du fil) — noir. */
  accent: '#1C1C1E',
  /** Fond type paywall — espace parent, création / édition profil enfant */
  familyFlowScreenBg: '#F6F4F1',
  /** Séparateurs légers (cartes header) alignés paywall */
  familyFlowLine: 'rgba(0,0,0,0.08)',
  /** Variations plus douces (utile pour hover / badges / backgrounds). */
  accentMuted: '#3A3A3C',
  accentDeep: '#0A0A0A',
  accentSoft: '#8E8E93',

  /** @deprecated — `captureScreenCtaBackground` */
  captureCoralCtaBackground: BRAND_PRIMARY,
  /** @deprecated — `captureScreenCtaBackground` */
  captureAccentYellow: BRAND_PRIMARY,
  /** Fond CTA primaire app — `petitmoCtaStyles`, favoris « Sélectionner », modales… */
  captureScreenCtaBackground: BRAND_PRIMARY,
  /** Libellé + icône sur fond CTA primaire rosé. */
  captureScreenCtaForeground: '#FFFFFF',
  /** @deprecated — `captureScreenCtaBackground` */
  captureWriteCtaRose: BRAND_PRIMARY,
  /** Gris `#51545E` — CTA paywall, livres, modales, favoris « Ajouter au livre », memory-view… */
  brandArdoise: BRAND_CTA_GRAY,
  /** Fond doux badges / sélection plan paywall. */
  paywallAccentSoft: `rgba(${BRAND_CTA_GRAY_RGB}, 0.14)`,
  /** Disque crayon fil — fond blanc + liseré noir fin (comme CTA cœur fil). */
  feedPencilDiscCtaBackground: '#FFFFFF',
  feedPencilDiscCtaForeground: '#1C1C1E',
  /** @deprecated ardoise — ancien crayon fil */
  feedPencilCtaBackground: `rgba(${FEED_PENCIL_SLATE_RGB}, 0.20)`,
  feedPencilCtaBorderColor: `rgba(${FEED_PENCIL_SLATE_RGB}, 0.36)`,
  feedPencilCtaForeground: FEED_PENCIL_SLATE,
  /** CTA « Sélectionner » — héros favoris (rosé à 80 %). */
  favorisSelectCtaBackground: `rgba(${BRAND_PRIMARY_RGB}, 0.8)`,
  /**
   * Contour CTA primaire — `PETITMO_CTA_BORDER_WIDTH`.
   * Liseré rosé discret sur fond `captureScreenCtaBackground`.
   */
  captureCtaBorderColor: `rgba(${BRAND_PRIMARY_RGB}, 0.32)`,
  /** @deprecated violet maquette initiale — conservé si besoin legacy. */
  captureMaquetteViolet: '#5B47D6',
  /** Icône + libellé onglet actif tab bar. */
  tabBarActiveTint: BRAND_CTA_ORANGE,
  /** Icône + libellé onglets inactifs. */
  tabBarInactiveTint: '#8E8E93',
  /** Fond tab bar — blanc cassé beige chaleureux. */
  tabBarBackground: '#F6F4F1',
  /** @deprecated — `tabBarBackground` */
  tabBarSurface: '#F6F4F1',
  /** @deprecated pastille onglet actif supprimée — teinte via `tabBarActiveTint` uniquement. */
  tabBarActivePill: `rgba(${BRAND_CTA_ORANGE_RGB}, 0.14)`,
  /** @deprecated anneau lavande (tab bar violette) — non utilisé sur le bandeau blanc actuel. */
  tabBarOuterRing: '#D5CEEB',
} as const;

import { CAPTURE_SCREEN_ACCENT, CAPTURE_SCREEN_BG } from '@/constants/captureScreenPalette';

/** Rosé charte — couleur d’accent / CTA / marque (remplace ardoise + terracotta). */
const BRAND_PRIMARY = '#FC5757';
const BRAND_PRIMARY_RGB = '252, 87, 87';
/** Orange CTA charte — disques Capturer, tab bar, CTA in-app. */
const BRAND_CTA_ORANGE = '#FF7F4F';
const BRAND_CTA_ORANGE_RGB = '255, 127, 79';
/**
 * Orange widget / icône store (`widget_petitmo_orange2`) — un cran plus vif.
 * Splash natif + animation alignés dessus pour le même flash au lancement.
 */
const BRAND_WIDGET_ORANGE = '#FC6C39';
/** @deprecated — alias historique ; le splash utilise désormais l’orange widget. */
const BRAND_SPLASH_BRICK = BRAND_WIDGET_ORANGE;
/** Gris — CTA secondaires (paywall, livres, modales, favoris, memory-view…). */
const BRAND_CTA_GRAY = '#51545E';
const BRAND_CTA_GRAY_RGB = '81, 84, 94';
/** Ardoise — CTA crayon du fil uniquement (hors rosé charte). */
const FEED_PENCIL_SLATE = '#526779';
const FEED_PENCIL_SLATE_RGB = '82, 103, 121';

/** Fond d’écran officiel — blanc cassé beige (Capturer, onglets, modales, écrans stack). */
export const APP_SCREEN_BG = '#FAFAF7';
export const APP_SCREEN_BG_RGB = { r: 250, g: 250, b: 247 } as const;

/**
 * Charte couleur Petitmo — typographies (encre / gris), fonds neutres, accent rosé (`brandPrimary`).
 */
export const THEME = {
  /** Fond d’écran principal — blanc cassé charte. */
  bg: APP_SCREEN_BG,
  /** @deprecated alias — `bg` */
  bgScreen: APP_SCREEN_BG,
  textPrimary: '#1C1C1E',
  textMuted: '#6B7280',
  textSecondary: '#8E8E93',
  /** Logo header, filigranes — gris très clair sur fond beige/blanc. */
  textTertiary: '#C7C7CC',

  /** Couleur de marque — CTA, cœurs favoris, paywall, spinners d’accent… */
  brandPrimary: BRAND_PRIMARY,
  /** Fond splash (Expo / Android / iOS / SplashAnimation) — orange widget `#FC6C39`. */
  splashScreenBackground: BRAND_SPLASH_BRICK,
  /** Orange widget / icône — même teinte que le splash. */
  brandWidgetOrange: BRAND_WIDGET_ORANGE,
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

  /** Fond CTA rond « Importer » — rose bonbon maquette Capturer. */
  captureImportCtaBackground: '#FEA5A1',
  /** Fond CTA rond « Enregistrer » — écran Capturer (maquette V3). */
  captureRecordCtaBackground: '#FFFFFF',
  /** Liseré disque « Enregistrer » — écran Capturer (orange charte). */
  captureRecordCtaBorderColor: BRAND_CTA_ORANGE,
  /** Fond CTA rond « Écrire » — écran Capturer (orange charte). */
  captureWriteCtaBackground: BRAND_CTA_ORANGE,
  /** Icônes dans les disques CTA Capturer — marron fondu bas hero. */
  captureCtaIconColor: '#3C3126',
  /** @deprecated alias — `bg` (bandeau bas Capturer, dégradé hero). */
  captureScreenBg: APP_SCREEN_BG,
  /** Libellés sous les disques CTA Capturer. */
  captureCtaLabelColor: '#3C3126',
  /** CTA primaires, liens, spinners (hors cœur du fil) — noir. */
  accent: '#1C1C1E',
  /** Fond écrans famille / fil header — aligné fond d’écran charte. */
  familyFlowScreenBg: APP_SCREEN_BG,
  /** Séparateurs légers (cartes header) alignés paywall */
  familyFlowLine: 'rgba(0,0,0,0.08)',
  /** Variations plus douces (utile pour hover / badges / backgrounds). */
  accentMuted: '#3A3A3C',
  accentDeep: '#0A0A0A',
  accentSoft: '#8E8E93',

  /** @deprecated — `captureScreenCtaBackground` */
  captureCoralCtaBackground: BRAND_CTA_ORANGE,
  /** @deprecated — `captureScreenCtaBackground` */
  captureAccentYellow: BRAND_CTA_ORANGE,
  /** Fond CTA primaire app — `petitmoCtaStyles`, modales, onboarding, livres… */
  captureScreenCtaBackground: BRAND_CTA_ORANGE,
  /** Libellé + icône sur fond CTA primaire orange. */
  captureScreenCtaForeground: '#FFFFFF',
  /** @deprecated — `captureScreenCtaBackground` */
  captureWriteCtaRose: BRAND_CTA_ORANGE,
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
  /** CTA « Sélectionner » — héros favoris (orange à 80 %). */
  favorisSelectCtaBackground: `rgba(${BRAND_CTA_ORANGE_RGB}, 0.8)`,
  /**
   * Contour CTA primaire — `PETITMO_CTA_BORDER_WIDTH`.
   * Liseré orange discret sur fond `captureScreenCtaBackground`.
   */
  captureCtaBorderColor: `rgba(${BRAND_CTA_ORANGE_RGB}, 0.32)`,
  /** @deprecated violet maquette initiale — conservé si besoin legacy. */
  captureMaquetteViolet: '#5B47D6',
  /** Icône + libellé onglet actif tab bar — orange charte (aligné écran Capturer). */
  tabBarActiveTint: CAPTURE_SCREEN_ACCENT,
  /** Icône + libellé onglets inactifs (assombris vs `textSecondary`). */
  tabBarInactiveTint: '#636366',
  /** Fond tab bar — beige écran Capturer (`#FEFBF7`). */
  tabBarBackground: CAPTURE_SCREEN_BG,
  /** @deprecated — `tabBarBackground` */
  tabBarSurface: CAPTURE_SCREEN_BG,
  /** Surfaces élevées (cartes souvenir, CTA disque blanc, pages livre à l’écran). */
  surfaceCard: '#FFFFFF',
  /** @deprecated pastille onglet actif supprimée — teinte via `tabBarActiveTint` uniquement. */
  tabBarActivePill: `rgba(${BRAND_CTA_ORANGE_RGB}, 0.14)`,
  /** @deprecated anneau lavande (tab bar violette) — non utilisé sur le bandeau blanc actuel. */
  tabBarOuterRing: '#D5CEEB',
} as const;

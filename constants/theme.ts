import {
  BRAND_ACTION_ACCENT,
  BRAND_ACTION_ACCENT_RGB,
  BRAND_ACTION_GRADIENT,
  CAPTURE_SCREEN_BG,
  CAPTURE_CTA_BORDER,
  CAPTURE_CTA_IMPORT,
  CAPTURE_CTA_WRITE,
  CAPTURE_TAB_ACTIVE,
} from '@/constants/captureScreenPalette';

/** Rosé charte — cœurs favoris, paywall hero neutre, marque douce. */
const BRAND_PRIMARY = '#FC5757';
const BRAND_PRIMARY_RGB = '252, 87, 87';
/** Accent CTA charte — corail `#FD7764` (spinners / tab / splash). */
const BRAND_CTA_ACCENT = BRAND_ACTION_ACCENT;
const BRAND_CTA_ACCENT_RGB = BRAND_ACTION_ACCENT_RGB;
/**
 * Dégradé widget / icône store (`widget_petitmo_gradient.png`).
 * @deprecated orange historique — `#FC6C39` (`widget_petitmo_orange2`).
 */
const BRAND_WIDGET_ORANGE = '#FC6C39';
/** Fond splash natif (letterbox) — départ du dégradé `#FD6F9F` → `#FD7D4D`. */
const BRAND_SPLASH = BRAND_ACTION_GRADIENT[0];
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
  /** Fond splash letterbox natif — départ dégradé `#FD6F9F` (image = dégradé complet). */
  splashScreenBackground: BRAND_SPLASH,
  /** @deprecated orange historique — icône store = `widget_petitmo_gradient.png`. */
  brandWidgetOrange: BRAND_WIDGET_ORANGE,
  /** Accent unie — spinners / tab / icônes — `#FD7764` (nom historique `brandCtaOrange`). */
  brandCtaOrange: BRAND_CTA_ACCENT,
  /** @deprecated alias — `brandCtaOrange` */
  captureDiscCtaBackground: BRAND_CTA_ACCENT,
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

  /** Fond CTA rond « Importer » — rose maquette Capturer. */
  captureImportCtaBackground: CAPTURE_CTA_IMPORT,
  /** Fond CTA rond « Enregistrer » — écran Capturer (maquette V3). */
  captureRecordCtaBackground: '#FFFFFF',
  /** Liseré disque « Enregistrer » — écran Capturer. */
  captureRecordCtaBorderColor: CAPTURE_CTA_BORDER,
  /** Fond CTA rond « Écrire » — écran Capturer. */
  captureWriteCtaBackground: CAPTURE_CTA_WRITE,
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
  captureCoralCtaBackground: BRAND_CTA_ACCENT,
  /** @deprecated — `captureScreenCtaBackground` */
  captureAccentYellow: BRAND_CTA_ACCENT,
  /** Fond CTA primaire app (fallback solid) — préfère `BRAND_ACTION_GRADIENT`. */
  captureScreenCtaBackground: BRAND_CTA_ACCENT,
  /** Libellé + icône sur fond CTA primaire (dégradé rose→corail). */
  captureScreenCtaForeground: '#FFFFFF',
  /** @deprecated — `captureScreenCtaBackground` */
  captureWriteCtaRose: BRAND_CTA_ACCENT,
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
  /** CTA « Sélectionner » — héros favoris (accent à 80 %). */
  favorisSelectCtaBackground: `rgba(${BRAND_CTA_ACCENT_RGB}, 0.8)`,
  /**
   * Contour CTA primaire — `PETITMO_CTA_BORDER_WIDTH`.
   * Liseré noir (legacy) — les CTA dégradés n’en utilisent plus.
   */
  captureCtaBorderColor: CAPTURE_CTA_BORDER,
  /** @deprecated violet maquette initiale — conservé si besoin legacy. */
  captureMaquetteViolet: '#5B47D6',
  /** Icône + libellé onglet actif tab bar — accent Capturer. */
  tabBarActiveTint: CAPTURE_TAB_ACTIVE,
  /** Icône + libellé onglets inactifs (assombris vs `textSecondary`). */
  tabBarInactiveTint: '#4F4F52',
  /** Fond tab bar — beige écran Capturer (`#FEFBF7`). */
  tabBarBackground: CAPTURE_SCREEN_BG,
  /** @deprecated — `tabBarBackground` */
  tabBarSurface: CAPTURE_SCREEN_BG,
  /** Surfaces élevées (cartes souvenir, CTA disque blanc, pages livre à l’écran). */
  surfaceCard: '#FFFFFF',
  /** @deprecated pastille onglet actif supprimée — teinte via `tabBarActiveTint` uniquement. */
  tabBarActivePill: `rgba(${BRAND_CTA_ACCENT_RGB}, 0.14)`,
  /** @deprecated anneau lavande (tab bar violette) — non utilisé sur le bandeau blanc actuel. */
  tabBarOuterRing: '#D5CEEB',
} as const;

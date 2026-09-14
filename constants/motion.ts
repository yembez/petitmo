import { Easing, ReduceMotion, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Physique de mouvement Petit Cœur.
 *
 * Deux régimes cohabitent (ne jamais les mélanger sur le **même** `withSpring`) :
 * - `MOTION_SPRING_PHYS` — stiffness / damping (cœur, press, tokens “nouveaux” physiques)
 * - `MOTION_SPRING_*` immersif — réglés à la main, ne pas retoucher
 * - `MOTION_SPRING` (duration / dampingRatio) — optionnel pour code neuf type SwiftUI
 *
 * La cohérence est perceptuelle, pas syntaxique.
 */

const rm = ReduceMotion.System;

/**
 * Tokens physiques (équivalents ω₀ ≈ 2π/durée, mass 1).
 * Validés à l’œil avant généralisation.
 */
export const MOTION_SPRING_PHYS = {
  snap: { mass: 1, stiffness: 1220, damping: 70, reduceMotion: rm } satisfies WithSpringConfig,
  standard: { mass: 1, stiffness: 320, damping: 33, reduceMotion: rm } satisfies WithSpringConfig,
  smooth: { mass: 1, stiffness: 158, damping: 25, reduceMotion: rm } satisfies WithSpringConfig,
  /** ♡ favori — un seul rebond visible, rapide. */
  tender: { mass: 1, stiffness: 195, damping: 17, reduceMotion: rm } satisfies WithSpringConfig,
} as const;

/**
 * Tokens perceptuels (Reanimated 4 / SwiftUI) — code neuf qui préfère la langue durée.
 * Ne pas combiner avec stiffness/damping sur le même spring.
 */
export const MOTION_SPRING = {
  snap: {
    duration: 180,
    dampingRatio: 1,
    reduceMotion: rm,
  } satisfies WithSpringConfig,
  standard: {
    duration: 350,
    dampingRatio: 0.92,
    reduceMotion: rm,
  } satisfies WithSpringConfig,
  smooth: {
    duration: 500,
    dampingRatio: 1,
    reduceMotion: rm,
  } satisfies WithSpringConfig,
  tender: {
    duration: 450,
    dampingRatio: 0.62,
    reduceMotion: rm,
  } satisfies WithSpringConfig,
} as const;

export const MOTION_EASE = {
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
  exit: Easing.bezier(0.4, 0, 1, 1),
  enter: Easing.bezier(0.2, 0, 0, 1),
} as const;

/**
 * Apparition d’un élément (pastille, CTA, carte).
 * Amortissement ~0.42 : un seul dépassement visible, stabilisé en ~400 ms.
 */
export const MOTION_SPRING_SETTLE: WithSpringConfig = {
  damping: 17,
  stiffness: 400,
  mass: 1,
  reduceMotion: rm,
};

/** Relâchement d’un appui : retour net. */
export const MOTION_SPRING_PRESS: WithSpringConfig = {
  damping: 26,
  stiffness: 520,
  mass: 1,
  reduceMotion: rm,
};

/**
 * Zoom vignette → plein écran : course très longue, donc amortissement fort.
 * Dépassement ~0.7 % (quelques pixels) — la photo se pose au lieu de s’arrêter net.
 */
export const MOTION_SPRING_ZOOM: WithSpringConfig = {
  damping: 29,
  stiffness: 260,
  mass: 1,
  reduceMotion: rm,
};

/** Feuilles / modales : course longue qui se pose sans rebond visible. */
export const MOTION_SPRING_SHEET: WithSpringConfig = {
  damping: 27,
  stiffness: 260,
  mass: 1,
  reduceMotion: rm,
};

/** Sortie : on efface, on ne fait pas rebondir en arrière. */
export const MOTION_EXIT_MS = 140;

/** Fil : crossfade poster ↔ vidéo inline (entrée autoplay et sortie de zone). */
export const MOTION_FEED_VIDEO_POSTER_MS = 280;

/** Décalage entre éléments d’une même vue (perçu comme une seule vague). */
export const MOTION_STAGGER_MS = 45;
/** Décalage à la sortie : plus serré, sinon la vue traîne au lieu de se refermer. */
export const MOTION_EXIT_STAGGER_MS = 18;

/** Échelle de départ d’une apparition — pic à ~1.012 avec `MOTION_SPRING_SETTLE`. */
export const MOTION_ENTER_SCALE = 0.95;
/**
 * Course verticale d’une apparition, orientée vers le bord d’origine.
 * Sous ~14 px le déplacement passe inaperçu à côté d’une animation plus grande.
 */
export const MOTION_ENTER_TRANSLATE_PX = 18;
/** Compression sous le doigt (contrôles seulement — jamais une photo / carte). */
export const MOTION_PRESS_SCALE = 0.965;
/** CTA Capturer / gros disques : plus lisible sous le pouce. */
export const MOTION_PRESS_SCALE_EMPHATIC = 0.94;
/**
 * Annotation fil (crayon) — plus franc que le favori press utilitaire :
 * le geste d’écrire sur un souvenir est prioritaire.
 */
export const MOTION_PRESS_SCALE_ANNOTATE = 0.86;
/** Assombrissement max au press (jamais le 0.5 TouchableOpacity). */
export const MOTION_PRESS_OPACITY_DIP = 0.06;
/** Assombrissement crayon / actions prioritaires. */
export const MOTION_PRESS_OPACITY_DIP_ANNOTATE = 0.12;
/** Fond gris franc du disque crayon au press (sur blanc). */
export const MOTION_PRESS_FILL_ANNOTATE = '#D8D8DD';
/** Durée de la compression (l’appui doit répondre tout de suite). */
export const MOTION_PRESS_IN_MS = 90;
/** Compression annotation — encore plus snappy. */
export const MOTION_PRESS_IN_ANNOTATE_MS = 55;

/** Morph CTA primaire : label qui part vers le haut. */
export const MOTION_CTA_MORPH_LABEL_EXIT_MS = 140;
/** Trait de coche après succès (morph disque). */
export const MOTION_CTA_MORPH_CHECK_MS = 260;
/** Pause sur le check avant de fermer / enchaîner. */
export const MOTION_CTA_MORPH_SUCCESS_HOLD_MS = 400;
/** Secousse d’échec : deux oscillations ±6 pt. */
export const MOTION_CTA_MORPH_ERROR_SHAKE_MS = 220;
export const MOTION_CTA_MORPH_ERROR_SHAKE_PX = 6;
/** Hauteur / diamètre du disque busy — compact (pas le 52 pt de la maquette web). */
export const MOTION_CTA_MORPH_DISK_PT = 44;
/** Rayon idle du pill (coins plus serrés que `PETITMO_CTA_BORDER_RADIUS`). */
export const MOTION_CTA_MORPH_IDLE_RADIUS = 12;
/** hitSlop morph — pouce plus large que le dessin. */
export const MOTION_CTA_MORPH_HIT_SLOP = 10;
/**
 * Ombres CTA morph — teinte `#1C1C1E` (jamais noir pur), deux couches.
 * Au press : la couche ambiante se rétracte (le bouton se pose).
 * Calé discret — pas trop « flottant » hors de l’écran.
 */
export const MOTION_CTA_MORPH_SHADOW = {
  color: '#1C1C1E',
  ambient: { offsetY: 4, radius: 10, opacity: 0.14 },
  ambientPressed: { offsetY: 1, radius: 4, opacity: 0.08 },
  contact: { offsetY: 1, radius: 2, opacity: 0.1 },
  contactPressed: { offsetY: 0, radius: 1, opacity: 0.06 },
  /** Android elevation repos → press. */
  elevation: 3,
  elevationPressed: 1,
} as const;
/** Liseré interne haut — discret, évite l’aplat mort sans briller. */
export const MOTION_CTA_MORPH_SHEEN = 'rgba(255,255,255,0.06)';

/**
 * Disques Capturer — press plus franc que le morph pill (gros cible, loin de l’œil).
 * Scale ~0.90 : lisible sans effet « jouet » (0.85).
 */
export const MOTION_CAPTURE_PRESS_SCALE = 0.9;
export const MOTION_CAPTURE_PRESS_OPACITY_DIP = 0.1;
export const MOTION_CAPTURE_PRESS_SHADOW = {
  color: '#1C1C1E',
  ambient: { offsetY: 6, radius: 14, opacity: 0.2 },
  ambientPressed: { offsetY: 1, radius: 4, opacity: 0.08 },
  contact: { offsetY: 2, radius: 3, opacity: 0.14 },
  contactPressed: { offsetY: 0, radius: 1, opacity: 0.06 },
  elevation: 5,
  elevationPressed: 1,
} as const;

/** Pic du pop favori (une oscillation, puis retour snap). */
export const MOTION_FAVORITE_POP_SCALE = 1.2;

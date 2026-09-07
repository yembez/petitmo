import { Platform, StyleSheet } from 'react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_BORDER_WIDTH } from '@/constants/petitmoCtaStyles';
import { FONT_SIZES } from '@/constants/sizes';
import {
  MEDIA_CARD_INSET,
  MEDIA_CARD_RADIUS,
  TEXT_POST_CARD_INSET,
  TEXT_POST_CARD_RADIUS,
} from '@/constants/feedLayout';

const HEADER_AVATAR_PX = scale(68);
/** Liseré orange CTA autour de l’avatar header fil. */
const HEADER_AVATAR_RING_WIDTH = scale(2);
const HEADER_AVATAR_RING_PADDING = scale(2);
/** Marge horizontale (ex. audio sans visuel) — référencé par `styles` */
const FEED_GUTTER = scale(20);
/** Posts texte : padding interne carte (réduit pour élargir la colonne de lecture). */
const TEXT_POST_GUTTER = scale(22);
/** Contours des blocs — très discrets */
const POST_BORDER_SUBTLE = 'rgba(0,0,0,0.08)';
/** Liseré fin fil (cartes média, etc.) */
const FEED_BLACK_HAIRLINE = '#000000';
const GREY_ACTIVE_BG = '#E5E7EB';
const GREY_ACTIVE_BORDER = '#D1D5DB';
/** Hauteur du bloc « traits + date · âge » — alignée sur `styles.daySeparatorBlock` (chaque post) */
const DAY_SEPARATOR_BLOCK_H = verticalScale(46);

/** Interligne corps souvenir fil (~1,3× la taille — aligné livre `.memory-text`). */
const FEED_TEXT_BODY_LINE_HEIGHT = scale(21);
const FEED_CAPTION_LINE_HEIGHT = scale(21);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.familyFlowScreenBg,
  },
  /** Header hors liste : le scroll ne passe pas « sous » le bandeau — pas de double comptage pour snap */
  headerShell: {
    flexShrink: 0,
    zIndex: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.035,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
      default: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.035,
        shadowRadius: 4,
      },
    }),
  },
  headerContent: {
    backgroundColor: 'rgba(246,244,241,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.familyFlowLine,
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(8),
  },
  headerBlur: {
    backgroundColor: 'rgba(246,244,241,0.78)',
  },
  headerAndroid: {
    backgroundColor: THEME.familyFlowScreenBg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: verticalScale(52),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: scale(12),
  },
  headerRight: {
    marginLeft: scale(12),
    flexShrink: 0,
  },
  headerAvatarRing: {
    padding: HEADER_AVATAR_RING_WIDTH,
    borderRadius:
      HEADER_AVATAR_PX / 2 + HEADER_AVATAR_RING_PADDING + HEADER_AVATAR_RING_WIDTH,
    overflow: 'hidden',
  },
  /** Écart entre le liseré et la photo — repeint au fond écran, comme la pile multi-enfants. */
  headerAvatarRingInner: {
    padding: HEADER_AVATAR_RING_PADDING,
    borderRadius: HEADER_AVATAR_PX / 2 + HEADER_AVATAR_RING_PADDING,
    backgroundColor: THEME.familyFlowScreenBg,
    overflow: 'hidden',
  },
  headerAvatarImg: {
    width: HEADER_AVATAR_PX,
    height: HEADER_AVATAR_PX,
    borderRadius: HEADER_AVATAR_PX / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(253, 119, 100, 0.08)',
  },
  headerAvatarPlaceholder: {
    width: HEADER_AVATAR_PX,
    height: HEADER_AVATAR_PX,
    borderRadius: HEADER_AVATAR_PX / 2,
    backgroundColor: 'rgba(253, 119, 100, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarLetter: {
    fontSize: scale(26),
    fontWeight: '600',
    color: THEME.brandCtaOrange,
  },
  headerNameBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerTitleLine: {
    fontSize: scale(17),
    letterSpacing: -0.25,
    color: THEME.textPrimary,
  },
  headerChildName: {
    fontWeight: '500',
    color: THEME.textPrimary,
  },
  headerDot: {
    fontWeight: '400',
    color: THEME.textMuted,
  },
  headerChildAge: {
    fontWeight: '400',
    fontSize: scale(15),
    color: THEME.textMuted,
  },
  headerAddBtn: {
    width: scale(40),
    height: scale(40),
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: scale(4),
  },
  feedViewport: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
  scrollView: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
  scrollContent: {
    paddingBottom: verticalScale(28),
    paddingHorizontal: 0,
    backgroundColor: THEME.bgScreen,
  },
  pillsScroll: {
    backgroundColor: THEME.familyFlowScreenBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.familyFlowLine,
    flexGrow: 0,
    flexShrink: 0,
  },
  pillsRow: {
    paddingVertical: verticalScale(10),
    gap: scale(8),
    alignItems: 'center',
  },
  pill: {
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(12),
    borderRadius: scale(999),
    borderWidth: 1,
    borderColor: THEME.familyFlowLine,
    backgroundColor: '#FFFFFF',
    maxWidth: scale(170),
  },
  pillActive: {
    backgroundColor: GREY_ACTIVE_BG,
    borderColor: GREY_ACTIVE_BORDER,
  },
  pillPressed: { opacity: 0.88 },
  pillText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  pillTextActive: { color: THEME.textPrimary },
  pillBookInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
  },
  /**
   * Enveloppe ombre (sans `overflow: hidden` — sinon iOS ne dessine pas l’ombre).
   * Le contenu clipé vit dans `post`.
   * Halo : offset nul + rayon large (relief tout autour, pas seulement en bas).
   */
  postShell: {
    alignSelf: 'stretch',
    marginHorizontal: scale(8),
    borderRadius: scale(12),
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.11,
        shadowRadius: scale(16),
      },
      android: {
        /** Android reste surtout « bas » ; on atténue pour ne pas rivaliser avec le halo iOS. */
        elevation: 5,
      },
      default: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.11,
        shadowRadius: scale(16),
      },
    }),
  },
  post: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(12),
    overflow: 'hidden',
  },
  /**
   * Racine d’une ligne du fil : espacement entre posts + pas de clip sur l’ombre.
   * L’espace vertical remplace l’ancien `feedPostGap` (vue opaque qui masquait l’ombre).
   */
  feedRowRoot: {
    overflow: 'visible',
  },
  feedRowSpacingTop: {
    marginTop: verticalScale(24),
  },
  /** Cellule FlatList : ne pas clipper l’ombre portée des cartes. */
  feedListCell: {
    overflow: 'visible',
  },
  /** En-tête date · âge (répété à chaque post). */
  daySeparatorBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: DAY_SEPARATOR_BLOCK_H,
    paddingHorizontal: scale(20),
    paddingVertical: verticalScale(10),
    backgroundColor: '#FFFFFF',
  },
  dayHeaderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: scale(12),
    minWidth: 0,
  },
  /** Bloc date/âge aligné à gauche (style fil social). */
  dayHeaderLeft: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: verticalScale(2),
  },
  dayHeaderRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    maxWidth: '48%',
  },
  dayLocationEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: scale(8),
  },
  daySepDate: {
    fontSize: scale(12.5),
    color: THEME.textPrimary,
  },
  daySepAge: {
    fontSize: scale(12.5),
    color: THEME.textSecondary,
  },
  daySepLocation: {
    fontSize: scale(12.5),
    textAlign: 'right',
  },
  daySepLocationFilled: {
    color: '#4B5563',
  },
  daySepLocationPlaceholder: {
    color: THEME.textSecondary,
  },
  postMain: {
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
  /** visible : laisse passer l’ombre des cartes texte (page) */
  postBody: {
    overflow: 'visible',
  },
  /** Photo / vidéo : pleine largeur, sans arrondi ni ombre (fil type social). */
  mediaCard: {
    marginHorizontal: MEDIA_CARD_INSET,
    alignSelf: 'stretch',
    aspectRatio: 4 / 5,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#ECECEF',
  },
  /** Photo sans URL distante ni copie locale (rare) : carte neutre, sans texte ni spinner */
  photoPlaceholder: {
    minHeight: verticalScale(220),
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  videoBody: {
    position: 'relative',
  },
  /**
   * Fond carte vidéo : noir (pas gris `#ECECEF`) pour éviter les éclairs blancs du lecteur
   * natif au démarrage / arrêt et aux boucles.
   */
  videoMediaCard: {
    backgroundColor: '#000000',
  },
  /** Style passé en `videoStyle` sur `expo-av` `Video` : colore la surface native (ex. Android). */
  feedInlineVideoNativeBg: {
    backgroundColor: '#000000',
  },
  /** Autoplay fil : poster / fond sous la `Video` jusqu’au 1er frame (évite flash blanc). */
  feedInlineAutoplayStack: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  /** Couvre la carte : tap pour lire / mettre en pause (au-dessus de la vue vidéo) */
  videoTapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  videoPlayIconAboveTap: {
    zIndex: 3,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: scale(44),
    height: scale(44),
    borderRadius: scale(22),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 60, 67, 0.88)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: scale(8),
    elevation: 3,
  },
  durationBadge: {
    position: 'absolute',
    right: scale(12),
    bottom: verticalScale(12),
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: scale(7),
    paddingVertical: verticalScale(3),
    borderRadius: scale(6),
  },
  /** Vidéo fil : son + durée en bas à droite (pilules verre alignées sur feedMetaPill). */
  videoBottomControlsBar: {
    position: 'absolute',
    right: scale(12),
    bottom: verticalScale(12),
    zIndex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: scale(8),
  },
  /** Barre overlay : date à gauche, lieu à droite (haut du média). */
  feedMetaPillBar: {
    position: 'absolute',
    top: scale(12),
    left: scale(12),
    right: scale(12),
    zIndex: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: scale(8),
  },
  /** Audio fil sans vignette : méta dans le flux (pas de vide sous overlay absolu). */
  feedMetaPillBarInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: scale(8),
    paddingHorizontal: scale(12),
    paddingTop: scale(12),
    paddingBottom: scale(4),
    width: '100%',
  },
  /** Âge famille — bas gauche du média (remplace l’ancienne pastille date doublon). */
  /** Prénom + âge : bas-droite (évite de masquer le play audio à gauche). */
  feedAgePillBar: {
    position: 'absolute',
    right: scale(12),
    bottom: scale(12),
    zIndex: 6,
    maxWidth: '72%',
    alignItems: 'flex-end',
  },
  feedAgePillBarInline: {
    paddingHorizontal: scale(12),
    paddingBottom: scale(10),
    paddingTop: scale(2),
    alignSelf: 'flex-end',
    maxWidth: '72%',
  },
  feedMetaPillWrapLeft: {
    flexShrink: 1,
    maxWidth: '52%',
    alignSelf: 'flex-start',
  },
  feedMetaPillWrapRight: {
    flexShrink: 1,
    maxWidth: '52%',
    alignSelf: 'flex-start',
    marginLeft: 'auto',
  },
  feedMetaPill: {
    position: 'relative',
    borderRadius: scale(999),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  feedMetaPillAlignLeft: {
    alignSelf: 'flex-start',
  },
  feedMetaPillAlignRight: {
    alignSelf: 'flex-end',
  },
  feedMetaPillScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.26)',
  },
  feedMetaPillContent: {
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(7),
    zIndex: 1,
  },
  feedMetaPillInnerColumn: {
    alignItems: 'flex-start',
    gap: verticalScale(1),
    minWidth: 0,
  },
  feedMetaPillInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: scale(6),
    minWidth: 0,
  },
  feedMetaPillDate: {
    fontSize: scale(12),
    lineHeight: scale(16),
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'left',
  },
  feedMetaPillAge: {
    fontSize: scale(12),
    lineHeight: scale(16),
    color: 'rgba(255, 255, 255, 0.92)',
    fontWeight: '500',
    textAlign: 'left',
  },
  feedMetaPillLocationText: {
    fontSize: scale(12),
    lineHeight: scale(16),
    color: '#FFFFFF',
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  feedMetaPillLocationPlaceholder: {
    color: 'rgba(255, 255, 255, 0.78)',
  },
  feedPhotoFavoriteOverlay: {
    position: 'absolute',
    right: scale(12),
    bottom: scale(12),
    zIndex: 4,
  },
  capturedOverlay: {
    position: 'absolute',
    left: scale(12),
    bottom: scale(12),
    zIndex: 3,
  },
  overlayBadge: {
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: scale(999),
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Favori sur photo / vidéo : disque fixe (plus compact que la ligne d’actions texte/vocal). */
  feedFavoriteMediaCircle: {
    width: scale(32),
    height: scale(32),
    borderRadius: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  feedFavoriteMediaCircleActive: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  /** Favori ligne d’actions (vocal / texte) : même disque, fond neutre sur blanc. */
  feedFavoriteActionCircle: {
    width: scale(38),
    height: scale(38),
    borderRadius: scale(19),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: FEED_BLACK_HAIRLINE,
  },
  feedFavoriteActionCircleActive: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  capturedOverlayText: {
    fontSize: 11,
    fontWeight: '400',
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: scale(11),
    fontWeight: '500',
  },
  audioBody: {
    backgroundColor: '#FFFFFF',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    position: 'relative',
    overflow: 'hidden',
  },
  /** Vocal fil sans photo de fond : hauteur pilotée par le contenu. */
  audioBodyNoCover: {
    paddingBottom: verticalScale(8),
    gap: verticalScale(4),
  },
  audioBodyWithCover: {
    minHeight: verticalScale(260),
    marginHorizontal: MEDIA_CARD_INSET,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    /** Plein bord : sinon le padding d’audioBody crée des bandes blanches sur les côtés de la photo */
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  voiceCoverBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  /** Voile blanc sur la photo de fond du vocal (lisibilité du lecteur, volontairement léger) */
  voiceCoverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  audioForeground: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    alignItems: 'stretch',
    gap: 0,
  },
  /** Lecteur + onde au ras du bas de la photo (léger dépassement pour compacter le vide visuel) */
  audioForegroundCover: {
    position: 'absolute',
    left: scale(10),
    right: scale(10),
    bottom: -verticalScale(14),
    zIndex: 2,
    alignItems: 'stretch',
    gap: 0,
  },
  audioPlayerWrap: {
    width: '100%',
  },
  audioPlayerWrapNoCover: {
    paddingHorizontal: FEED_GUTTER,
  },
  audioPlayerWrapCover: {
    maxWidth: '100%',
  },
  textBody: {
    backgroundColor: '#FFFFFF',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: TEXT_POST_GUTTER,
    paddingVertical: verticalScale(32),
    marginHorizontal: TEXT_POST_CARD_INSET,
    borderRadius: TEXT_POST_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: POST_BORDER_SUBTLE,
    marginBottom: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(3) },
        shadowOpacity: 0.05,
        shadowRadius: scale(12),
      },
      android: {
        elevation: 2,
      },
      default: {},
    }),
  },
  /** Espace entre paragraphes (double saut de ligne à la saisie) — mise en page type roman */
  textBookParagraphSpacing: {
    marginTop: verticalScale(16),
  },
  textTitle: {
    width: '100%',
    fontSize: scale(18),
    color: '#1C1C1E',
    lineHeight: scale(25),
    marginBottom: verticalScale(12),
    textAlign: 'center',
  },
  /** `width: '100%'` : sans largeur explicite, le `Text` peut se comporter en shrink-wrap et la justification ne s’applique pas à chaque ligne après un `\n`. */
  textContent: {
    width: '100%',
    alignSelf: 'stretch',
    fontSize: scale(16),
    color: '#1C1C1E',
    lineHeight: FEED_TEXT_BODY_LINE_HEIGHT,
    textAlign: 'justify',
    ...Platform.select({
      android: {
        textBreakStrategy: 'highQuality' as const,
      },
      default: {},
    }),
  },
  postCaption: {
    minHeight: verticalScale(44),
    marginHorizontal: 0,
    paddingTop: verticalScale(14),
    paddingBottom: verticalScale(12),
    paddingHorizontal: scale(16),
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: POST_BORDER_SUBTLE,
  },
  /** Annotations sous photo / vidéo / vocal */
  captionAnnotation: {
    width: '100%',
    alignSelf: 'stretch',
    fontSize: scale(16),
    fontWeight: '400',
    color: '#1C1C1E',
    lineHeight: FEED_CAPTION_LINE_HEIGHT,
    textAlign: 'justify',
    ...Platform.select({
      android: {
        textBreakStrategy: 'highQuality' as const,
      },
      default: {},
    }),
  },
  postActions: {
    marginHorizontal: 0,
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(12),
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  postActionsSpread: {
    justifyContent: 'space-between',
  },
  postActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    flexShrink: 1,
  },
  postActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    flexShrink: 0,
  },
  /** Disque crayon fil — fond blanc + liseré noir (parité CTA cœur). */
  feedPencilDiscCta: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.feedPencilDiscCtaBackground,
    borderWidth: scale(1),
    borderColor: 'rgba(0, 0, 0, 0.28)',
  },
  /** Disque favori aligné sur le crayon (sous le post). */
  feedFavoriteDiscCta: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: scale(1),
    borderColor: 'rgba(0, 0, 0, 0.28)',
  },
  feedFavoriteDiscCtaActive: {
    backgroundColor: '#FFFFFF',
  },
  swipeDeleteContainer: {
    justifyContent: 'center',
    alignItems: 'stretch',
    width: scale(96),
  },
  swipeDeleteBtn: {
    flex: 1,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(8),
    borderRadius: 0,
    marginVertical: 0,
    marginRight: 0,
    gap: verticalScale(6),
  },
  swipeDeleteLabel: {
    color: '#FFFFFF',
    fontSize: scale(12),
    fontWeight: '700',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(28),
  },
  emptyText: {
    fontSize: scale(16),
    color: THEME.textMuted,
    textAlign: 'center',
    marginBottom: verticalScale(6),
  },
  emptySubText: {
    fontSize: scale(13),
    color: THEME.textMuted,
    textAlign: 'center',
  },
  createButton: {
    marginTop: verticalScale(18),
    paddingHorizontal: scale(24),
    paddingVertical: verticalScale(12),
  },
  createButtonText: {
    fontSize: scale(16),
  },
});

export {
  HEADER_AVATAR_PX,
  FEED_GUTTER,
  TEXT_POST_GUTTER,
  DAY_SEPARATOR_BLOCK_H,
  styles,
};

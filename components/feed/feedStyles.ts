import { Platform, StyleSheet } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { FONT_SIZES } from '@/constants/sizes';
import {
  MEDIA_CARD_INSET,
  MEDIA_CARD_RADIUS,
  TEXT_POST_CARD_INSET,
  TEXT_POST_CARD_RADIUS,
} from '@/constants/feedLayout';

/** Expo Go n’inclut pas le module natif du filtre couleur → crash / écran blanc si on l’utilise. */
const CAN_USE_AVATAR_BW_FILTER =
  Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

const HEADER_AVATAR_PX = scale(44);
/** Requis par react-native-color-matrix-image-filters si un style est passé au filtre */
const HEADER_AVATAR_CM_STYLE = {
  width: HEADER_AVATAR_PX,
  height: HEADER_AVATAR_PX,
  backgroundColor: '#fff0' as const,
};
/** Marge horizontale (ex. audio sans visuel) — référencé par `styles` */
const FEED_GUTTER = scale(20);
/** Posts texte : colonne étroite façon livre */
const TEXT_POST_GUTTER = scale(32);
/** Contours des blocs — très discrets */
const POST_BORDER_SUBTLE = 'rgba(0,0,0,0.08)';
/** Pills d’action : trait léger type iOS */
const ACTION_OUTLINE = 'rgba(0,0,0,0.14)';
const GREY_ACTIVE_BG = '#E5E7EB';
const GREY_ACTIVE_BORDER = '#D1D5DB';
/** Hauteur du bloc « traits + date · âge » — alignée sur `styles.daySeparatorBlock` (chaque post) */
const DAY_SEPARATOR_BLOCK_H = verticalScale(46);

/** Séparation entre posts (très marquée, type fil social). */
const FEED_POST_DIVIDER = '#121212';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
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
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(8),
  },
  headerBlur: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  headerAndroid: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: verticalScale(40),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: scale(12),
  },
  headerAvatarImg: {
    width: HEADER_AVATAR_PX,
    height: HEADER_AVATAR_PX,
    borderRadius: HEADER_AVATAR_PX / 2,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  headerAvatarPlaceholder: {
    width: HEADER_AVATAR_PX,
    height: HEADER_AVATAR_PX,
    borderRadius: HEADER_AVATAR_PX / 2,
    backgroundColor: '#E8E8ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarLetter: {
    fontSize: scale(20),
    fontWeight: '600',
    color: '#636366',
  },
  headerNameBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerTitleLine: {
    fontSize: scale(17),
    letterSpacing: -0.25,
    color: '#1C1C1E',
  },
  headerChildName: {
    fontWeight: '500',
    color: '#1C1C1E',
  },
  headerDot: {
    fontWeight: '400',
    color: '#C7C7CC',
  },
  headerChildAge: {
    fontWeight: '400',
    fontSize: scale(15),
    color: '#8E8E93',
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: verticalScale(28),
    paddingHorizontal: 0,
  },
  pillsScroll: {
    backgroundColor: '#F0F2F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
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
    borderColor: 'rgba(0,0,0,0.10)',
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
    color: '#1C1C1E',
  },
  pillTextActive: { color: '#1C1C1E' },
  pillBookInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
  },
  post: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    overflow: 'visible',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FEED_POST_DIVIDER,
  },
  /** Ligne avec traits fins + date · âge (répétée à chaque post) */
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
    fontWeight: '600',
    color: '#4B5563',
  },
  daySepAge: {
    fontSize: scale(12.5),
    fontWeight: '400',
    color: '#4B5563',
  },
  daySepLocation: {
    fontSize: scale(12.5),
    fontWeight: '500',
    color: '#4B5563',
    textAlign: 'right',
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
  /** Couvre la carte : tap pour lire / mettre en pause (au-dessus de la vue vidéo) */
  videoTapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  videoPlayIconAboveTap: {
    zIndex: 3,
  },
  videoDurationAboveTap: {
    zIndex: 4,
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
  /** Favori sur photo / vidéo : disque fixe (pas une pilule). */
  feedFavoriteMediaCircle: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(24),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  feedFavoriteMediaCircleActive: {
    backgroundColor: THEME.feedFavoriteTerracottaSoftBg,
  },
  /** Favori ligne d’actions (vocal / texte) : même disque, fond neutre sur blanc. */
  feedFavoriteActionCircle: {
    width: scale(42),
    height: scale(42),
    borderRadius: scale(21),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  feedFavoriteActionCircleActive: {
    backgroundColor: THEME.feedFavoriteTerracottaSoftBg,
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
    minHeight: verticalScale(200),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: FEED_GUTTER,
    paddingVertical: verticalScale(16),
    gap: verticalScale(14),
    position: 'relative',
    overflow: 'hidden',
  },
  audioBodyWithCover: {
    minHeight: verticalScale(260),
    marginHorizontal: MEDIA_CARD_INSET,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: 'hidden',
    /** Plein bord : sinon le padding d’audioBody crée des bandes blanches sur les côtés de la photo */
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  voiceCoverBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  /** Voile blanc sur la photo de fond du vocal (lisibilité du lecteur) */
  voiceCoverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  audioForeground: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    alignItems: 'center',
    gap: verticalScale(12),
  },
  /** Lecteur + onde collés au bas de la zone image (post vocal avec fond) */
  audioForegroundCover: {
    position: 'absolute',
    left: scale(12),
    right: scale(12),
    bottom: verticalScale(10),
    zIndex: 2,
    alignItems: 'stretch',
    gap: 0,
  },
  audioPlayerWrap: {
    width: '100%',
    maxWidth: scale(340),
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
    marginTop: verticalScale(20),
  },
  /** `width: '100%'` : sans largeur explicite, le `Text` peut se comporter en shrink-wrap et la justification ne s’applique pas à chaque ligne après un `\n`. */
  textContent: {
    width: '100%',
    alignSelf: 'stretch',
    fontSize: scale(17),
    fontWeight: '400',
    color: '#1C1C1E',
    lineHeight: scale(28),
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
  /** Annotations sous photo / vidéo / vocal — Lora italic */
  captionAnnotation: {
    fontSize: scale(15),
    fontWeight: '400',
    color: '#1C1C1E',
    lineHeight: scale(24),
  },
  postActions: {
    marginHorizontal: 0,
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(12),
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: scale(8),
    backgroundColor: '#FFFFFF',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(4),
    paddingVertical: verticalScale(7),
    paddingHorizontal: scale(12),
    borderRadius: scale(100),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACTION_OUTLINE,
    backgroundColor: 'rgba(255,255,255,0.5)',
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
    color: '#8791A1',
    textAlign: 'center',
    marginBottom: verticalScale(6),
  },
  emptySubText: {
    fontSize: scale(13),
    color: '#8791A1',
    textAlign: 'center',
  },
  createButton: {
    marginTop: verticalScale(18),
    paddingHorizontal: scale(24),
    paddingVertical: verticalScale(12),
    backgroundColor: '#C4784A',
    borderRadius: scale(100),
  },
  createButtonText: {
    fontSize: scale(16),
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export {
  CAN_USE_AVATAR_BW_FILTER,
  HEADER_AVATAR_PX,
  HEADER_AVATAR_CM_STYLE,
  FEED_GUTTER,
  TEXT_POST_GUTTER,
  DAY_SEPARATOR_BLOCK_H,
  styles,
};

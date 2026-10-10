import {
  FEED_CAPTION_SCROLL_MAX_H,
  MEDIA_CARD_INSET,
} from '@/constants/feedLayout';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import { FEED_MEDIA_ASPECT_DEFAULT } from '@/utils/feedMediaAspect';
import { scale, verticalScale } from '@/utils/responsive';
import { memoryHasExplicitVoiceCover } from '@/utils/memoryPhotos';

/** Espacement inter-posts (`feedRowSpacingTop`). */
const ROW_SPACING_TOP = verticalScale(24);
/** Marges latérales carte (`postShell.marginHorizontal` × 2). */
const POST_SHELL_GUTTER = scale(16);
/** `postActions` paddingVertical ×2 + disque CTA. */
const POST_ACTIONS_H = verticalScale(24) + scale(40);
/** `postCaption` paddings si annotation. */
const CAPTION_PAD_V = verticalScale(26);
const CAPTION_LINE_H = scale(21);
/** Bloc date texte. */
const DAY_SEP_H = verticalScale(46);
/** Vocal avec cover — `audioBodyWithCover` minHeight. */
const VOICE_COVER_MIN_H = verticalScale(260);
/** Pending / batch placeholder. */
const PENDING_ROW_H = verticalScale(280);

function captionBlockHeight(content: string | null | undefined): number {
  const raw = (content ?? '').trim();
  if (!raw) return 0;
  const paras = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const lines = Math.max(1, paras.reduce((n, p) => n + Math.max(1, Math.ceil(p.length / 42)), 0));
  const body = Math.min(FEED_CAPTION_SCROLL_MAX_H, lines * CAPTION_LINE_H);
  return CAPTION_PAD_V + body;
}

function mediaHeight(screenW: number): number {
  const w = Math.max(1, screenW - POST_SHELL_GUTTER - 2 * MEDIA_CARD_INSET);
  return w / FEED_MEDIA_ASPECT_DEFAULT;
}

/**
 * Estimation synchrone de la hauteur d’une ligne fil (anti-saut FlatList).
 * Format carte unique 4/5 + coins arrondis (layout historique).
 */
export function estimateFeedRowHeight(
  item: FeedListItem,
  screenW: number,
  index: number,
): number {
  const spacing = index > 0 ? ROW_SPACING_TOP : 0;

  if (item.rowKind === 'batchSlot') {
    return spacing + PENDING_ROW_H;
  }
  if (item.rowKind === 'pending') {
    return spacing + PENDING_ROW_H;
  }

  const memory = item.memory;
  const captionH =
    memory.type !== 'text' ? captionBlockHeight(memory.content) : 0;

  if (memory.type === 'photo' || memory.type === 'video') {
    return spacing + mediaHeight(screenW) + captionH + POST_ACTIONS_H;
  }

  if (memory.type === 'voice') {
    const hasCover = memoryHasExplicitVoiceCover(memory);
    if (hasCover) {
      const coverH = Math.max(VOICE_COVER_MIN_H, mediaHeight(screenW));
      return spacing + coverH + captionH + POST_ACTIONS_H;
    }
    return spacing + verticalScale(120) + captionH + POST_ACTIONS_H;
  }

  if (memory.type === 'text') {
    const raw = (memory.content ?? '').trim() || ' ';
    const paras = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const lines = Math.max(3, paras.reduce((n, p) => n + Math.max(2, Math.ceil(p.length / 36)), 0));
    const titleH = memory.text_title?.trim() ? scale(37) : 0;
    const bodyH = Math.min(verticalScale(360), lines * scale(21) + verticalScale(64));
    return spacing + DAY_SEP_H + titleH + bodyH + POST_ACTIONS_H;
  }

  return spacing + mediaHeight(screenW) + POST_ACTIONS_H;
}

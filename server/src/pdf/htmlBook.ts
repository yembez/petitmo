import {
  DIGITAL_PAGE_HEIGHT_MM,
  DIGITAL_PAGE_WIDTH_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
  PRINT_BLEED_MM,
  BOOK_COVER_PHOTO_HEIGHT_RATIO,
  BOOK_VISUAL_MARGIN_MM,
  COVER_TITLE_SPINE_SAFE_EXTRA_MM,
  PDF_MEDIA_TEXT_PAD_X_MM,
  PHOTO_FULL_BAND_HEIGHT_RATIO,
  PHOTO_NOTE_INNER_MM,
  PHOTO_NOTE_BAND_HEIGHT_MM,
  PHOTO_FULL_FP_FOOTER_MM,
  PHOTO_FULL_FP_IMAGE_HEIGHT_MM,
} from '../constants/pdfDigitalSpec';
import type { BookPageServer } from '../types/contracts';
import type { ChildRow, MemoryRow } from './memoryRow';
import type { GelatoCoverLayout } from '../gelato/coverDimensions';
import { gelatoInnerPages } from '../gelato/photobookLayout';
import { memoryBookDisplayDateIso } from './memoryBookDisplayDate';
import { clampMediaBookCaption } from './mediaBookCaption';
import { coverCropFrameHtml } from './bookPhotoCropLayout';
import {
  audioWaveformSvg,
  bookPdfLocationLabel,
  dateWithAgeCaps,
  resolveTextMemoryBookLayout,
  textMemoryBodyAlignCenter,
  textMemoryBodyTextAlign,
} from './maquetteAlign';

const EM = '\u2003';

export type BuildBookHtmlInput = {
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  qrBaseUrl: string;
  exportMode: 'digital' | 'print';
  pages: BookPageServer[];
  child: ChildRow;
  coverPhotoUrl?: string | null;
  coverPhotoImgPxW?: number;
  coverPhotoImgPxH?: number;
  memoriesById: Map<string, MemoryRow>;
  /** memoryId → token ; QR = `${qrBaseUrl}/${token}` (ex: https://petitmo.app/m/{token}). */
  qrTokensByMemoryId: Map<string, string>;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgAttr(url: string | null | undefined): string {
  const t = (url ?? '').trim();
  if (!t) return '';
  // Ne pas remplacer `&` par `&amp;` : les URLs signées (query avec jeton) peuvent être mal
  // résolues par Chromium pour `<img src="…">`. Échapper uniquement les guillemets.
  return t.replace(/"/g, '&quot;');
}

function imgAttrFirst(urls: Array<string | null | undefined>): string {
  for (const u of urls) {
    const a = imgAttr(u);
    if (a) return a;
  }
  return '';
}

function mergedMemory(m: MemoryRow, textOverride?: string): MemoryRow {
  if (!textOverride) return m;
  return { ...m, content: textOverride };
}

type PhotoCrop = { xPct: number; yPct: number; scale: number };

/** Markup image cadre (cover / photo / A-V) — préfère wrapper HTML si crop custom. */
function croppedFrameHtml(
  srcAttr: string,
  crop: PhotoCrop | undefined,
  imgPxW: number | undefined,
  imgPxH: number | undefined,
  frameWmm: number,
  frameHmm: number,
  rotCss = '',
  lockFrameMm = false,
): string {
  return coverCropFrameHtml({
    srcAttr,
    crop,
    imgPxW,
    imgPxH,
    frameRefW: frameWmm,
    frameRefH: frameHmm,
    extraImgStyle: rotCss || undefined,
    lockFrameMm,
  });
}

function sanitizeText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFF0-\uFFFF\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
}

function romanHtml(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  return clean
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const lines = p.split(/\n/).map(l => l.trim()).filter(Boolean);
      const inner = lines.map(l => esc(EM + l)).join('<br/>\n');
      return `<p>${inner}</p>`;
    })
    .join('\n');
}

/** Paragraphes centrés sans alinéa (titre + corps centré, paliers lg/md). */
function romanHtmlCentered(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  return clean
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const lines = p.split(/\n/).map(l => l.trim()).filter(Boolean);
      const inner = lines.map(l => esc(l)).join('<br/>\n');
      return `<p>${inner}</p>`;
    })
    .join('\n');
}

/** Corps titre long (sm) : 1ʳᵉ ligne sans alinéa, paragraphes suivants avec cadratin. */
function romanHtmlTitledSm(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  const paragraphs = clean
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  return paragraphs
    .map(p => {
      const lines = p.split(/\n/).map(l => l.trim()).filter(Boolean);
      const inner = lines.map(l => esc(EM + l)).join('<br/>\n');
      return `<p>${inner}</p>`;
    })
    .join('\n');
}

/** Lettrine : 1ʳᵉ lettre hors alinéa, reste comme `romanHtml` sans cadratin sur le 1er paragraphe. */
function romanHtmlDropCap(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  const paragraphs = clean
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '';

  const firstPara = paragraphs[0]!;
  const capMatch = firstPara.match(/^(\p{L}|\p{N})/u);
  const cap = capMatch?.[0] ?? firstPara.charAt(0);
  const afterCap = capMatch ? firstPara.slice(capMatch.index! + cap.length) : firstPara.slice(1);
  const firstLines = afterCap.split(/\n/).map(l => l.trim()).filter(Boolean);
  const firstInner = firstLines
    .map((l, i) => (i === 0 ? esc(l) : esc(EM + l)))
    .join('<br/>\n');
  const firstP = `<p class="dropcap-p"><span class="text-dropcap">${esc(cap)}</span>${firstInner}</p>`;

  const rest = paragraphs.slice(1).map(p => {
    const lines = p.split(/\n/).map(l => l.trim()).filter(Boolean);
    const inner = lines.map(l => esc(EM + l)).join('<br/>\n');
    return `<p>${inner}</p>`;
  });
  return [firstP, ...rest].join('\n');
}

function monthCaps(label: string): string {
  return label.replace(/\b\w/g, c => c.toUpperCase());
}

function qrApiUrl(dataUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(dataUrl)}`;
}

function qrImgTag(dataUrl: string): string {
  if (!dataUrl) return '';
  const src = qrApiUrl(dataUrl);
  return `<img class="qr" src="${esc(src)}" alt="" />`;
}

function photoMainUrl(m: MemoryRow): string {
  return (
    m.print_url ??
    m.display_url ??
    m.edited_media_url ??
    m.media_url ??
    ''
  ).trim();
}

/** Slot album : `photoRef` HTTPS (upload guest) prioritaire sur le print_url primaire. */
function photoUrlForPage(m: MemoryRow, photoRef?: string | null): string {
  const ref = (photoRef ?? '').trim();
  if (/^https:\/\//i.test(ref)) return ref;
  // photoRef présent mais non-HTTPS : ne JAMAIS retomber sur le primaire (album ×N identiques).
  if (ref) return ref;
  return photoMainUrl(m);
}

function pageCover(
  child: ChildRow,
  coverPhotoUrl: string | null | undefined,
  title: string,
  yearLabel: string,
  crop: PhotoCrop | undefined,
  printBleed: boolean,
  coverImgPxW?: number,
  coverImgPxH?: number,
): string {
  const explicit = (coverPhotoUrl ?? '').trim();
  const src = explicit ? imgAttr(explicit) : imgAttr(child.photo_url);
  const bleedCls = printBleed ? ' bleed-x' : '';
  // Cadre = bandeau réel (parité maquette : pageW × pageH×142/216), pas 216:142.
  const pageWmm = printBleed ? PRINT_PAGE_WIDTH_MM : DIGITAL_PAGE_WIDTH_MM;
  const pageHmm = printBleed ? PRINT_PAGE_HEIGHT_MM : DIGITAL_PAGE_HEIGHT_MM;
  const coverFrameHmm = pageHmm * BOOK_COVER_PHOTO_HEIGHT_RATIO;
  const coverFrameWmm = printBleed ? pageWmm + 2 * PRINT_BLEED_MM : pageWmm;
  const visual = src
    ? croppedFrameHtml(src, crop, coverImgPxW, coverImgPxH, coverFrameWmm, coverFrameHmm)
    : '<div class="cover-placeholder"></div>';
  return `<div class="page cover">
  <div class="cover-photo${bleedCls}">
    ${visual}
  </div>
  <div class="cover-text">
    <div class="cover-title">${esc(title)}</div>
    <div class="cover-period">${esc(yearLabel)}</div>
    <div class="cover-hairline"></div>
  </div>
</div>`;
}

function pageChapter(month: string, chapterNum: number, chapterTitle: string, pageNum: number): string {
  return `<div class="page chapter">
  <div class="chapter-inner">
    <div class="chapter-month">${esc(monthCaps(month))}</div>
    <div class="chapter-title">${esc(chapterTitle)}</div>
    <div class="chapter-rule"></div>
    <div class="chapter-sub">Chapitre ${chapterNum}</div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pagePhotoFull(
  m: MemoryRow,
  rot: number,
  pageNum: number,
  crop: PhotoCrop | undefined,
  birthdate: string | null | undefined,
  variant: 'FP' | 'M' | undefined,
  printBleed: boolean,
  photoRef?: string | null,
  cropImgPxW?: number,
  cropImgPxH?: number,
): string {
  const src = imgAttr(photoUrlForPage(m, photoRef));
  const captionRaw = sanitizeText((m.content ?? '').trim());
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const captionHtml = captionRaw ? romanHtml(captionRaw) : '';
  const locLabel = bookPdfLocationLabel(m.location);
  const isFp = variant === 'FP';
  const variantCls = isFp ? ' pf-variant-fp' : ' pf-variant-m';
  const bleedCls = isFp && printBleed ? ' bleed-x' : '';
  const pageWmm = printBleed ? PRINT_PAGE_WIDTH_MM : DIGITAL_PAGE_WIDTH_MM;
  const pageHmm = printBleed ? PRINT_PAGE_HEIGHT_MM : DIGITAL_PAGE_HEIGHT_MM;
  let frameWmm: number;
  let frameHmm: number;
  if (isFp) {
    frameWmm = printBleed ? pageWmm + 2 * PRINT_BLEED_MM : pageWmm;
    frameHmm = printBleed
      ? PRINT_PAGE_HEIGHT_MM - PHOTO_FULL_FP_FOOTER_MM
      : PHOTO_FULL_FP_IMAGE_HEIGHT_MM;
  } else {
    frameWmm = pageWmm - 2 * BOOK_VISUAL_MARGIN_MM;
    frameHmm = pageHmm * PHOTO_FULL_BAND_HEIGHT_RATIO - 2 * BOOK_VISUAL_MARGIN_MM;
  }
  const visual = src
    ? croppedFrameHtml(src, crop, cropImgPxW, cropImgPxH, frameWmm, frameHmm, rotCss, !isFp)
    : '<div class="placeholder" style="width:100%;height:100%;"></div>';
  const margin = BOOK_VISUAL_MARGIN_MM;
  const imageInner = isFp
    ? visual
    : `<div class="pn-visual-frame" style="left:${margin}mm;top:${margin}mm;width:${frameWmm.toFixed(3)}mm;height:${frameHmm.toFixed(3)}mm;">${visual}</div>`;
  return `<div class="page photo-full-stack${variantCls}">
  <div class="pf-image${bleedCls}">
    ${imageInner}
  </div>
  <div class="pf-footer">
    <div class="pf-meta-row">
      <div class="pf-meta">${esc(dateWithAgeCaps(memoryBookDisplayDateIso(m), birthdate))}</div>
      ${locLabel ? `<div class="pf-meta pf-meta-loc">${esc(locLabel)}</div>` : ''}
    </div>
    <div class="pf-body-wrap">${captionHtml ? `<div class="pf-caption body text-memory-editorial">${captionHtml}</div>` : ''}</div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pagePhotoNote(
  m: MemoryRow,
  rot: number,
  pageNum: number,
  crop: PhotoCrop | undefined,
  birthdate: string | null | undefined,
  photoRef?: string | null,
  cropImgPxW?: number,
  cropImgPxH?: number,
): string {
  const src = imgAttr(photoUrlForPage(m, photoRef));
  const legend = sanitizeText((m.content ?? '').trim());
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const locLabel = bookPdfLocationLabel(m.location);
  const pageWmm = DIGITAL_PAGE_WIDTH_MM;
  const frameWmm = pageWmm - 2 * BOOK_VISUAL_MARGIN_MM;
  const frameHmm = PHOTO_NOTE_BAND_HEIGHT_MM - 2 * BOOK_VISUAL_MARGIN_MM;
  const margin = BOOK_VISUAL_MARGIN_MM;
  const visual = src
    ? croppedFrameHtml(src, crop, cropImgPxW, cropImgPxH, frameWmm, frameHmm, rotCss, true)
    : '<div class="placeholder" style="width:100%;height:100%;"></div>';
  return `<div class="page photo-note">
  <div class="pn-image">
    <div class="pn-visual-frame" style="left:${margin}mm;top:${margin}mm;width:${frameWmm.toFixed(3)}mm;height:${frameHmm.toFixed(3)}mm;">
      ${visual}
    </div>
  </div>
  <div class="pn-text">
    <div class="pn-meta-row">
      <div class="label">${esc(dateWithAgeCaps(memoryBookDisplayDateIso(m), birthdate))}</div>
      ${locLabel ? `<div class="label pn-meta-loc">${esc(locLabel)}</div>` : ''}
    </div>
    <div class="pn-body-wrap">${legend ? `<div class="body text-memory-editorial">${romanHtml(legend)}</div>` : ''}</div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageQuote(
  m: MemoryRow,
  pageNum: number,
  birthdate: string | null | undefined
): string {
  const layout = resolveTextMemoryBookLayout(m);
  const { body, tier, variant, title } = layout;
  const centerBody = textMemoryBodyAlignCenter(tier, variant);
  const bodyTextAlign = textMemoryBodyTextAlign(tier, variant);
  const locLabel = bookPdfLocationLabel(m.location);
  const bodyHtml = centerBody ? romanHtmlCentered(body) : romanHtml(body);
  const titledSmBodyHtml = romanHtmlTitledSm(body);

  const titleBlock =
    variant === 'titled' && title
      ? `<div class="text-memory-title-block">
      <div class="text-memory-title text-tier-${tier}">${esc(title)}</div>
      <div class="text-memory-title-rule text-tier-${tier}"></div>
    </div>`
      : '';

  let midInner = '';
  if (variant === 'guillemet') {
    midInner = `<div class="quote-mark">\u201C</div>
      <div class="body quote-body text-memory-editorial quote-guillemet-body" style="text-align:${bodyTextAlign}">${bodyHtml}</div>
      <div class="quote-guillemet-rule"></div>`;
  } else if (variant === 'dropcap') {
    midInner = `<div class="body quote-body text-memory-editorial text-tier-${tier} quote-dropcap-body">${romanHtmlDropCap(body)}</div>`;
  } else if (variant === 'titled' && tier === 'sm') {
    midInner = `<div class="body quote-body text-memory-editorial text-tier-${tier} quote-titled-sm-body">${titledSmBodyHtml}</div>`;
  } else {
    midInner = `<div class="body quote-body text-memory-editorial text-tier-${tier}" style="text-align:${bodyTextAlign}">${bodyHtml}</div>`;
  }

  return `<div class="page quote quote-variant-${variant}">
  <div class="inner quote-inner quote-tier-${tier}">
    <div class="quote-header">
      <span class="dot sage"></span>
      <span class="label" style="color:#6B8F7E;text-transform:none;">Petits mots</span>
    </div>
    <div class="quote-mid quote-mid-${variant} quote-tier-${tier}">
      <div class="text-memory-column text-tier-${tier}">
      ${titleBlock}
      ${midInner}
      </div>
    </div>
    <div class="quote-footer-block">
      <div class="quote-rule">
        <div class="quote-rule-seg"></div>
        <div class="quote-rule-dot"></div>
        <div class="quote-rule-seg"></div>
      </div>
      <div class="quote-meta-row">
        <div class="label">${esc(dateWithAgeCaps(memoryBookDisplayDateIso(m), birthdate))}</div>
        ${locLabel ? `<div class="label quote-meta-loc">${esc(locLabel)}</div>` : ''}
      </div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function mediaQrVisualFallbackHtml(kind: 'audio' | 'video', memoryId: string): string {
  const accent = kind === 'audio' ? '#5C8FA6' : '#6B8F7E';
  const wave =
    kind === 'audio'
      ? `<div class="media-qr-fallback-wave">${audioWaveformSvg(memoryId)}</div>`
      : '';
  return `<div class="media-qr-visual-fallback">
    <div class="media-qr-fallback-ring" style="border-color:${accent}73">
      <span class="media-qr-fallback-play" style="color:${accent}">▶</span>
    </div>
    ${wave}
  </div>`;
}

/** Pictogramme type média (haut-parleur / caméra) — tracé identique à la maquette (`MediaTypeIcon`). */
function mediaTypeIconSvg(kind: 'audio' | 'video'): string {
  const open =
    '<svg class="media-qr-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  const paths =
    kind === 'audio'
      ? '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
      : '<path d="M23 7 16 12 23 17Z"/><path d="M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>';
  return `${open}${paths}</svg>`;
}

function pageMediaQr(
  kind: 'audio' | 'video',
  m: MemoryRow,
  qrUrl: string,
  pageNum: number,
  rot: number,
  crop: PhotoCrop | undefined,
  birthdate: string | null | undefined,
  cropImgPxW?: number,
  cropImgPxH?: number,
): string {
  const captionRaw = clampMediaBookCaption(sanitizeText((m.content ?? '').trim()));
  const captionHtml = captionRaw ? romanHtml(captionRaw) : '';
  const visualUrl =
    kind === 'audio' ? imgAttr(m.voice_cover_url) : imgAttrFirst([m.poster_print_url, m.poster_url, m.thumbnail_url]);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const locLabel = bookPdfLocationLabel(m.location);
  const typeLabel = kind === 'audio' ? 'Audio' : 'Video';
  const qrHint = kind === 'audio' ? 'Scanner pour écouter' : 'Scanner pour visionner';

  const pageWmm = DIGITAL_PAGE_WIDTH_MM;
  const frameWmm = pageWmm - 2 * BOOK_VISUAL_MARGIN_MM;
  const frameHmm = PHOTO_NOTE_BAND_HEIGHT_MM - 2 * BOOK_VISUAL_MARGIN_MM;
  const margin = BOOK_VISUAL_MARGIN_MM;

  // Pages A/V : toujours object-fit cover (ignorer crop custom PDF).
  // Le chemin crop custom + dims laissait le poster du 27 mai invisible sous Chromium
  // alors que le 29 mai (crop neutre) s’affichait. Marges via pn-visual-frame en mm.
  const visualInner = visualUrl
    ? croppedFrameHtml(visualUrl, undefined, undefined, undefined, frameWmm, frameHmm, '', true)
    : mediaQrVisualFallbackHtml(kind, m.id);

  return `<div class="page media-qr media-qr-${kind} audio-note-layout">
  <div class="pn-image">
    <div class="pn-visual-frame" style="left:${margin}mm;top:${margin}mm;width:${frameWmm.toFixed(3)}mm;height:${frameHmm.toFixed(3)}mm;">
      ${visualInner}
    </div>
  </div>
  <div class="pn-text media-qr-below">
    <div class="media-qr-meta-row">
      <span class="label media-qr-meta-date">${esc(dateWithAgeCaps(memoryBookDisplayDateIso(m), birthdate))}</span>
      ${locLabel ? `<span class="label media-qr-meta-loc">${esc(locLabel)}</span>` : ''}
    </div>
    <div class="media-qr-sep"></div>
    <div class="media-qr-body-wrap">
      <div class="media-qr-body-row">
        <div class="media-qr-caption text-memory-editorial">${captionHtml}</div>
        <div class="media-qr-card">
          <div class="label media-qr-card-hint">${qrHint}</div>
          <div class="media-qr-card-qr">${qrImgTag(qrUrl)}</div>
          <div class="media-qr-card-type">
            <span class="label media-qr-card-type-label">${typeLabel}</span>
            ${mediaTypeIconSvg(kind)}
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageAudio(
  m: MemoryRow,
  qrUrl: string,
  pageNum: number,
  rot: number,
  crop: PhotoCrop | undefined,
  birthdate: string | null | undefined,
  cropImgPxW?: number,
  cropImgPxH?: number,
): string {
  return pageMediaQr('audio', m, qrUrl, pageNum, rot, crop, birthdate, cropImgPxW, cropImgPxH);
}

function pageVideo(
  m: MemoryRow,
  qrUrl: string,
  pageNum: number,
  rot: number,
  crop: PhotoCrop | undefined,
  birthdate: string | null | undefined,
  cropImgPxW?: number,
  cropImgPxH?: number,
): string {
  return pageMediaQr('video', m, qrUrl, pageNum, rot, crop, birthdate, cropImgPxW, cropImgPxH);
}

function pageBackCover(pageNum: number): string {
  return `<div class="page back-cover">
  <div class="back-inner">
    <div class="subtitle" style="color:#AEAEB2;">Chaque moment compte.</div>
    <div class="label" style="margin-top:8pt;">petitmo · vos souvenirs pour toujours</div>
    <div class="chapter-rule" style="margin-top:12pt;"></div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageGelatoBlankEndpaper(): string {
  return `<div class="page gelato-endpaper"></div>`;
}

function pageGelatoWraparoundSpread(
  layout: GelatoCoverLayout,
  input: BuildBookHtmlInput,
  child: ChildRow,
  coverPhotoUrl: string | null | undefined,
  coverPhotoImgPxW?: number,
  coverPhotoImgPxH?: number,
): string {
  const { contentFront, contentBack, spine, spreadWidthMm, spreadHeightMm } = layout;
  const explicit = (coverPhotoUrl ?? '').trim();
  const src = explicit ? imgAttr(explicit) : imgAttr(child.photo_url);
  const coverCrop = input.pages.find(p => p.type === 'cover')?.crop;

  /**
   * Parité maquette : photo flush haut / côtés du panneau avant.
   * `contentFront` Gelato = zone safe (inset ~20 mm du wraparound) — si on y confine
   * la photo, le preview commande montre des bandes blanches. On étend la photo dans
   * le fond perdu haut + droite jusqu’au bord du spread.
   */
  const photoLeftMm = contentFront.leftMm;
  const photoTopMm = 0;
  const photoWidthMm = Math.max(contentFront.widthMm, spreadWidthMm - contentFront.leftMm);
  const photoHeightMm =
    contentFront.topMm + contentFront.heightMm * BOOK_COVER_PHOTO_HEIGHT_RATIO;
  const spacerPct = (BOOK_COVER_PHOTO_HEIGHT_RATIO * 100).toFixed(2);

  const visual = src
    ? croppedFrameHtml(
        src,
        coverCrop,
        coverPhotoImgPxW,
        coverPhotoImgPxH,
        photoWidthMm,
        photoHeightMm,
      )
    : '<div class="cover-placeholder"></div>';

  const spineTitle = esc(input.coverTitle.slice(0, 48));

  return `<div class="page">
  <div class="gw-canvas" style="width:${spreadWidthMm}mm;height:${spreadHeightMm}mm;">
    <div class="gw-panel gw-back" style="left:${contentBack.leftMm}mm;top:${contentBack.topMm}mm;width:${contentBack.widthMm}mm;height:${contentBack.heightMm}mm;">
      <div class="gw-back-inner">
        <div class="subtitle" style="color:#AEAEB2;">Chaque moment compte.</div>
        <div class="label" style="margin-top:8pt;">petitmo · vos souvenirs pour toujours</div>
        <div class="chapter-rule" style="margin-top:12pt;"></div>
      </div>
    </div>
    <div class="gw-panel gw-spine" style="left:${spine.leftMm}mm;top:${spine.topMm}mm;width:${spine.widthMm}mm;height:${spine.heightMm}mm;">
      <div class="gw-spine-title">${spineTitle}</div>
    </div>
    <div class="gw-front-photo-bleed" style="left:${photoLeftMm}mm;top:${photoTopMm}mm;width:${photoWidthMm}mm;height:${photoHeightMm}mm;">
      ${visual}
    </div>
    <div class="gw-panel gw-front" style="left:${contentFront.leftMm}mm;top:${contentFront.topMm}mm;width:${contentFront.widthMm}mm;height:${contentFront.heightMm}mm;">
      <div class="gw-front-photo-spacer" style="height:${spacerPct}%;"></div>
      <div class="gw-front-text">
        <div class="cover-title">${esc(input.coverTitle)}</div>
        <div class="cover-period">${esc(input.coverYearLabel)}</div>
        <div class="cover-hairline"></div>
      </div>
    </div>
  </div>
</div>`;
}

function renderPage(page: BookPageServer, input: BuildBookHtmlInput, pageNum: number, _pageWmm: number): string {
  const { child, coverTitle, coverYearLabel, chapterTitle, qrBaseUrl, coverPhotoUrl, coverPhotoImgPxW, coverPhotoImgPxH, memoriesById, qrTokensByMemoryId } =
    input;
  const printBleed = input.exportMode === 'print';
  switch (page.type) {
    case 'cover':
      return pageCover(
        child,
        coverPhotoUrl,
        coverTitle,
        coverYearLabel,
        page.crop,
        printBleed,
        coverPhotoImgPxW,
        coverPhotoImgPxH
      );
    case 'chapter':
      return pageChapter(page.month ?? '', page.chapterNum ?? 0, chapterTitle, pageNum);
    case 'photo-full':
    case 'photo-note':
    case 'quote':
    case 'audio':
    case 'video': {
      const id = page.memoryId;
      if (!id) return '';
      const raw = memoriesById.get(id);
      if (!raw) return '';
      const m = mergedMemory(raw, page.textOverride);
      const rot = page.rotation ?? 0;
      const crop = page.crop;
      const birthdate = child.birthdate;
      switch (page.type) {
        case 'photo-full':
          return pagePhotoFull(
            m,
            rot,
            pageNum,
            crop,
            birthdate,
            page.variant,
            printBleed,
            page.photoRef,
            page.cropImgPxW,
            page.cropImgPxH,
          );
        case 'photo-note':
          return pagePhotoNote(
            m,
            rot,
            pageNum,
            crop,
            birthdate,
            page.photoRef,
            page.cropImgPxW,
            page.cropImgPxH,
          );
        case 'quote':
          return pageQuote(m, pageNum, birthdate);
        case 'audio': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/${tok}` : '';
          return pageAudio(m, qrTarget, pageNum, rot, crop, birthdate, page.cropImgPxW, page.cropImgPxH);
        }
        case 'video': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/${tok}` : '';
          return pageVideo(m, qrTarget, pageNum, rot, crop, birthdate, page.cropImgPxW, page.cropImgPxH);
        }
        default:
          return '';
      }
    }
    case 'back-cover':
      return pageBackCover(pageNum);
    default:
      return '';
  }
}

function buildHtmlDocument(
  title: string,
  pagesHtml: string,
  pageWmm: number,
  pageHmm: number,
  isPrint: boolean,
  gelatoSpread?: { widthMm: number; heightMm: number },
): string {
  const bleedMm = isPrint ? PRINT_BLEED_MM : 0;
  const pnImgHmm = (PHOTO_NOTE_INNER_MM + 2 * BOOK_VISUAL_MARGIN_MM).toFixed(2);
  const coverPhotoHmm = (pageHmm * BOOK_COVER_PHOTO_HEIGHT_RATIO).toFixed(2);
  const pfImgHmm = (pageHmm * PHOTO_FULL_BAND_HEIGHT_RATIO).toFixed(2);
  const gelatoPageCss = gelatoSpread
    ? `
@page gelato-spread { size: ${gelatoSpread.widthMm}mm ${gelatoSpread.heightMm}mm; margin: 0; }
.page.gelato-wraparound {
  page: gelato-spread;
  width: ${gelatoSpread.widthMm}mm;
  height: ${gelatoSpread.heightMm}mm;
}
.gw-canvas { position: relative; background: #fff; overflow: hidden; }
.gw-panel { position: absolute; overflow: hidden; background: #fff; }
.gw-front { background: transparent; }
.gw-back-inner {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  padding: 0 12mm;
}
.gw-spine {
  display: flex; align-items: center; justify-content: center;
  background: #fff;
}
.gw-spine-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-family: 'EB Garamond', serif;
  font-style: italic;
  font-size: 8pt;
  color: #1C1C1E;
  max-height: 90%;
  overflow: hidden;
  text-align: center;
}
.gw-front { display: flex; flex-direction: column; }
.gw-front-photo-bleed {
  position: absolute;
  overflow: hidden;
  background: #fff;
  z-index: 1;
}
.gw-front-photo-spacer {
  width: 100%;
  flex-shrink: 0;
  /* Réserve la place sous la photo bleed (qui déborde au-dessus de contentFront). */
}
.gw-front-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  z-index: 2;
  background: #fff;
  /* +${COVER_TITLE_SPINE_SAFE_EXTRA_MM}mm à gauche : marge hinge / rigole Gelato */
  padding: 3mm 8mm 6mm ${8 + COVER_TITLE_SPINE_SAFE_EXTRA_MM}mm;
}
.page.gelato-endpaper { background: #fff; }
`
    : '';
  const bodyClass = isPrint ? ' class="print-bleed"' : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&amp;family=EB+Garamond:ital,wght@0,400;1,400&amp;family=Roboto:wght@400&amp;display=swap" rel="stylesheet" />
<style>

* { margin:0; padding:0; box-sizing:border-box;
    -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
:root {
  --page-w:${pageWmm}mm;
  --page-h:${pageHmm}mm;
  --bleed:${bleedMm}mm;
  --pn-img-h:${pnImgHmm}mm;
  --cover-photo-h:${coverPhotoHmm}mm;
  --pf-img-h:${pfImgHmm}mm;
  --pf-fp-footer-h:${PHOTO_FULL_FP_FOOTER_MM}mm;
  --pf-fp-img-h:calc(var(--page-h) - var(--pf-fp-footer-h));
  --pad-x:15mm;
  --pad-x-safe:calc(15mm + var(--bleed));
  --cover-title-pad-left:calc(var(--pad-x) + ${COVER_TITLE_SPINE_SAFE_EXTRA_MM}mm);
  --cover-title-pad-left-safe:calc(var(--pad-x-safe) + ${COVER_TITLE_SPINE_SAFE_EXTRA_MM}mm);
  --media-pad-x:${PDF_MEDIA_TEXT_PAD_X_MM}mm;
  --media-pad-x-safe:calc(${PDF_MEDIA_TEXT_PAD_X_MM}mm + var(--bleed));
  --visual-margin:${BOOK_VISUAL_MARGIN_MM}mm;
}
html { margin:0; padding:0; background:#fff; }
body {
  margin:0; padding:0;
  width:var(--page-w);
  display:block;
}
@page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }

img { display:block; }

.page {
  width:var(--page-w);
  height:var(--page-h);
  overflow:hidden;
  position:relative;
  display:flex;
  flex-direction:column;
  background:#fff;
  font-size:12pt;
  line-height:normal;
  page-break-after: always;
  break-after: page;
}
.page:last-of-type {
  page-break-after: auto;
  break-after: auto;
}

.inner {
  display:flex; flex-direction:column;
  padding:18mm var(--pad-x);
  width:100%; flex:1;
  min-height:0;
  overflow:hidden;
}
body.print-bleed .inner {
  padding-left:var(--pad-x-safe);
  padding-right:var(--pad-x-safe);
}

.label {
  font-family:'DM Sans',sans-serif; font-size:7pt; font-weight:400;
  color:#AEAEB2; letter-spacing:.3pt; text-transform:uppercase;
}
.subtitle {
  font-family:'EB Garamond',serif; font-style:italic;
  font-size:13pt; line-height:1.4; color:#1C1C1E;
}
.body {
  font-family:'EB Garamond',serif; font-style:italic;
  font-size:11pt; line-height:1.65; color:#1C1C1E; text-align:justify;
}
.body p { margin:0 0 6pt; }
.memory-text {
  font-family:'Roboto',sans-serif;
  font-style:normal;
  font-weight:400;
  font-size:11.25pt;
  line-height:1.588;
  text-align:justify;
}
.folio {
  position:absolute; bottom:8mm; left:0; right:0;
  text-align:center; font-family:'DM Sans',sans-serif; font-size:7pt; color:#C7C7CC;
}
.folio-white { color:rgba(255,255,255,.5); }

.dot { display:inline-block; width:6pt; height:6pt; border-radius:50%; }
.sage { background:#6B8F7E; }
.vocal { background:#5C8FA6; }

.cover { flex-direction:column; }
.cover-photo { width:var(--page-w); height:var(--cover-photo-h); overflow:hidden; flex-shrink:0; }
.crop-frame { position:relative; overflow:hidden; width:100%; height:100%; max-height:100%; }
.crop-img {
  position:absolute;
  inset:-1px;
  width:calc(100% + 2px);
  height:calc(100% + 2px);
  object-fit:cover;
  max-width:none;
}
.cover-placeholder { width:100%; height:100%; background:#E8E8ED; }
.cover-text {
  flex:1; display:flex; flex-direction:column; justify-content:center;
  padding:4mm var(--pad-x) 10mm var(--cover-title-pad-left);
}
body.print-bleed .cover-text {
  padding-left:var(--cover-title-pad-left-safe);
  padding-right:var(--pad-x-safe);
}
.cover-title {
  font-family:'EB Garamond',serif; font-style:italic; font-size:22pt; color:#1C1C1E;
}
.cover-period { font-family:'DM Sans',sans-serif; font-size:11pt; color:#AEAEB2; margin-top:5pt; }
.cover-hairline { height:.3pt; background:rgba(0,0,0,.08); margin-top:10pt; width:100%; }

.chapter-inner {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
  padding:0 var(--pad-x);
}
body.print-bleed .chapter-inner {
  padding-left:var(--pad-x-safe);
  padding-right:var(--pad-x-safe);
}
.chapter-month { font-family:'DM Sans',sans-serif; font-size:9pt; color:#AEAEB2; letter-spacing:.6pt; }
.chapter-title {
  font-family:'EB Garamond',serif; font-style:italic; font-size:22pt; color:#1C1C1E; margin-top:8pt;
}
.chapter-rule { width:20mm; height:.3pt; background:rgba(0,0,0,.08); margin-top:14pt; }
.chapter-sub { font-family:'DM Sans',sans-serif; font-size:9pt; color:#AEAEB2; margin-top:10pt; }

.photo-full-stack { flex-direction:column; }
.pf-image {
  width:var(--page-w); flex:0 0 auto; flex-shrink:0; overflow:hidden;
  box-sizing:border-box; background:#FFFFFF; position:relative;
}
.pf-variant-m .pf-image {
  height:var(--pf-img-h);
  padding:0;
}
.pf-variant-fp .pf-image {
  height:var(--pf-fp-img-h);
  padding:0;
}
.pf-footer {
  overflow:hidden;
  padding:3.7mm var(--media-pad-x) 10mm;
  display:flex; flex-direction:column;
  box-sizing:border-box;
}
.pf-variant-m .pf-footer {
  flex:1; min-height:0;
  margin-top:-7mm; padding-top:0;
}
.pf-body-wrap {
  flex:1; min-height:0;
  display:flex; flex-direction:column; justify-content:center;
}
.pf-variant-fp .pf-footer {
  flex:0 0 var(--pf-fp-footer-h);
  height:var(--pf-fp-footer-h);
  min-height:var(--pf-fp-footer-h);
  max-height:var(--pf-fp-footer-h);
}
body.print-bleed .pf-footer {
  padding-left:var(--media-pad-x-safe);
  padding-right:var(--media-pad-x-safe);
}
.pf-meta {
  font-family:'DM Sans',sans-serif; font-size:7pt; font-weight:400;
  color:#AEAEB2; letter-spacing:.3pt; text-transform:uppercase;
}
.pf-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:3mm; flex-shrink:0;
}
.pf-meta-loc {
  font-family:'DM Sans',sans-serif; font-size:7pt; font-weight:600;
  color:#AEAEB2; letter-spacing:.15pt; text-transform:none; text-align:right;
  flex:1; min-width:0;
}
.pf-caption { margin-top:0; font-size:14pt; line-height:1.3; }
.pf-caption.text-memory-editorial { font-size:14pt; line-height:1.3; text-align:justify; }
.placeholder { background:#F2F2F7; }

.photo-note { flex-direction:column; }
.pn-image {
  width:var(--page-w); height:var(--pn-img-h); flex:0 0 var(--pn-img-h);
  max-height:var(--pn-img-h); flex-shrink:0; overflow:hidden;
  box-sizing:border-box; padding:0; background:#FFFFFF;
  position:relative;
}
/* Parité maquette VisualBand : marges = cadre absolu en mm (inline) + clip.
   Pas de padding ni calc(var) — Chromium print les gère mal. */
.pn-visual-frame {
  position:absolute;
  overflow:hidden;
  background:#FFFFFF;
  clip-path:inset(0);
  -webkit-clip-path:inset(0);
}
.pn-text {
  flex:1; min-height:0; overflow:hidden;
  padding:4mm var(--media-pad-x) 14mm;
}
.photo-note .pn-text {
  display:flex; flex-direction:column;
  margin-top:-7mm; padding-top:0;
}
.pn-body-wrap {
  flex:1; min-height:0;
  display:flex; flex-direction:column; justify-content:center;
}
body.print-bleed .pn-text {
  padding-left:var(--media-pad-x-safe);
  padding-right:var(--media-pad-x-safe);
}
.pn-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:3mm; flex-shrink:0; margin-bottom:2mm;
}
.pn-meta-loc {
  font-weight:600; color:#AEAEB2; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}
.photo-note .pn-text .body.text-memory-editorial {
  font-size:14pt; line-height:1.35; text-align:justify;
}

body.print-bleed .bleed-x {
  margin-left:calc(-1 * var(--bleed));
  width:calc(var(--page-w) + 2 * var(--bleed));
  max-width:none;
  box-sizing:border-box;
}

.quote .inner { padding-top:14mm; padding-bottom:14mm; padding-left:18mm; padding-right:18mm; }
.quote-inner {
  justify-content:flex-start;
  display:flex;
  flex-direction:column;
  flex:1;
  min-height:0;
}
.quote-tier-lg { padding-top:13mm; padding-bottom:13mm; }
.quote-tier-md { padding-top:12mm; padding-bottom:12mm; }
.quote-tier-sm { padding-top:11mm; padding-bottom:11mm; }
.quote-header {
  display:flex; align-items:center; gap:4pt;
  flex-shrink:0;
}
.quote-mid {
  flex:1;
  min-height:0;
  display:flex;
  flex-direction:column;
  justify-content:center;
  padding:0 3mm;
  overflow:hidden;
}
.quote-mid-dropcap { justify-content:center; }
.quote-mid-titled { justify-content:center; }
.text-memory-editorial {
  font-family:'EB Garamond',serif;
  font-style:normal;
  font-weight:400;
  color:#1C1C1E;
}
.text-memory-title-block {
  text-align:center;
  flex-shrink:0;
}
.text-memory-title {
  font-family:'EB Garamond',serif;
  font-style:normal;
  font-weight:400;
  color:#1C1C1E;
}
.text-tier-lg.text-memory-title { font-size:28pt; line-height:1.15; }
.text-tier-md.text-memory-title { font-size:26pt; line-height:1.2; }
.text-tier-sm.text-memory-title { font-size:24pt; line-height:1.2; }
.text-memory-title-rule {
  height:.3pt;
  background:rgba(0,0,0,.12);
  margin:4mm auto 0;
}
.text-tier-lg.text-memory-title-rule { width:24mm; }
.text-tier-md.text-memory-title-rule { width:30mm; }
.text-tier-sm.text-memory-title-rule { width:30mm; }
.text-memory-column {
  width:100%;
  max-width:140mm;
  margin-left:auto;
  margin-right:auto;
}
.quote-variant-titled.quote-tier-lg .text-memory-column { max-width:128mm; }
.quote-variant-titled.quote-tier-md .text-memory-column { max-width:140mm; }
.quote-variant-titled.quote-tier-sm .text-memory-column { max-width:132mm; }
.quote-variant-guillemet.quote-tier-lg .text-memory-column { max-width:112mm; }
.quote-variant-dropcap.quote-tier-md .text-memory-column { max-width:136mm; }
.quote-variant-dropcap.quote-tier-sm .text-memory-column { max-width:130mm; }
/* Espacements Petits mots — valeurs = pdfPreviewTypo.ts (PDF_TEXT_MEMORY_*_MM, PDF_GUILLEMET_*) */
.quote-variant-titled.quote-tier-lg .text-memory-title-block { margin-bottom:5mm; }
.quote-variant-titled.quote-tier-md .text-memory-title-block { margin-bottom:4.5mm; }
.quote-variant-titled.quote-tier-sm .text-memory-title-block { margin-bottom:4mm; }
.quote-footer-block {
  flex-shrink:0;
  margin-top:auto;
  padding-top:2mm;
}
.quote-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:3mm; margin-top:6pt; flex-shrink:0;
}
.quote-meta-loc {
  font-weight:600; color:#AEAEB2; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}
.quote-mark {
  font-family:'EB Garamond',serif; font-style:italic; font-weight:400;
  font-size:52pt; color:#6B8F7E; line-height:1; margin-bottom:4mm;
  text-align:center; align-self:center;
}
.quote-guillemet-body {
  font-size:22pt; line-height:1.48;
  margin-bottom:5mm;
}
.quote-guillemet-body p { margin:0; }
.quote-guillemet-rule {
  width:28mm; height:.3pt; background:rgba(0,0,0,.12);
  margin:2mm auto 0;
}
.quote-inline-rule {
  display:flex; align-items:center; gap:4pt; margin:4mm auto 0; width:42%;
}
.quote-body { overflow:hidden; }
.quote-tier-lg .quote-body { font-size:20pt; line-height:1.52; }
.quote-tier-lg .quote-body p { margin:0 0 5pt; }
.quote-tier-md .quote-body { font-size:16pt; line-height:1.5; }
.quote-tier-md .quote-body p { margin:0 0 4pt; }
.quote-tier-sm .quote-body { font-size:11.25pt; line-height:1.4; }
.quote-tier-sm .quote-body p { margin:0 0 3pt; }
.quote-variant-guillemet .quote-mark { display:block; }
.quote-dropcap-body { text-align:left; }
.quote-variant-dropcap.quote-tier-md .quote-dropcap-body {
  font-size:16pt; line-height:1.52;
}
.quote-variant-dropcap.quote-tier-sm .quote-dropcap-body {
  font-size:14pt; line-height:1.52;
}
.quote-titled-sm-body { text-align:left; }
.quote-variant-titled.quote-tier-sm .quote-titled-sm-body {
  font-size:14pt; line-height:1.52;
}
.quote-titled-sm-body p { margin:0 0 5.5mm; text-align:left; }
.quote-titled-sm-body p:last-child { margin-bottom:0; }
.quote-dropcap-body .dropcap-p { margin:0 0 5.5mm; text-align:left; }
.quote-dropcap-body p { margin:0 0 5.5mm; text-align:left; }
.quote-dropcap-body p:last-child,
.quote-dropcap-body .dropcap-p:last-child { margin-bottom:0; }
.text-dropcap {
  float:left;
  font-family:'EB Garamond',serif;
  font-weight:400;
  line-height:.82;
  margin-right:3pt;
}
.quote-tier-md .text-dropcap { font-size:52pt; }
.quote-tier-sm .text-dropcap { font-size:46pt; }
.quote-rule { display:flex; align-items:center; gap:4pt; margin-top:6mm; }
.quote-rule-seg { flex:1; height:.3pt; background:rgba(0,0,0,.08); }
.quote-rule-dot { width:4pt; height:4pt; border-radius:50%; background:rgba(0,0,0,.08); }

/* Audio / vidéo : même squelette que photo-note (image bords + bandeau bas + QR). */
.audio-note-layout { flex-direction:column; }
.media-qr-below {
  display:flex;
  flex-direction:column;
  flex:1 1 auto;
  min-height:52mm;
  margin-top:-7mm;
  padding-top:0;
  overflow:visible;
  position:relative;
  z-index:2;
  background:#FFFFFF;
}
.media-qr-meta-row {
  display:flex;
  flex-direction:row;
  justify-content:space-between;
  align-items:flex-start;
  width:100%;
  gap:3mm;
  flex-shrink:0;
  padding-bottom:2mm;
}
.media-qr-meta-date { flex-shrink:0; text-align:left; }
.media-qr-meta-loc {
  font-weight:600; color:#AEAEB2; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}
.media-qr-sep {
  height:.3pt;
  background:rgba(0,0,0,.12);
  width:100%;
  flex-shrink:0;
}
.media-qr-body-wrap {
  flex:1;
  min-height:0;
  display:flex;
  align-items:center;
}
.media-qr-body-row {
  display:flex;
  flex-direction:row;
  align-items:center;
  gap:6mm;
  width:100%;
}
.media-qr-caption {
  flex:1;
  min-width:0;
  font-family:'EB Garamond',serif;
  font-style:normal;
  font-weight:400;
  font-size:14pt;
  line-height:1.5;
  color:#1C1C1E;
  text-align:left;
}
.media-qr-caption p { margin:0; }
.media-qr-card {
  flex:0 0 auto;
  width:38mm;
  box-sizing:border-box;
  padding:4mm;
  border:.5pt solid #D8D8DD;
  border-radius:0;
  background:#FFFFFF;
  display:flex;
  flex-direction:column;
}
.media-qr-card-hint { color:#AEAEB2; text-align:left; }
.media-qr-card-qr {
  display:flex;
  align-items:center;
  justify-content:center;
  margin:4mm 0;
}
.media-qr-card .qr { width:18mm; height:18mm; display:block; }
.media-qr-card-type {
  display:flex;
  flex-direction:row;
  align-items:center;
  justify-content:space-between;
}
.media-qr-card-type-label { color:#AEAEB2; }
.media-qr-type-icon { width:4mm; height:4mm; color:#AEAEB2; }
.media-qr-visual-fallback {
  width:100%;
  height:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:4mm;
  background:#F2F2F7;
}
.media-qr-fallback-ring {
  width:22mm;
  height:22mm;
  border-radius:50%;
  border:1.2pt solid rgba(92,143,166,.45);
  display:flex;
  align-items:center;
  justify-content:center;
  background:#FFFFFF;
}
.media-qr-fallback-play {
  font-size:11pt;
  margin-left:1pt;
}
.media-qr-fallback-wave {
  width:72%;
  max-width:118mm;
}
.media-qr-fallback-wave .audio-wave-svg {
  width:100%;
  height:auto;
  display:block;
}

.back-inner {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
  padding:0 30mm;
}
body.print-bleed .back-inner {
  padding-left:calc(30mm + var(--bleed));
  padding-right:calc(30mm + var(--bleed));
}
body.print-bleed .folio {
  bottom:calc(8mm + var(--bleed));
}
${gelatoPageCss}

</style>
</head>
<body${bodyClass}>${pagesHtml}</body>
</html>`;
}

export function buildBookHtml(input: BuildBookHtmlInput): string {
  const isPrint = input.exportMode === 'print';
  const pageWmm = isPrint ? PRINT_PAGE_WIDTH_MM : DIGITAL_PAGE_WIDTH_MM;
  const pageHmm = isPrint ? PRINT_PAGE_HEIGHT_MM : DIGITAL_PAGE_HEIGHT_MM;

  const pagesHtml = input.pages.map((p, i) => renderPage(p, input, i + 1, pageWmm)).join('');

  return buildHtmlDocument(input.coverTitle, pagesHtml, pageWmm, pageHmm, isPrint);
}

/** HTML une seule page : spread couverture rigide (dimensions Gelato exactes). */
export function buildGelatoSpreadHtml(
  input: BuildBookHtmlInput,
  layout: GelatoCoverLayout,
): string {
  const spreadHtml = pageGelatoWraparoundSpread(
    layout,
    { ...input, exportMode: 'print' },
    input.child,
    input.coverPhotoUrl,
    input.coverPhotoImgPxW,
    input.coverPhotoImgPxH,
  );
  return buildHtmlDocument(
    input.coverTitle,
    spreadHtml,
    layout.spreadWidthMm,
    layout.spreadHeightMm,
    false,
    { widthMm: layout.spreadWidthMm, heightMm: layout.spreadHeightMm },
  );
}

/** HTML bloc intérieur Gelato : garde blanche + contenu (+ pad si impair) + garde blanche.
 * Template officiel : 30 intérieures → PDF 33 pages ; pages 2 et dernière toujours vides.
 * Le texte « Chaque moment compte. » est sur le panneau arrière du spread wraparound.
 * @see https://support.gelato.com/en/articles/8996282-how-do-i-design-a-photo-book
 */
export function buildGelatoBlockHtml(input: BuildBookHtmlInput): string {
  const printInput: BuildBookHtmlInput = { ...input, exportMode: 'print' };
  const pageWmm = PRINT_PAGE_WIDTH_MM;
  const pageHmm = PRINT_PAGE_HEIGHT_MM;
  const innerPages = gelatoInnerPages(input.pages);
  const innerHtml = innerPages
    .map((p, i) => renderPage(p, printInput, i + 1, pageWmm))
    .join('');
  // Gelato exige un pageCount catalogue pair : une page blanche si N impair.
  const padOdd = innerPages.length % 2 === 1 ? pageGelatoBlankEndpaper() : '';
  const pagesHtml = `${pageGelatoBlankEndpaper()}${innerHtml}${padOdd}${pageGelatoBlankEndpaper()}`;
  return buildHtmlDocument(input.coverTitle, pagesHtml, pageWmm, pageHmm, true);
}

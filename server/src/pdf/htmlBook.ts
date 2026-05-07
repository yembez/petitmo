import {
  DIGITAL_PAGE_HEIGHT_MM,
  DIGITAL_PAGE_WIDTH_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
  PRINT_BLEED_MM,
} from '../constants/pdfDigitalSpec';
import type { BookPageServer } from '../types/contracts';
import { splitVideoTitleBody } from './bookTextParts';
import type { ChildRow, MemoryRow } from './memoryRow';
import { clampAudioBookAnnotation } from './audioBookAnnotation';
import {
  audioWaveformSvg,
  bookPdfLocationLabel,
  dateFrCaps,
  normalizeQuoteBodyLikeMaquette,
  quoteFitLevelFromBody,
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

function cropCss(crop?: PhotoCrop): string {
  const x = crop?.xPct ?? 0;
  const y = crop?.yPct ?? 0;
  const s = Math.max(1, crop?.scale ?? 1);
  return `transform: translate(${x}%, ${y}%) scale(${s}); transform-origin:center center;`;
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

function clampChars(s: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trimEnd();
}

function clampWithEllipsis(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  if (maxChars <= 1) return '…';
  return `${t.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function monthCaps(label: string): string {
  return label.replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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

function pageCover(
  child: ChildRow,
  coverPhotoUrl: string | null | undefined,
  title: string,
  yearLabel: string,
  crop: PhotoCrop | undefined,
  printBleed: boolean
): string {
  const explicit = (coverPhotoUrl ?? '').trim();
  const src = explicit ? imgAttr(explicit) : imgAttr(child.photo_url);
  const bleedCls = printBleed ? ' bleed-x' : '';
  return `<div class="page cover">
  <div class="cover-photo${bleedCls}">
    ${
      src
        ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" alt="" style="${cropCss(crop)}" /></div>`
        : '<div class="cover-placeholder"></div>'
    }
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

function pagePhotoFull(m: MemoryRow, rot: number, pageNum: number, crop: PhotoCrop | undefined, printBleed: boolean): string {
  const src = imgAttr(photoMainUrl(m));
  const captionRaw = sanitizeText((m.content ?? '').trim());
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const captionHtml = captionRaw ? romanHtml(captionRaw) : '';
  const imgCls = printBleed ? 'pf-image bleed-x' : 'pf-image';
  const locLabel = bookPdfLocationLabel(m.location);
  return `<div class="page photo-full-stack">
  <div class="${imgCls}">
    ${
      src
        ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
        : '<div class="placeholder" style="width:100%;height:100%;"></div>'
    }
  </div>
  <div class="pf-footer">
    <div class="pf-meta-row">
      <div class="pf-meta">${esc(dateFrCaps(m.created_at))}</div>
      ${locLabel ? `<div class="pf-meta pf-meta-loc">${esc(locLabel)}</div>` : ''}
    </div>
    ${captionHtml ? `<div class="pf-caption body">${captionHtml}</div>` : ''}
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pagePhotoNote(m: MemoryRow, rot: number, pageNum: number, crop: PhotoCrop | undefined, printBleed: boolean): string {
  const src = imgAttr(photoMainUrl(m));
  const legend = clampWithEllipsis(sanitizeText((m.content ?? '').trim()), 420);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const pnCls = printBleed ? 'pn-image bleed-x' : 'pn-image';
  const locLabel = bookPdfLocationLabel(m.location);
  return `<div class="page photo-note">
  <div class="${pnCls}">
    ${src
      ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
      : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="pn-text">
    <div class="pn-meta-row">
      <div class="label">${esc(dateFrCaps(m.created_at))}</div>
      ${locLabel ? `<div class="label pn-meta-loc">${esc(locLabel)}</div>` : ''}
    </div>
    ${legend ? `<div class="body">${romanHtml(legend)}</div>` : ''}
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageQuote(m: MemoryRow, pageNum: number): string {
  const raw = clampChars(sanitizeText((m.content ?? '').trim()), 600);
  const body = normalizeQuoteBodyLikeMaquette(raw);
  const fitLevel = quoteFitLevelFromBody(body);
  const locLabel = bookPdfLocationLabel(m.location);
  return `<div class="page quote">
  <div class="inner quote-inner quote-fit-${fitLevel}">
    <div class="quote-header">
      <span class="dot sage"></span>
      <span class="label" style="color:#6B8F7E;text-transform:none;">Petits mots</span>
    </div>
    <div class="quote-mid">
      <div class="quote-mark">\u201C</div>
      <div class="body quote-body">${romanHtml(body)}</div>
    </div>
    <div class="quote-footer-block">
      <div class="quote-rule">
        <div class="quote-rule-seg"></div>
        <div class="quote-rule-dot"></div>
        <div class="quote-rule-seg"></div>
      </div>
      <div class="quote-meta-row">
        <div class="label">${esc(dateFrCaps(m.created_at))}</div>
        ${locLabel ? `<div class="label quote-meta-loc">${esc(locLabel)}</div>` : ''}
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
  printBleed: boolean
): string {
  const titleRaw = clampAudioBookAnnotation(sanitizeText((m.content ?? '').trim()));
  const dur = fmtDuration(m.duration);
  const titleHtml = titleRaw ? romanHtml(titleRaw) : '';
  const coverUrl = imgAttr(m.voice_cover_url);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const pnCls = printBleed ? 'pn-image bleed-x' : 'pn-image';
  const locLabel = bookPdfLocationLabel(m.location);
  return `<div class="page audio audio-note-layout">
  <div class="${pnCls}">
    ${
      coverUrl
        ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${coverUrl}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
        : '<div class="placeholder" style="width:100%;height:100%;"></div>'
    }
  </div>
  <div class="pn-text audio-below-photo">
    <div class="audio-meta-row">
      <div class="audio-type-pill">
        <span class="dot vocal"></span>
        <span class="label audio-type-label">Vocal</span>
      </div>
      <div class="audio-meta-right">
        <span class="label audio-meta-date">${esc(dateFrCaps(m.created_at))}</span>
        ${locLabel ? `<span class="label audio-meta-loc">${esc(locLabel)}</span>` : ''}
      </div>
    </div>
    ${titleHtml ? `<div class="audio-title-above-qr body">${titleHtml}</div>` : ''}
    <div class="audio-qr-block">
      ${qrImgTag(qrUrl)}
      <div class="label audio-qr-hint">Scanner pour écouter</div>
    </div>
    <div class="audio-player-row">
      <div class="audio-ring audio-ring-inline">
        <div class="audio-play">▶</div>
      </div>
      <div class="audio-wave-col">
        <div class="audio-wave-wrap audio-wave-inline">${audioWaveformSvg(m.id)}</div>
        <div class="audio-dur-row audio-dur-inline">
          <span class="label audio-dur-side">0:00</span>
          <span class="label audio-dur-side">${esc(dur)}</span>
        </div>
      </div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageVideo(m: MemoryRow, qrUrl: string, pageNum: number, printBleed: boolean): string {
  const raw = sanitizeText((m.content ?? '').trim());
  const { title: videoTitleRaw, body: videoBodyRaw } = splitVideoTitleBody(raw);
  const vTitle = (videoTitleRaw || 'Vidéo').trim();
  const sub = videoBodyRaw.trim() ? videoBodyRaw : 'Regarde ce moment en vidéo.';
  const thumbUrl = imgAttrFirst([m.thumbnail_url, m.poster_url]);
  const vtCls = printBleed ? 'video-thumb bleed-x' : 'video-thumb';
  const locLabel = bookPdfLocationLabel(m.location);
  return `<div class="page video">
  <div class="${vtCls}">
    ${thumbUrl ? `<img src="${thumbUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />` : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="inner video-text-block">
    <div class="video-meta-row">
      <div class="label">${esc(dateFrCaps(m.created_at))}</div>
      ${locLabel ? `<div class="label video-meta-loc">${esc(locLabel)}</div>` : ''}
    </div>
    <div class="video-title-line">${esc(vTitle)}</div>
    <div class="video-sub-line">${romanHtml(sub)}</div>
    <div class="audio-qr video-qr-bottom">
      ${qrImgTag(qrUrl)}
      <div class="label" style="margin-top:3mm;">Scanner pour regarder</div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
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

function renderPage(page: BookPageServer, input: BuildBookHtmlInput, pageNum: number, _pageWmm: number): string {
  const { child, coverTitle, coverYearLabel, chapterTitle, qrBaseUrl, coverPhotoUrl, memoriesById, qrTokensByMemoryId } =
    input;
  const printBleed = input.exportMode === 'print';
  switch (page.type) {
    case 'cover':
      return pageCover(child, coverPhotoUrl, coverTitle, coverYearLabel, page.crop, printBleed);
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
      switch (page.type) {
        case 'photo-full':
          return pagePhotoFull(m, rot, pageNum, crop, printBleed);
        case 'photo-note':
          return pagePhotoNote(m, rot, pageNum, crop, printBleed);
        case 'quote':
          return pageQuote(m, pageNum);
        case 'audio': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/${tok}` : '';
          return pageAudio(m, qrTarget, pageNum, rot, crop, printBleed);
        }
        case 'video': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/${tok}` : '';
          return pageVideo(m, qrTarget, pageNum, printBleed);
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
  isPrint: boolean
): string {
  const bleedMm = isPrint ? PRINT_BLEED_MM : 0;
  const pnImgHmm = (pageHmm * 0.6).toFixed(2);
  const coverPhotoHmm = (pageHmm * 0.68).toFixed(2);
  const pfImgHmm = (pageHmm * 0.82).toFixed(2);
  const videoThumbHmm = (pageHmm * 0.42).toFixed(2);
  const bodyClass = isPrint ? ' class="print-bleed"' : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&amp;family=EB+Garamond:ital,wght@0,400;1,400&amp;display=swap" rel="stylesheet" />
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
  --video-thumb-h:${videoThumbHmm}mm;
  --pad-x:15mm;
  --pad-x-safe:calc(15mm + var(--bleed));
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
.crop-frame { position:relative; overflow:hidden; }
.crop-img {
  position:absolute;
  inset:-1px;
  width:calc(100% + 2px);
  height:calc(100% + 2px);
  object-fit:cover;
}
.cover-placeholder { width:100%; height:100%; background:#E8E8ED; }
.cover-text {
  flex:1; display:flex; flex-direction:column; justify-content:center;
  padding:4mm var(--pad-x) 10mm;
}
body.print-bleed .cover-text {
  padding-left:var(--pad-x-safe);
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
  width:var(--page-w); height:var(--pf-img-h); flex-shrink:0; overflow:hidden;
  background:#F2F2F7;
}
.pf-footer {
  flex:1; min-height:0; overflow:hidden;
  padding:3.7mm var(--pad-x) 10mm;
  display:flex; flex-direction:column;
}
body.print-bleed .pf-footer {
  padding-left:var(--pad-x-safe);
  padding-right:var(--pad-x-safe);
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
  color:#3A3A3C; letter-spacing:.15pt; text-transform:none; text-align:right;
  flex:1; min-width:0;
}
.pf-caption { margin-top:2.1mm; font-size:12.75pt; line-height:1.45; }
.placeholder { background:#F2F2F7; }

.photo-note { flex-direction:column; }
.pn-image { width:var(--page-w); height:var(--pn-img-h); flex-shrink:0; overflow:hidden; }
.pn-text {
  flex:1; min-height:0; overflow:hidden;
  padding:4mm var(--pad-x) 14mm;
}
body.print-bleed .pn-text {
  padding-left:var(--pad-x-safe);
  padding-right:var(--pad-x-safe);
}
.pn-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:3mm; flex-shrink:0; margin-bottom:2mm;
}
.pn-meta-loc {
  font-weight:600; color:#3A3A3C; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}

body.print-bleed .bleed-x {
  margin-left:calc(-1 * var(--bleed));
  width:calc(var(--page-w) + 2 * var(--bleed));
  max-width:none;
  box-sizing:border-box;
}

.quote .inner { padding-top:14mm; padding-bottom:14mm; }
.quote-inner {
  justify-content:flex-start;
  display:flex;
  flex-direction:column;
  flex:1;
  min-height:0;
}
.quote-fit-1 { padding-top:12mm; padding-bottom:12mm; }
.quote-fit-2 { padding-top:11mm; padding-bottom:11mm; }
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
  font-weight:600; color:#3A3A3C; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}
.quote-mark {
  font-family:'EB Garamond',serif; font-style:italic;
  font-size:42pt; color:rgba(0,0,0,.06); line-height:1; margin-bottom:1.5mm; margin-left:5mm;
}
.quote-body { overflow:hidden; text-align:left; }
.quote-fit-1 .quote-body { font-size:10.4pt; line-height:1.48; }
.quote-fit-1 .quote-body p { margin:0 0 4pt; }
.quote-fit-2 .quote-body { font-size:9.8pt; line-height:1.42; }
.quote-fit-2 .quote-body p { margin:0 0 3pt; }
.quote-fit-1 .quote-mark { font-size:37pt; line-height:1; }
.quote-fit-2 .quote-mark { font-size:33pt; margin-bottom:1mm; line-height:1; }
.quote-rule { display:flex; align-items:center; gap:4pt; margin-top:6mm; }
.quote-rule-seg { flex:1; height:.3pt; background:rgba(0,0,0,.08); }
.quote-rule-dot { width:4pt; height:4pt; border-radius:50%; background:rgba(0,0,0,.08); }

/* Audio : même squelette que photo-note (image bords + bandeau bas). */
.audio-note-layout { flex-direction:column; }
.audio-below-photo {
  display:flex;
  flex-direction:column;
  flex:1;
  min-height:0;
}
.audio-meta-row {
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-shrink:0;
  gap:4mm;
  padding-bottom:3mm;
  border-bottom:.3pt solid rgba(0,0,0,.08);
}
.audio-meta-right {
  display:flex; flex-direction:column; align-items:flex-end; gap:1mm;
  flex-shrink:0; margin-left:auto; text-align:right;
}
.audio-meta-date { flex-shrink:0; }
.audio-meta-loc {
  font-weight:600; color:#3A3A3C; letter-spacing:.15pt; text-transform:none;
}
.audio-type-pill {
  display:flex;
  align-items:center;
  gap:4pt;
}
.audio-type-label {
  color:#5C8FA6;
  text-transform:none;
  letter-spacing:0;
}
.audio-title-above-qr {
  margin-top:2mm;
  flex-shrink:0;
}
.audio-qr-block {
  display:flex;
  flex-direction:column;
  align-items:center;
  flex-shrink:0;
  margin-top:2mm;
  margin-bottom:2mm;
}
.page.audio .audio-qr-block .qr {
  width:17mm;
  height:17mm;
}
.audio-qr-hint {
  margin-top:2.5mm;
  text-align:center;
}
.audio-player-row {
  display:flex;
  flex-direction:row;
  align-items:center;
  gap:4mm;
  flex-shrink:0;
  margin-top:auto;
  padding-top:1mm;
}
.audio-ring {
  width:19mm;
  height:19mm;
  border-radius:50%;
  border:1.2pt solid rgba(92,143,166,.45);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}
.audio-ring-inline { margin-bottom:0; }
.audio-play { font-size:11pt; color:#5C8FA6; margin-left:1.5pt; }
.audio-wave-col {
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
}
.audio-wave-wrap {
  width:100%;
  max-width:none;
  margin:0;
}
.audio-wave-wrap .audio-wave-svg { width:100%; height:auto; display:block; }
.audio-dur-row {
  display:flex;
  flex-direction:row;
  justify-content:space-between;
  width:100%;
  margin-top:1.5mm;
}
.audio-dur-inline { max-width:none; }
.audio-dur-side { font-size:7pt; text-transform:none; letter-spacing:0; }
.audio-qr { display:flex; flex-direction:column; align-items:center; flex-shrink:0; position:relative; z-index:1; margin-top:auto; padding-bottom:3mm; }
.qr { width:22mm; height:22mm; }

.video { flex-direction:column; }
.video-thumb { width:var(--page-w); height:var(--video-thumb-h); flex-shrink:0; overflow:hidden; }
.video-text-block {
  flex:1; min-height:0; display:flex; flex-direction:column;
  padding:5.3mm var(--pad-x) 0;
  overflow:hidden;
}
body.print-bleed .video-text-block {
  padding-left:var(--pad-x-safe);
  padding-right:var(--pad-x-safe);
}
.video-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:3mm; flex-shrink:0;
}
.video-meta-loc {
  font-weight:600; color:#3A3A3C; letter-spacing:.15pt; text-transform:none;
  text-align:right; flex:1; min-width:0;
}
.video-title-line {
  margin-top:2.6mm;
  font-family:'EB Garamond',serif; font-style:italic; font-size:13.5pt; font-weight:400;
  color:#1C1C1E;
}
.video-sub-line {
  margin-top:2.6mm;
  font-family:'EB Garamond',serif; font-style:italic;
  font-size:10.5pt; line-height:1.5;
  color:#6B7280; text-align:justify;
}
.video-sub-line p { margin:0 0 4pt; }
.video-qr-bottom { margin-top:auto; padding-bottom:3mm; align-items:center; }

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

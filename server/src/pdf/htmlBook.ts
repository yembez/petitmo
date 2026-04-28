import { DIGITAL_PAGE_HEIGHT_MM, DIGITAL_PAGE_WIDTH_MM } from '../constants/pdfDigitalSpec';
import type { BookPageServer } from '../types/contracts';
import { splitVideoTitleBody } from './bookTextParts';
import type { ChildRow, MemoryRow } from './memoryRow';

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
  /** memoryId → token ; QR = `${qrBaseUrl}/q/${token}`. */
  qrTokensByMemoryId: Map<string, string>;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgAttr(url: string | null | undefined): string {
  const t = (url ?? '').trim();
  if (!t) return '';
  return esc(t);
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

function normalizeTextOnlyForPdf(
  raw: string,
  opts?: { maxChars?: number }
): { text: string; fitLevel: 0 | 1 | 2 } {
  const maxChars = opts?.maxChars ?? 600;
  const clean = sanitizeText(raw).trim();
  if (!clean) return { text: '', fitLevel: 0 };

  const clamped = clampChars(clean, maxChars);
  const normalized = clamped
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]+\n\n/g, '\n\n')
    .replace(/\n\n[ \t]+/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const paragraphCount = normalized.split(/\n{2,}/).filter(p => p.trim()).length;
  const approxLines = Math.ceil(normalized.length / 42) + paragraphCount * 2;

  let fitLevel: 0 | 1 | 2 = 0;
  if (approxLines >= 18 || normalized.length >= 420 || paragraphCount >= 3) fitLevel = 1;
  if (approxLines >= 22 || normalized.length >= 520 || paragraphCount >= 5) fitLevel = 2;

  return { text: normalized, fitLevel };
}

function quoteHtml(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  const hasDouble = /\n{2,}/.test(clean);
  const paras = hasDouble ? clean.split(/\n{2,}/) : clean.split(/\n/);
  return paras
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map(p => `<p>${esc(EM + p.replace(/\s+/g, ' ').trim())}</p>`)
    .join('\n');
}

function dateFr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateTimeFr(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time.replace(':', 'h')}`.toUpperCase();
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
  crop?: PhotoCrop
): string {
  const explicit = (coverPhotoUrl ?? '').trim();
  const src = explicit ? imgAttr(explicit) : imgAttr(child.photo_url);
  return `<div class="page cover">
  <div class="cover-photo">
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
    <div class="cover-footer">Créé avec <span class="cover-logo">petitmo</span></div>
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
  const caption = sanitizeText((m.content ?? '').trim());
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  const bleedClass = printBleed ? 'full-bleed crop-frame print-bleed' : 'full-bleed crop-frame';
  return `<div class="page photo-full">
  ${src
    ? `<div class="${bleedClass}"><img class="crop-img" src="${src}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
    : `<div class="full-bleed placeholder${printBleed ? ' print-bleed' : ''}"></div>`}
  <div class="photo-full-overlay">
    <div class="label">${esc(dateFr(m.created_at))}</div>
    ${caption ? `<div class="body" style="margin-top:2pt;">${esc(caption)}</div>` : ''}
  </div>
  <div class="folio folio-white">${pageNum}</div>
</div>`;
}

function pagePhotoNote(m: MemoryRow, rot: number, pageNum: number, crop?: PhotoCrop): string {
  const src = imgAttr(photoMainUrl(m));
  const legend = clampWithEllipsis(sanitizeText((m.content ?? '').trim()), 420);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  return `<div class="page photo-note">
  <div class="pn-image">
    ${src
      ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
      : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="pn-text">
    <div class="label">${esc(dateTimeFr(m.created_at))}</div>
    ${legend ? `<div class="body">${romanHtml(legend)}</div>` : ''}
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageQuote(m: MemoryRow, pageNum: number): string {
  const { text: raw, fitLevel } = normalizeTextOnlyForPdf((m.content ?? '').trim(), { maxChars: 600 });
  const time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = dateFr(m.created_at) + ' · ' + time;
  return `<div class="page quote">
  <div class="inner quote-inner quote-fit-${fitLevel}">
    <div class="quote-header">
      <span class="dot sage"></span>
      <span class="label" style="color:#6B8F7E;text-transform:none;">Petits mots</span>
    </div>
    <div class="quote-mark">\u201C</div>
    <div class="body quote-body">${quoteHtml(raw)}</div>
    <div class="quote-rule">
      <div class="quote-rule-seg"></div>
      <div class="quote-rule-dot"></div>
      <div class="quote-rule-seg"></div>
    </div>
    <div class="label" style="text-align:right;margin-top:6pt;">${esc(dateLabel)}</div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageAudio(m: MemoryRow, qrUrl: string, pageNum: number): string {
  const title = sanitizeText((m.content ?? '').trim()) || 'Note vocale';
  const dur = fmtDuration(m.duration);
  return `<div class="page audio">
  <div class="inner">
    <div class="audio-header">
      <div style="display:flex;align-items:center;gap:4pt;">
        <span class="dot vocal"></span>
        <span class="label" style="color:#5C8FA6;text-transform:none;">Vocal</span>
      </div>
      <span class="label">${esc(dateFr(m.created_at))}</span>
    </div>
    <div class="audio-body">
      <div class="audio-ring">
        <div class="audio-play">▶</div>
      </div>
      <div class="subtitle" style="margin-top:6mm;max-width:80%;text-align:center;">${esc(title)}</div>
      <div class="label" style="margin-top:3pt;">${esc(dur)}</div>
    </div>
    <div class="audio-qr">
      ${qrImgTag(qrUrl)}
      <div class="label" style="margin-top:3mm;">Scanner pour écouter</div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

function pageVideo(m: MemoryRow, qrUrl: string, pageNum: number): string {
  const raw = sanitizeText((m.content ?? '').trim());
  const { title: tRaw, body: sub } = splitVideoTitleBody(raw);
  const legend = sanitizeText((sub || tRaw || '').trim());
  const thumbUrl = imgAttrFirst([m.thumbnail_url, m.poster_url]);
  return `<div class="page video">
  <div class="video-thumb">
    ${thumbUrl ? `<img src="${thumbUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />` : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="inner" style="flex:1;padding-top:5mm;">
    <div class="label">${esc(dateTimeFr(m.created_at))}</div>
    ${legend ? `<div class="body" style="margin-top:4pt;">${romanHtml(legend)}</div>` : ''}
    <div class="audio-qr" style="margin-top:auto;padding-bottom:4mm;">
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

function renderPage(page: BookPageServer, input: BuildBookHtmlInput, pageNum: number): string {
  const { child, coverTitle, coverYearLabel, chapterTitle, qrBaseUrl, coverPhotoUrl, memoriesById, qrTokensByMemoryId } =
    input;
  const printBleed = input.exportMode === 'print';
  switch (page.type) {
    case 'cover':
      return pageCover(child, coverPhotoUrl, coverTitle, coverYearLabel, page.crop);
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
          return pagePhotoNote(m, rot, pageNum, crop);
        case 'quote':
          return pageQuote(m, pageNum);
        case 'audio': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/q/${tok}` : '';
          return pageAudio(m, qrTarget, pageNum);
        }
        case 'video': {
          const tok = qrTokensByMemoryId.get(id) ?? '';
          const qrTarget = tok ? `${qrBaseUrl}/q/${tok}` : '';
          return pageVideo(m, qrTarget, pageNum);
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

function buildHtmlDocument(title: string, pagesHtml: string, pageWmm: number, pageHmm: number): string {
  const pnImgHmm = (pageHmm * 0.6).toFixed(2);
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
  --pn-img-h:${pnImgHmm}mm;
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
  padding:18mm 15mm;
  width:100%; flex:1;
  min-height:0;
  overflow:hidden;
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
.cover-photo { width:var(--page-w); height:142mm; overflow:hidden; flex-shrink:0; }
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
  padding:4mm 15mm 10mm;
}
.cover-title {
  font-family:'EB Garamond',serif; font-style:italic; font-size:22pt; color:#1C1C1E;
}
.cover-period { font-family:'DM Sans',sans-serif; font-size:11pt; color:#AEAEB2; margin-top:5pt; }
.cover-hairline { height:.3pt; background:rgba(0,0,0,.08); margin-top:10pt; width:100%; }
.cover-footer {
  font-family:'DM Sans',sans-serif; font-size:9pt; color:#AEAEB2; margin-top:8pt;
  text-align:right;
}
.cover-logo {
  font-family:'EB Garamond',serif; font-style:italic; font-size:10pt; color:#1C1C1E;
}

.chapter-inner {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
}
.chapter-month { font-family:'DM Sans',sans-serif; font-size:9pt; color:#AEAEB2; letter-spacing:.6pt; }
.chapter-title {
  font-family:'EB Garamond',serif; font-style:italic; font-size:22pt; color:#1C1C1E; margin-top:8pt;
}
.chapter-rule { width:20mm; height:.3pt; background:rgba(0,0,0,.08); margin-top:14pt; }
.chapter-sub { font-family:'DM Sans',sans-serif; font-size:9pt; color:#AEAEB2; margin-top:10pt; }

.page.photo-full {
  display:block;
  position:relative;
  width:var(--page-w);
  height:var(--page-h);
  overflow:hidden;
  font-size:12pt;
  line-height:normal;
}
.full-bleed {
  position:absolute; top:0; left:0; width:var(--page-w); height:var(--page-h);
}
.page.photo-full .full-bleed.print-bleed,
.page.photo-full .full-bleed.placeholder.print-bleed {
  top:-3mm;
  left:-3mm;
  width:calc(var(--page-w) + 6mm);
  height:calc(var(--page-h) + 6mm);
}
.placeholder { background:#F2F2F7; }
.photo-full-overlay {
  position:absolute; bottom:0; left:0; right:0;
  background:linear-gradient(transparent,rgba(255,255,255,.95) 40%);
  padding:5mm 15mm 14mm;
}

.photo-note { flex-direction:column; }
.pn-image { width:var(--page-w); height:var(--pn-img-h); flex-shrink:0; overflow:hidden; }
.pn-text {
  flex:1; min-height:0; overflow:hidden;
  padding:4mm 15mm 14mm;
}

.quote .inner { padding-top:14mm; padding-bottom:14mm; }
.quote-inner { justify-content:flex-start; }
.quote-fit-1 { padding-top:12mm; padding-bottom:12mm; }
.quote-fit-2 { padding-top:11mm; padding-bottom:11mm; }
.quote-header {
  display:flex; align-items:center; gap:4pt; margin-bottom:4mm;
}
.quote-mark {
  font-family:'EB Garamond',serif; font-style:italic;
  font-size:38pt; color:rgba(0,0,0,.06); line-height:1; margin-bottom:1.5mm;
}
.quote-body { overflow:hidden; padding:0 3mm; text-align:left; }
.quote-fit-1 .quote-body { font-size:10.4pt; line-height:1.48; }
.quote-fit-1 .quote-body p { margin:0 0 4pt; }
.quote-fit-2 .quote-body { font-size:9.8pt; line-height:1.42; }
.quote-fit-2 .quote-body p { margin:0 0 3pt; }
.quote-fit-2 .quote-mark { font-size:34pt; margin-bottom:1mm; }
.quote-rule { display:flex; align-items:center; gap:4pt; margin-top:6mm; }
.quote-rule-seg { flex:1; height:.3pt; background:rgba(0,0,0,.08); }
.quote-rule-dot { width:4pt; height:4pt; border-radius:50%; background:rgba(0,0,0,.08); }

.audio-header {
  display:flex; justify-content:space-between; align-items:center;
  padding-bottom:4mm; border-bottom:.3pt solid rgba(0,0,0,.08);
}
.audio-body {
  flex:1; min-height:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center;
}
.audio-ring {
  width:30mm; height:30mm; border-radius:50%;
  border:1.2pt solid rgba(92,143,166,.45);
  display:flex; align-items:center; justify-content:center;
}
.audio-play { font-size:14pt; color:#5C8FA6; margin-left:2pt; }
.audio-qr { display:flex; flex-direction:column; align-items:center; flex-shrink:0; }
.qr { width:22mm; height:22mm; }

.video { flex-direction:column; }
.video-thumb { width:var(--page-w); height:88mm; flex-shrink:0; overflow:hidden; }

.back-inner {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
  padding:0 30mm;
}

</style>
</head>
<body>${pagesHtml}</body>
</html>`;
}

export function buildBookHtml(input: BuildBookHtmlInput): string {
  const mode = input.exportMode;
  const pageWmm = mode === 'print' ? 154 : DIGITAL_PAGE_WIDTH_MM;
  const pageHmm = mode === 'print' ? 216 : DIGITAL_PAGE_HEIGHT_MM;

  const pagesHtml = input.pages.map((p, i) => renderPage(p, input, i + 1)).join('');

  return buildHtmlDocument(input.coverTitle, pagesHtml, pageWmm, pageHmm);
}

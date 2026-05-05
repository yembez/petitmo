import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { cacheDirectory, downloadAsync, getInfoAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import type { BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';
import { splitVideoTitleBody } from '@/src/book/bookTextParts';
import {
  FONT_EB_GARAMOND_ITALIC_B64,
  FONT_DM_SANS_400_B64,
  FONT_DM_SANS_500_B64,
} from '@/services/bookFontsB64';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import { audioWaveformHtmlBars } from '@/lib/pdfAudioWaveform';

// ── PUBLIC API ────────────────────────────────────────────────

export type BookPdfInput = {
  pages: BookPage[];
  child: Child;
  /** Photo de couverture choisie (source, pas un thumb). Si absent: fallback child.photo_url. */
  coverPhotoUrl?: string | null;
  /** Token auth optionnel pour télécharger des URLs Supabase non publiques. */
  authToken?: string | null;
  coverTitle: string;
  coverYearLabel: string;
  chapterTitle: string;
  rotations: Record<string, number>;
  /** Recadrage photo (pan + zoom) : clé spéciale 'cover', sinon memoryId. */
  photoCrops?: Record<string, { xPct: number; yPct: number; scale: number }>;
  textEdits: Record<string, Partial<Memory>>;
  qrBaseUrl: string;
  /**
   * `screen`: A5 exact (148×210mm) pour aperçu/partage.
   * `print`: A5 + fond perdu 3mm (154×216mm) pour impression.
   */
  exportMode?: 'screen' | 'print';
  onProgress?: (current: number, total: number) => void;
};

function mmToPt(mm: number): number {
  return Math.round((mm / 25.4) * 72);
}

export async function generateBookPdf(input: BookPdfInput): Promise<string> {
  if (input.pages.length === 0) throw new Error('Aucune page à exporter.');

  const mode = input.exportMode ?? 'screen';
  const pageWmm = mode === 'print' ? 154 : 148;
  const pageHmm = mode === 'print' ? 216 : 210;

  // Phase 1: download all images as base64 data URIs
  const allUrls = collectImageUrls(
    input.pages,
    input.child,
    input.coverPhotoUrl ?? null,
    input.textEdits,
    input.qrBaseUrl
  );
  const images = await preloadAllImages(allUrls, input.authToken ?? null, input.onProgress);

  // Phase 2: build the full HTML document
  const pagesHtml = input.pages
    .map((page, i) => renderPage(page, input, i + 1, i, images))
    .join('');

  const html = buildHtmlDocument(input.coverTitle, pagesHtml, { pageWmm, pageHmm });

  // Taille du PDF (en points) : dépend du mode export.
  const { uri } = await Print.printToFileAsync({
    html,
    width: mmToPt(pageWmm),
    height: mmToPt(pageHmm),
  });
  return uri;
}

export async function shareBookPdf(pdfUri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage n'est pas disponible sur cet appareil.");
  }
  await Sharing.shareAsync(pdfUri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}

// ── IMAGE PRE-LOADING ─────────────────────────────────────────

const _cache = new Map<string, string>();

function hashUrl(u: string): string {
  let h = 5381;
  for (let i = 0; i < u.length; i++) {
    h = (h << 5) + h + u.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

function guessMime(url: string): string {
  const u = url.split('?')[0].toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function fetchAsDataUri(url: string, authToken: string | null): Promise<string> {
  if (_cache.has(url)) return _cache.get(url)!;
  try {
    // Local file:// (offline-first) : embed direct depuis le disque.
    if (Platform.OS !== 'web' && /^file:\/\//i.test(url)) {
      const b64 = await readAsStringAsync(url, { encoding: EncodingType.Base64 });
      const dataUri = `data:${guessMime(url)};base64,${b64}`;
      _cache.set(url, dataUri);
      return dataUri;
    }

    // Cache disque (iOS/Android): évite de re-télécharger à chaque export PDF
    if (Platform.OS !== 'web' && /^https?:\/\//i.test(url) && cacheDirectory) {
      const local = `${cacheDirectory}petitmo-pdf-${hashUrl(url)}.bin`;
      try {
        const info = await getInfoAsync(local);
        if (!info.exists) {
          const dl = await downloadAsync(url, local);
          if (dl.status !== 200) throw new Error(`download status ${dl.status}`);
        }
        const b64 = await readAsStringAsync(local, { encoding: EncodingType.Base64 });
        const dataUri = `data:${guessMime(url)};base64,${b64}`;
        _cache.set(url, dataUri);
        return dataUri;
      } catch {
        // fallback réseau ci-dessous
      }
    }

    const needsAuth = !!authToken && /supabase/i.test(url);
    const res = await fetch(url, needsAuth ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined);
    if (!res.ok) {
      console.warn(`[bookPdf] fetch failed (${res.status}) for ${url.slice(0, 80)}…`);
      return '';
    }
    const blob = await res.blob();
    const dataUri: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('FileReader failed'));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    _cache.set(url, dataUri);
    return dataUri;
  } catch (err) {
    console.warn(`[bookPdf] image download error for ${url.slice(0, 80)}…`, err);
    return '';
  }
}

function collectImageUrls(
  pages: BookPage[],
  child: Child,
  coverPhotoUrl: string | null,
  edits: Record<string, Partial<Memory>>,
  qrBaseUrl: string,
): string[] {
  const urls = new Set<string>();
  const cover = (coverPhotoUrl ?? '').trim();
  if (cover) urls.add(cover);
  // Toujours ajouter aussi le profil enfant comme fallback (au cas où cover est indisponible).
  if (child.local_photo_path) urls.add(child.local_photo_path);
  if (child.photo_url) urls.add(child.photo_url);

  for (const page of pages) {
    let m: Memory | undefined;
    switch (page.type) {
      case 'photo-full':
      case 'photo-note':
      case 'audio':
      case 'video':
      case 'quote':
        m = merged(page.memory, edits);
        break;
      case 'cover':
        if (page.child.photo_url) urls.add(page.child.photo_url);
        continue;
      default:
        continue;
    }
    if (!m) continue;
    // IMPORTANT: éviter tout téléchargement inutile (egress), surtout les vidéos.
    // - Photo pages: on embed l'image pleine page
    // - Video pages: on embed UNIQUEMENT la miniature (sinon on risquerait de télécharger le mp4)
    // - Audio pages: cover vocale + QR (pas le fichier audio)
    // - Quote pages: pas d'image
    if (page.type === 'photo-full' || page.type === 'photo-note') {
      // Offline-first : préférer le print local, puis l’original local, puis remote.
      const mainUrl =
        m.local_print_path ??
        m.local_original_path ??
        m.local_media_path ??
        m.print_url ??
        m.display_url ??
        m.edited_media_url ??
        m.media_url;
      if (mainUrl) urls.add(mainUrl);
    } else if (page.type === 'video') {
      if (m.thumbnail_url) urls.add(m.thumbnail_url);
    } else if (page.type === 'audio') {
      const vcPath = (m.voice_cover_path ?? '').trim();
      const vcUrl = (m.voice_cover_url ?? '').trim();
      if (vcPath) urls.add(vcPath);
      if (vcUrl && vcUrl !== vcPath) urls.add(vcUrl);
    }

    if (page.type === 'audio' || page.type === 'video') {
      urls.add(qrApiUrl(`${qrBaseUrl}/${m.id}`));
    }
  }
  return [...urls];
}

async function preloadAllImages(
  urls: string[],
  authToken: string | null,
  onProgress?: (cur: number, total: number) => void,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const BATCH = 3;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(u => fetchAsDataUri(u, authToken)));
    for (let j = 0; j < batch.length; j++) {
      map.set(batch[j], results[j]);
    }
    onProgress?.(Math.min(i + BATCH, urls.length), urls.length);
  }
  return map;
}

// ── HELPERS ───────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgSrc(url: string | null | undefined, images: Map<string, string>): string {
  if (!url) return '';
  const dataUri = images.get(url) ?? '';
  return dataUri || '';
}

function imgSrcFirst(urls: Array<string | null | undefined>, images: Map<string, string>): string {
  for (const u of urls) {
    const t = (u ?? '').trim();
    if (!t) continue;
    const src = imgSrc(t, images);
    if (src) return src;
  }
  return '';
}

function merged(m: Memory, edits: Record<string, Partial<Memory>>): Memory {
  const e = edits[m.id];
  return e ? { ...m, ...e } : m;
}

type PhotoCrop = { xPct: number; yPct: number; scale: number };

function cropCss(crop?: PhotoCrop): string {
  const x = crop?.xPct ?? 0;
  const y = crop?.yPct ?? 0;
  const s = Math.max(1, crop?.scale ?? 1);
  return `transform: translate(${x}%, ${y}%) scale(${s}); transform-origin:center center;`;
}

const EM = '\u2003';

/** Strip invisible / non-printable Unicode characters (U+FFFC, zero-width joiners, etc.) */
function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
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

  // PDF: on ne garde que les *vrais* paragraphes.
  // Les sauts de ligne simples (souvent issus d'un wrapping / copier-coller) deviennent des espaces,
  // sinon on obtient des retours "aléatoires" au milieu des phrases.
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

function romanHtmlCompact(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  // Compacte uniquement la *structure* (paragraphes) sans supprimer le contenu.
  // On évite les <p> multiples (marges verticales), et on garde les sauts de ligne.
  const lines = clean
    .replace(/\n{2,}/g, '\n')
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const inner = lines.map(l => esc(EM + l)).join('<br/>\n');
  return `<p>${inner}</p>`;
}

function quoteHtml(text: string): string {
  const clean = sanitizeText(text);
  if (!clean.trim()) return '';
  // Paragraphes "roman": alinéa (cadratin) en tête.
  // - Si doubles retours: paragraphe.
  // - Sinon: on traite chaque ligne (simple \n) comme un paragraphe (pour ne pas perdre les retours).
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

function qrImgTag(dataUrl: string, images: Map<string, string>): string {
  if (!dataUrl) return '';
  const apiUrl = qrApiUrl(dataUrl);
  const src = images.get(apiUrl) || apiUrl;
  return `<img class="qr" src="${esc(src)}" />`;
}

// ── PAGE RENDERERS ────────────────────────────────────────────

function renderPage(
  page: BookPage, input: BookPdfInput, pageNum: number, pageIndex: number,
  images: Map<string, string>,
): string {
  const { child, coverPhotoUrl, coverTitle, coverYearLabel, chapterTitle, rotations, photoCrops, textEdits, qrBaseUrl } =
    input;
  switch (page.type) {
    case 'cover':
      // Injecter la cover choisie sans changer le type Child (local-only).
      return pageCover(
        {
          ...child,
          // IMPORTANT: si une cover explicite est fournie, ne jamais prendre la photo profil locale (souvent un thumb).
          local_photo_path: (coverPhotoUrl ?? '').trim() ? null : child.local_photo_path,
          photo_url: (coverPhotoUrl ?? '').trim() || child.photo_url,
        },
        coverTitle,
        coverYearLabel,
        images,
        photoCrops?.cover
      );
    case 'chapter':
      return pageChapter(page.month, page.chapterNum, chapterTitle, pageNum);
    case 'photo-full': {
      const m = merged(page.memory, textEdits);
      return pagePhotoFull(m, rotations[m.id] ?? 0, pageNum, images, photoCrops?.[m.id]);
    }
    case 'photo-note': {
      const m = merged(page.memory, textEdits);
      return pagePhotoNote(m, rotations[m.id] ?? 0, pageNum, images, photoCrops?.[m.id]);
    }
    case 'quote': {
      const m = merged(page.memory, textEdits);
      return pageQuote(m, pageNum);
    }
    case 'audio': {
      const m = merged(page.memory, textEdits);
      return pageAudio(m, `${qrBaseUrl}/${m.id}`, pageNum, images, rotations[m.id] ?? 0, photoCrops?.[m.id]);
    }
    case 'video': {
      const m = merged(page.memory, textEdits);
      return pageVideo(m, `${qrBaseUrl}/${m.id}`, pageNum, images);
    }
    case 'back-cover':
      return pageBackCover(pageNum);
    default:
      return '';
  }
}

/* ─── COVER ─── */
function pageCover(
  child: Child,
  title: string,
  yearLabel: string,
  images: Map<string, string>,
  crop?: PhotoCrop
): string {
  // NOTE: la cover photo réelle est injectée via `child.photo_url` au moment du renderPage (voir ci-dessous).
  const src = imgSrcFirst([child.photo_url, child.local_photo_path], images);
  return `<div class="page cover">
  <div class="cover-photo">
    ${
      src
        ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" style="${cropCss(crop)}" /></div>`
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

/* ─── CHAPTER ─── */
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

/* ─── PHOTO FULL (pleine page + titre en bas) ─── */
function pagePhotoFull(
  m: Memory,
  rot: number,
  pageNum: number,
  images: Map<string, string>,
  crop?: PhotoCrop
): string {
  const src = imgSrc(
    m.local_print_path ??
      m.local_original_path ??
      m.local_media_path ??
      m.print_url ??
      m.display_url ??
      m.edited_media_url ??
      m.media_url,
    images
  );
  // Dans le PDF, on n'affiche pas de "titre" par défaut : seulement une légende si elle existe.
  const caption = sanitizeText((m.content ?? '').trim());
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  return `<div class="page photo-full">
  ${src
    ? `<div class="full-bleed crop-frame"><img class="crop-img" src="${src}" style="${cropCss(crop)}${rotCss}" /></div>`
    : '<div class="full-bleed placeholder"></div>'}
  <div class="photo-full-overlay">
    <div class="label">${esc(dateFr(m.created_at))}</div>
    ${caption ? `<div class="body" style="margin-top:2pt;">${esc(caption)}</div>` : ''}
  </div>
  <div class="folio folio-white">${pageNum}</div>
</div>`;
}

/* ─── PHOTO NOTE (photo + texte long) ─── */
function pagePhotoNote(
  m: Memory,
  rot: number,
  pageNum: number,
  images: Map<string, string>,
  crop?: PhotoCrop
): string {
  const src = imgSrc(
    m.local_print_path ??
      m.local_original_path ??
      m.local_media_path ??
      m.print_url ??
      m.display_url ??
      m.edited_media_url ??
      m.media_url,
    images
  );
  // PDF: sous la photo, on n'affiche jamais un "titre" séparé. On garde uniquement la légende (texte complet).
  // Important: on évite les fallback type "Sans titre" provenant du découpage titre/corps.
  const legend = clampWithEllipsis(sanitizeText((m.content ?? '').trim()), 420);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  return `<div class="page photo-note">
  <div class="pn-image">
    ${src
      ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${src}" style="${cropCss(crop)}${rotCss}" /></div>`
      : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="pn-text">
    <div class="label">${esc(dateTimeFr(m.created_at))}</div>
    ${legend ? `<div class="body">${romanHtml(legend)}</div>` : ''}
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

/* ─── QUOTE (texte pur) ─── */
function pageQuote(m: Memory, pageNum: number): string {
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

/* ─── AUDIO ─── */
function pageAudio(
  m: Memory,
  qrUrl: string,
  pageNum: number,
  images: Map<string, string>,
  rot: number,
  crop?: PhotoCrop
): string {
  const titleRaw = clampAudioBookAnnotation(sanitizeText((m.content ?? '').trim()));
  const dur = fmtDuration(m.duration);
  const titleHtml = titleRaw ? romanHtml(titleRaw) : '';
  const coverSrc = imgSrcFirst([m.voice_cover_path, m.voice_cover_url], images);
  const rotCss = rot ? `transform: rotate(${rot}deg); transform-origin: center;` : '';
  return `<div class="page audio audio-note-layout">
  <div class="pn-image">
    ${
      coverSrc
        ? `<div class="crop-frame" style="width:100%;height:100%;"><img class="crop-img" src="${coverSrc}" alt="" style="${cropCss(crop)}${rotCss}" /></div>`
        : '<div class="placeholder" style="width:100%;height:100%;"></div>'
    }
  </div>
  <div class="pn-text audio-below-photo">
    <div class="audio-meta-row">
      <div class="audio-type-pill">
        <span class="dot vocal"></span>
        <span class="label audio-type-label">Vocal</span>
      </div>
      <span class="label">${esc(dateTimeFr(m.created_at))}</span>
    </div>
    ${titleHtml ? `<div class="audio-title-above-qr body">${titleHtml}</div>` : ''}
    <div class="audio-qr-block">
      ${qrImgTag(qrUrl, images)}
      <div class="label audio-qr-hint">Scanner pour écouter</div>
    </div>
    <div class="audio-spacer"></div>
    <div class="audio-player-row">
      <div class="audio-ring audio-ring-inline">
        <div class="audio-play">▶</div>
      </div>
      <div class="audio-wave-col">
        <div class="audio-wave-wrap audio-wave-inline">${audioWaveformHtmlBars(m.id)}</div>
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

/* ─── VIDEO ─── */
function pageVideo(m: Memory, qrUrl: string, pageNum: number, images: Map<string, string>): string {
  const raw = sanitizeText((m.content ?? '').trim());
  const { title: tRaw, body: sub } = splitVideoTitleBody(raw);
  // Annotation: une seule légende (pas de "titre" séparé).
  const legend = sanitizeText((sub || tRaw || '').trim());
  // Impression: ne jamais utiliser la vidéo elle-même; préférer un poster HD dérivé.
  const thumbUrl = m.poster_print_url ?? m.poster_url ?? m.thumbnail_url ?? '';
  const src = imgSrc(thumbUrl, images);
  return `<div class="page video">
  <div class="video-thumb">
    ${src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;" />` : '<div class="placeholder" style="width:100%;height:100%;"></div>'}
  </div>
  <div class="inner" style="flex:1;padding-top:5mm;">
    <div class="label">${esc(dateTimeFr(m.created_at))}</div>
    ${legend ? `<div class="body" style="margin-top:4pt;">${romanHtml(legend)}</div>` : ''}
    <div class="audio-qr" style="margin-top:auto;padding-bottom:4mm;">
      ${qrImgTag(qrUrl, images)}
      <div class="label" style="margin-top:3mm;">Scanner pour regarder</div>
    </div>
  </div>
  <div class="folio">${pageNum}</div>
</div>`;
}

/* ─── BACK COVER ─── */
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

// ── HTML DOCUMENT ─────────────────────────────────────────────

function buildHtmlDocument(
  title: string,
  pagesHtml: string,
  opts?: { pageWmm?: number; pageHmm?: number }
): string {
  const pageWmm = opts?.pageWmm ?? 148;
  const pageHmm = opts?.pageHmm ?? 210;
  // HTML en px 96dpi (mmToPt dans le CSS dégrade fortement WK : photos sur 2 pages, marge droite).
  const pageHpx = Math.round((pageHmm / 25.4) * 96) - 1;
  const pageWpx = Math.round((pageWmm / 25.4) * 96);
  const pnImgHpx = Math.round(pageHpx * 0.6);
  const innerPadPx = Math.round((18 / 25.4) * 96);
  const innerPadHPx = Math.round((15 / 25.4) * 96);
  const coverPhotoPx = Math.round((142 / 25.4) * 96);
  const videoThumbPx = Math.round((88 / 25.4) * 96);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
/* ── FONTS ── */
@font-face {
  font-family: 'EBG';
  font-style: italic;
  font-weight: 400;
  src: url('data:font/woff2;base64,${FONT_EB_GARAMOND_ITALIC_B64}') format('woff2');
  font-display: block;
}
@font-face {
  font-family: 'DMS';
  font-style: normal;
  font-weight: 400;
  src: url('data:font/woff2;base64,${FONT_DM_SANS_400_B64}') format('woff2');
  font-display: block;
}
@font-face {
  font-family: 'DMS';
  font-style: normal;
  font-weight: 500;
  src: url('data:font/woff2;base64,${FONT_DM_SANS_500_B64}') format('woff2');
  font-display: block;
}
</style>
<style>

/* ── RESET ── */
* { margin:0; padding:0; box-sizing:border-box;
    -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
:root {
  --page-w:${pageWpx}px;
  --page-h:${pageHpx}px;
  --pn-img-h:${pnImgHpx}px;
}
html { margin:0; padding:0; background:#fff; }
body {
  margin:0; padding:0;
  width:var(--page-w);
  display:block;
}
@page { size: ${pageWmm}mm ${pageHmm}mm; margin:0; }

img { display:block; }

/* ── PAGE FRAME ── */
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
}

/* Zéro page-break, zéro break-after, zéro margin */

.inner {
  display:flex; flex-direction:column;
  padding:${innerPadPx}px ${innerPadHPx}px;
  width:100%; flex:1;
  min-height:0;
  overflow:hidden;
}

/* ── TYPOGRAPHY ── */
.label {
  font-family:'DMS',sans-serif; font-size:7pt; font-weight:400;
  color:#AEAEB2; letter-spacing:.3pt; text-transform:uppercase;
}
.subtitle {
  font-family:'EBG',serif; font-style:italic;
  font-size:13pt; line-height:1.4; color:#1C1C1E;
}
.body {
  font-family:'EBG',serif; font-style:italic;
  font-size:11pt; line-height:1.65; color:#1C1C1E; text-align:justify;
}
.body p { margin:0 0 6pt; }
.body-tight { font-size:10.4pt; line-height:1.5; }
.body-tight p { margin:0 0 3.5pt; }
.folio {
  position:absolute; bottom:8mm; left:0; right:0;
  text-align:center; font-family:'DMS',sans-serif; font-size:7pt; color:#C7C7CC;
}
.folio-white { color:rgba(255,255,255,.5); }

/* ── DOTS ── */
.dot { display:inline-block; width:6pt; height:6pt; border-radius:50%; }
.sage { background:#6B8F7E; }
.vocal { background:#5C8FA6; }

/* ── COVER ── */
.cover { flex-direction:column; }
.cover-photo { width:var(--page-w); height:${coverPhotoPx}px; overflow:hidden; flex-shrink:0; }
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
  font-family:'EBG',serif; font-style:italic; font-size:22pt; color:#1C1C1E;
}
.cover-period { font-family:'DMS',sans-serif; font-size:11pt; color:#AEAEB2; margin-top:5pt; }
.cover-hairline { height:.3pt; background:rgba(0,0,0,.08); margin-top:10pt; width:100%; }
.cover-footer {
  font-family:'DMS',sans-serif; font-size:9pt; color:#AEAEB2; margin-top:8pt;
  text-align:right;
}
.cover-logo {
  font-family:'EBG',serif; font-style:italic; font-size:10pt; color:#1C1C1E;
}

/* ── CHAPTER ── */
.chapter-inner {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
}
.chapter-month { font-family:'DMS',sans-serif; font-size:9pt; color:#AEAEB2; letter-spacing:.6pt; }
.chapter-title {
  font-family:'EBG',serif; font-style:italic; font-size:22pt; color:#1C1C1E; margin-top:8pt;
}
.chapter-rule { width:20mm; height:.3pt; background:rgba(0,0,0,.08); margin-top:14pt; }
.chapter-sub { font-family:'DMS',sans-serif; font-size:9pt; color:#AEAEB2; margin-top:10pt; }

/* ── PHOTO FULL ── */
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
.placeholder { background:#F2F2F7; }
.photo-full-overlay {
  position:absolute; bottom:0; left:0; right:0;
  background:linear-gradient(transparent,rgba(255,255,255,.95) 40%);
  padding:5mm 15mm 14mm;
}

/* ── PHOTO NOTE ── */
.photo-note { flex-direction:column; }
.pn-image { width:var(--page-w); height:var(--pn-img-h); flex-shrink:0; overflow:hidden; }
.pn-text {
  flex:1; min-height:0; overflow:hidden;
  padding:4mm 15mm 14mm;
}

/* ── QUOTE ── */
.quote .inner { padding-top:14mm; padding-bottom:14mm; }
.quote-inner { justify-content:flex-start; }
.quote-fit-1 { padding-top:12mm; padding-bottom:12mm; }
.quote-fit-2 { padding-top:11mm; padding-bottom:11mm; }
.quote-header {
  display:flex; align-items:center; gap:4pt; margin-bottom:4mm;
}
.quote-mark {
  font-family:'EBG',serif; font-style:italic;
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

/* ── AUDIO (même squelette que photo-note + bandeau bas, aligné serveur) ── */
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
  padding-bottom:3mm;
  border-bottom:.3pt solid rgba(0,0,0,.08);
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
/* WebKit print : margin-top:auto sur flex enfant est souvent ignoré ; spacer + flex plus fiable. */
.audio-spacer {
  flex:1;
  min-height:0;
  flex-shrink:1;
}
.audio-player-row {
  display:flex;
  flex-direction:row;
  align-items:center;
  gap:4mm;
  flex-shrink:0;
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
.audio-wave-bars {
  display:flex;
  flex-direction:row;
  align-items:center;
  justify-content:flex-start;
  gap:2.5px;
  width:100%;
  box-sizing:border-box;
}
.audio-wave-bar {
  width:3px;
  border-radius:1px;
  flex-shrink:0;
}
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

/* ── VIDEO ── */
.video { flex-direction:column; }
.video-thumb { width:var(--page-w); height:${videoThumbPx}px; flex-shrink:0; overflow:hidden; }

/* ── BACK COVER ── */
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

/**
 * Logique alignée sur `src/book/maquette/MaquetteBookPages.tsx` pour que le PDF
 * reproduise l’aperçu (citations, forme d’onde audio, dates).
 */

const BAR_W = 3;
const BAR_GAP = 2.5;
const BAR_COUNT = 24;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Même barres pseudo-aléatoires que l’aperçu (`barHeightsFromId`). */
export function audioBarHeightsFromMemoryId(id: string): number[] {
  const rand = mulberry32(hashSeed(id));
  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    heights.push(4 + Math.floor(rand() * 17));
  }
  return heights;
}

/** SVG onde (viewBox px comme l’aperçu) ; le conteneur CSS fixe la largeur en mm. */
export function audioWaveformSvg(memoryId: string, viewBoxH = 24): string {
  const heights = audioBarHeightsFromMemoryId(memoryId);
  const waveW = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  const rects: string[] = [];
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    const x = i * (BAR_W + BAR_GAP);
    const y = (viewBoxH - h) / 2;
    const fill = i < BAR_COUNT * 0.4 ? '#5C8FA6' : 'rgba(0,0,0,0.12)';
    rects.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${BAR_W}" height="${h}" rx="1" fill="${fill}"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="audio-wave-svg" viewBox="0 0 ${waveW} ${viewBoxH}" preserveAspectRatio="xMidYMid meet">${rects.join('')}</svg>`;
}

/** Normalisation des paragraphes comme `MaquetteQuote` (useMemo body). */
export function normalizeQuoteBodyLikeMaquette(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const norm = t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const lines = norm.split('\n');
  const paragraphs: string[] = [];
  let current = '';
  const startsNew = (s: string) => /^[A-ZÀ-ÖØ-Þ0-9\u201C"'(\[]/u.test(s);
  const endsSentence = (s: string) => /[.!?…:;)]\s*$/u.test(s);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line) {
      if (current.trim()) paragraphs.push(current.trim());
      current = '';
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    const nextNonEmpty = (() => {
      for (let j = i + 1; j < lines.length; j++) {
        const cand = lines[j]!.trim();
        if (cand) return cand;
        break;
      }
      return '';
    })();

    const shouldBreakParagraph = endsSentence(current) || (nextNonEmpty !== '' && startsNew(line));
    if (shouldBreakParagraph) {
      paragraphs.push(current.trim());
      current = line;
    } else {
      current = `${current.trim()} ${line}`;
    }
  }
  if (current.trim()) paragraphs.push(current.trim());

  return paragraphs.join('\n\n');
}

export function quoteFitLevelFromBody(body: string): 0 | 1 | 2 {
  if (!body.trim()) return 0;
  const paragraphCount = body.split(/\n{2,}/).filter(p => p.trim()).length;
  const approxLines = Math.ceil(body.length / 42) + paragraphCount * 2;
  if (approxLines >= 22 || body.length >= 520 || paragraphCount >= 5) return 2;
  if (approxLines >= 18 || body.length >= 420 || paragraphCount >= 3) return 1;
  return 0;
}

export function dateFrCaps(iso: string): string {
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/** Même logique que l’app : retirer le suffixe « (région) » du géocodage. */
export function formatBookLocationShort(location: string | null | undefined): string {
  const raw = typeof location === 'string' ? location.trim() : '';
  if (!raw) return '';
  return raw.replace(/\s*\([^)]*\)\s*$/u, '').trim();
}

/** Libellé lieu PDF : court si possible, sinon texte brut. */
export function bookPdfLocationLabel(location: string | null | undefined): string {
  const raw = typeof location === 'string' ? location.trim() : '';
  if (!raw) return '';
  const short = formatBookLocationShort(location);
  return (short || raw).trim();
}

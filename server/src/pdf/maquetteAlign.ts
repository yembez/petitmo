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

/**
 * Normalisation des paragraphes comme `MaquetteQuote` (useMemo body).
 * Miroir obligatoire : `src/book/quoteFitLevel.ts` (aperçu app) — toute divergence casse l’alignement PDF / preview.
 */
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

const BOOK_CHARS_PER_LINE = 42;

/** Miroir `utils/textLimits.ts` — `estimateBookLines`. */
function estimateBookLines(text: string): number {
  if (!text) return 0;
  const physicalLines = text.split('\n');
  let total = 0;
  for (const line of physicalLines) {
    if (line.length === 0) {
      total += 1;
      continue;
    }
    total += Math.max(1, Math.ceil((line.length + 1) / BOOK_CHARS_PER_LINE));
  }
  return total;
}

export type TextMemorySizeTier = 'lg' | 'md' | 'sm';
export type TextMemoryLayoutVariant = 'guillemet' | 'titled' | 'dropcap';

export function textMemoryBookLineCount(rawContent: string): number {
  return estimateBookLines(normalizeQuoteBodyLikeMaquette(rawContent));
}

export function textMemorySizeTierFromLineCount(lines: number): TextMemorySizeTier {
  if (lines <= 8) return 'lg';
  if (lines <= 15) return 'md';
  return 'sm';
}

export function textMemoryLayoutVariant(memory: {
  text_title?: string | null;
  content?: string | null;
}): TextMemoryLayoutVariant {
  if ((memory.text_title ?? '').trim()) return 'titled';
  const lines = textMemoryBookLineCount(memory.content ?? '');
  return lines <= 8 ? 'guillemet' : 'dropcap';
}

export function resolveTextMemoryBookLayout(memory: {
  text_title?: string | null;
  content?: string | null;
}): {
  body: string;
  lines: number;
  tier: TextMemorySizeTier;
  variant: TextMemoryLayoutVariant;
  title: string;
} {
  const body = normalizeQuoteBodyLikeMaquette(memory.content ?? '');
  const lines = estimateBookLines(body);
  return {
    body,
    lines,
    tier: textMemorySizeTierFromLineCount(lines),
    variant: textMemoryLayoutVariant(memory),
    title: (memory.text_title ?? '').trim(),
  };
}

export function textMemoryBodyAlignCenter(tier: TextMemorySizeTier, variant: TextMemoryLayoutVariant): boolean {
  if (variant === 'guillemet') return true;
  if (variant === 'dropcap') return false;
  return tier === 'lg' || tier === 'md';
}

export function textMemoryBodyTextAlign(
  tier: TextMemorySizeTier,
  variant: TextMemoryLayoutVariant,
): 'center' | 'left' | 'justify' {
  if (textMemoryBodyAlignCenter(tier, variant)) return 'center';
  if (variant === 'dropcap' || (variant === 'titled' && tier === 'sm')) return 'left';
  return 'justify';
}

/** @deprecated — 0=lg, 1=md, 2=sm */
export function quoteFitLevelFromBody(body: string): 0 | 1 | 2 {
  const tier = textMemorySizeTierFromLineCount(estimateBookLines(normalizeQuoteBodyLikeMaquette(body)));
  return tier === 'lg' ? 0 : tier === 'md' ? 1 : 2;
}

export function dateFrCaps(iso: string): string {
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function monthsBetweenBirthAndEvent(birth: Date, event: Date): number {
  let months =
    (event.getFullYear() - birth.getFullYear()) * 12 + (event.getMonth() - birth.getMonth());
  if (event.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Âge de l'enfant à la date du souvenir. DOIT rester identique au client
 * (`formatAgeAtMemory` dans `utils/date.ts`).
 */
export function formatAgeAtMemory(
  birthdate: string | null | undefined,
  memoryDateIso: string
): string {
  if (!birthdate) return '';
  const birth = new Date(birthdate);
  const event = new Date(memoryDateIso);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(event.getTime()) || event < birth) {
    return '';
  }

  const diffMs = event.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const totalMonths = monthsBetweenBirthAndEvent(birth, event);

  if (totalMonths < 1) {
    if (diffDays < 1) return 'nouveau-né';
    if (diffDays < 7) return `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
    const w = Math.floor(diffDays / 7);
    return `${w} semaine${w > 1 ? 's' : ''}`;
  }

  if (totalMonths < 12) {
    return `${totalMonths} mois`;
  }

  const years = Math.floor(totalMonths / 12);
  const mo = totalMonths % 12;
  if (mo === 0) return `${years} an${years > 1 ? 's' : ''}`;
  return `${years} an${years > 1 ? 's' : ''} ${mo} mois`;
}

/**
 * Libellé date + âge (parité avec `dateWithAgeCaps` de la maquette client).
 * Ex. « 12 Mars 2026 · 2 ans 3 mois ».
 */
export function dateWithAgeCaps(iso: string, birthdate: string | null | undefined): string {
  const date = dateFrCaps(iso);
  const age = formatAgeAtMemory(birthdate, iso);
  return age ? `${date} · ${age}` : date;
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

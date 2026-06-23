/**
 * Mise en page page « Petits mots » (souvenir texte seul) — aperçu + PDF.
 * Miroir obligatoire : `server/src/pdf/maquetteAlign.ts`.
 */

import { estimateBookLines } from '@/utils/textLimits';

/** Normalisation des paragraphes comme `MaquetteQuote` / HTML `romanHtml`. */
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

export type TextMemorySizeTier = 'lg' | 'md' | 'sm';
export type TextMemoryLayoutVariant = 'guillemet' | 'titled' | 'dropcap';

export function textMemoryBookLineCount(rawContent: string): number {
  const body = normalizeQuoteBodyLikeMaquette(rawContent);
  return estimateBookLines(body);
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

/** Corps centré (titre présent, paliers lg/md). */
export function textMemoryBodyAlignCenter(tier: TextMemorySizeTier, variant: TextMemoryLayoutVariant): boolean {
  if (variant === 'guillemet') return true;
  if (variant === 'dropcap') return false;
  return tier === 'lg' || tier === 'md';
}

/** Alignement du corps selon variante / palier. */
export function textMemoryBodyTextAlign(
  tier: TextMemorySizeTier,
  variant: TextMemoryLayoutVariant,
): 'center' | 'left' | 'justify' {
  if (textMemoryBodyAlignCenter(tier, variant)) return 'center';
  if (variant === 'dropcap' || (variant === 'titled' && tier === 'sm')) return 'left';
  return 'justify';
}

/**
 * @deprecated Préférer `textMemorySizeTierFromLineCount` + classes `quote-tier-lg|md|sm`.
 * Conservé pour compatibilité transitoire (0=lg, 1=md, 2=sm).
 */
export function quoteFitLevelFromBody(body: string): 0 | 1 | 2 {
  const lines = estimateBookLines(normalizeQuoteBodyLikeMaquette(body));
  const tier = textMemorySizeTierFromLineCount(lines);
  return tier === 'lg' ? 0 : tier === 'md' ? 1 : 2;
}

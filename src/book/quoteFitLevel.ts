/**
 * Mise en page page « Petits mots » (souvenir texte seul) — aperçu + PDF.
 * Miroir obligatoire : `server/src/pdf/maquetteAlign.ts`.
 */

import { stripEmojisForBook } from '@/utils/stripEmojisForBook';
import { estimateBookLines } from '@/utils/textLimits';

/**
 * Nettoyage léger du corps souvenir pour le livre.
 * **Conserve les retours à la ligne** saisis (un `\n` = une ligne) ;
 * `\n\n` = nouveau paragraphe. Ne recolle plus les lignes en phrases.
 * Miroir : `server/src/pdf/maquetteAlign.ts`.
 */
export function normalizeQuoteBodyLikeMaquette(raw: string): string {
  const t = stripEmojisForBook(raw).trim();
  if (!t) return '';
  return t
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
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
  if (stripEmojisForBook((memory.text_title ?? '').trim()).trim()) return 'titled';
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
  const title = stripEmojisForBook((memory.text_title ?? '').trim()).trim();
  return {
    body,
    lines,
    tier: textMemorySizeTierFromLineCount(lines),
    variant: textMemoryLayoutVariant(memory),
    title,
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

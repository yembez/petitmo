/**
 * Même logique que `server/src/pdf/maquetteAlign.ts` (page citation PDF).
 * Toute modification doit être dupliquée côté serveur pour garder l’alignement.
 */

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

export function quoteFitLevelFromBody(body: string): 0 | 1 | 2 {
  if (!body.trim()) return 0;
  const paragraphCount = body.split(/\n{2,}/).filter(p => p.trim()).length;
  const approxLines = Math.ceil(body.length / 42) + paragraphCount * 2;
  if (approxLines >= 22 || body.length >= 520 || paragraphCount >= 5) return 2;
  if (approxLines >= 18 || body.length >= 420 || paragraphCount >= 3) return 1;
  return 0;
}

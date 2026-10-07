const LETTER_RE = /[a-zA-ZÀ-ÿ]/u;

function isLatinLetter(c: string): boolean {
  return LETTER_RE.test(c);
}

function isSoftSpace(c: string): boolean {
  return c === '\u2003' || (c !== '\n' && /\s/.test(c));
}

/** Première lettre alphabétique en majuscule (locale française). */
export function capitalizeFirstLetterFr(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c && isLatinLetter(c)) {
      return s.slice(0, i) + c.toLocaleUpperCase('fr-FR') + s.slice(i + 1);
    }
  }
  return s;
}

/**
 * Dictée clavier : le premier mot arrive souvent en minuscule quand le champ était vide.
 * On corrige uniquement ce cas (pas les retouches manuelles en milieu de texte).
 */
export function applyLeadingCapitalWhenStartingText(prev: string, next: string): string {
  if (prev.length === 0 && next.length > 0) {
    return capitalizeFirstLetterFr(next);
  }
  return next;
}

/**
 * Majuscule : début de texte, tête de ligne / paragraphe, et après `.` `!` `?`
 * suivis d’un espace (évite www.apple.com / 3.14).
 */
export function applySentenceAndParagraphCapitals(text: string): string {
  if (!text) return text;
  const chars = [...text];
  let out = '';
  let cap = true;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === '\n') {
      out += c;
      cap = true;
      continue;
    }
    if (isSoftSpace(c)) {
      out += c;
      continue;
    }
    if (cap && isLatinLetter(c)) {
      out += c.toLocaleUpperCase('fr-FR');
      cap = false;
      continue;
    }
    out += c;
    if (c === '.' || c === '!' || c === '?') {
      const next = chars[i + 1];
      cap =
        next == null ||
        next === '\n' ||
        isSoftSpace(next) ||
        next === '.' ||
        next === '!' ||
        next === '?';
    } else {
      cap = false;
    }
  }
  return out;
}

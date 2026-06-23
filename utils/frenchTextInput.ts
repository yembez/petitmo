/** Première lettre alphabétique en majuscule (locale française). */
export function capitalizeFirstLetterFr(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[a-zA-ZÀ-ÿ]/u.test(c)) {
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

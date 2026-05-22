/**
 * Prénom(s) enfant — prénoms composés avec espaces (« Jean Pierre », « Marie Louise »).
 * Le champ `children.name` stocke le prénom affiché, pas le nom de famille.
 */

/** Normalise espaces en tête/fin et entre les mots (persistance + affichage). */
export function normalizeChildGivenName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Prénom tel qu’affiché dans l’UI (Capturer, fil, etc.). */
export function childDisplayGivenName(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeChildGivenName(name);
}

/** Initiale pour avatar / placeholder (première lettre du prénom). */
export function childDisplayInitial(name: string | null | undefined): string {
  const given = childDisplayGivenName(name);
  return given ? given.charAt(0).toUpperCase() : '?';
}

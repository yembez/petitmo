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

/**
 * Liste de prénoms pour libellés FR naturels.
 * 1 → « Léa » · 2 → « Léa et Tom » · 3+ → « Léa, Tom et Zoé ».
 */
export function formatChildGivenNamesList(names: Array<string | null | undefined>): string {
  const cleaned = names
    .map(n => childDisplayGivenName(n))
    .filter(n => n.length > 0);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} et ${cleaned[1]}`;
  const head = cleaned.slice(0, -1).join(', ');
  return `${head} et ${cleaned[cleaned.length - 1]}`;
}

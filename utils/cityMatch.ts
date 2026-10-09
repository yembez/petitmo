/**
 * Rapprochement doux ville saisie ↔ communes connues d’un code postal (commande livre).
 * Jamais bloquant : une saisie « hors liste » reste autorisée ; on propose seulement.
 */

export type CityHint = { kind: 'mismatch'; suggestion: string };

/** Minuscule, sans accents, tirets/apostrophes/espaces normalisés (« Saint-Étienne » ≈ « st etienne »). */
export function normalizeCityName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-'’_.]/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bsainte\b/g, 'ste')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cityMatchesCommune(city: string, commune: string): boolean {
  const a = normalizeCityName(city);
  const b = normalizeCityName(commune);
  if (!a || !b) return false;
  if (a === b) return true;
  // « Paris 15 » / « Marseille 8e » → commune « Paris » / « Marseille ».
  return a.replace(/\s*\d+\s*(e|er|eme|ème)?$/, '').trim() === b;
}

/**
 * Hint pour la ville saisie :
 * - pas de communes connues, ville vide ou correspondance → `null` ;
 * - sinon suggestion = commune qui commence comme la saisie (frappe tronquée « Mont » →
 *   « Montpellier »), à défaut la première commune du code postal.
 */
export function getCityHint(city: string, communes: readonly string[]): CityHint | null {
  const typed = city.trim();
  if (!typed || communes.length === 0) return null;
  if (communes.some(c => cityMatchesCommune(typed, c))) return null;
  const n = normalizeCityName(typed);
  const prefix = communes.find(c => normalizeCityName(c).startsWith(n));
  const contains = prefix ?? communes.find(c => n && normalizeCityName(c).includes(n));
  return { kind: 'mismatch', suggestion: contains ?? communes[0] };
}

/** Préremplissage silencieux : seulement si le code postal désigne **une seule** commune. */
export function uniqueCommuneForAutofill(communes: readonly string[]): string | null {
  return communes.length === 1 ? communes[0] : null;
}

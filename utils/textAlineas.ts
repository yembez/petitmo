/**
 * Alinéas à la saisie — même cadratin que le fil / le livre (`FilMemoryRow`, maquette).
 * Stockage SQLite / cloud : **sans** cadratin (ajout uniquement à l’affichage et dans le champ).
 */

/** Cadratin (em quad) — alinéa en tête de chaque ligne non vide. */
export const TEXT_ALINEA_EM_QUAD = '\u2003';

export function stripTextAlineas(text: string): string {
  return text.replace(/\u2003/g, '');
}

/**
 * Préfixe chaque ligne non vide d’un cadratin (parité rendu fil / livre).
 * Les lignes vides (séparateurs de paragraphe) restent vides.
 */
export function applyTextAlineasForInput(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => {
      const body = line.replace(/^\u2003+/, '');
      return body.length === 0 ? '' : `${TEXT_ALINEA_EM_QUAD}${body}`;
    })
    .join('\n');
}

/**
 * Alinéas typographiques (cadratin) — **affichage seulement** (fil / viewer / livre).
 * Saisie : champ plat, sans cadratin (évite le ressenti « bug » à la frappe).
 * Stockage SQLite / cloud : **sans** cadratin ; strip à l’entrée / sortie des champs.
 */

/** Cadratin (em quad) — alinéa en tête de chaque ligne non vide à l’affichage. */
export const TEXT_ALINEA_EM_QUAD = '\u2003';

export function stripTextAlineas(text: string): string {
  return text.replace(/\u2003/g, '');
}

/**
 * Préfixe chaque ligne non vide d’un cadratin (rendu fil / livre).
 * Les lignes vides (séparateurs de paragraphe) restent vides.
 * @deprecated Plus utilisé à la saisie — conserver pour tests / éventuel rendu texte.
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

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Réconcilie la saisie avec les cadratins d’alinéa.
 *
 * Sans ça, un backspace en tête de ligne (juste après l’alinéa) ne supprime que le
 * `\u2003`, puis `applyTextAlineasForInput` le remet → le curseur ne « remonte » pas.
 *
 * Comportement voulu :
 * - backspace sur l’alinéa d’une ligne suivante → supprime le `\n` précédent (fusion) ;
 * - backspace sur l’alinéa de la 1ʳᵉ ligne → supprime le 1ʳᵉ caractère de contenu ;
 * - les alinéas restent présents sur chaque ligne non vide après réconciliation.
 */
export function reconcileTextAlineasOnChange(
  prevDisplay: string,
  nextDisplay: string,
): string {
  const prevN = normalizeNewlines(prevDisplay);
  const nextN = normalizeNewlines(nextDisplay);

  if (
    nextN.length < prevN.length &&
    stripTextAlineas(prevN) === stripTextAlineas(nextN)
  ) {
    let i = 0;
    while (i < nextN.length && prevN[i] === nextN[i]) i++;
    const deletedLen = prevN.length - nextN.length;
    const deleted = prevN.slice(i, i + deletedLen);
    if (
      deletedLen > 0 &&
      [...deleted].every(c => c === TEXT_ALINEA_EM_QUAD)
    ) {
      if (i > 0 && prevN[i - 1] === '\n') {
        // Remonter d’une ligne / fusionner avec la précédente.
        const merged = prevN.slice(0, i - 1) + prevN.slice(i + deletedLen);
        return applyTextAlineasForInput(stripTextAlineas(merged));
      }
      // Début du texte : traverser l’alinéa = effacer le 1ʳᵉ caractère utile.
      const after = i + deletedLen;
      if (after < prevN.length) {
        const merged = prevN.slice(0, i) + prevN.slice(after + 1);
        return applyTextAlineasForInput(stripTextAlineas(merged));
      }
      return '';
    }
  }

  return applyTextAlineasForInput(stripTextAlineas(nextN));
}

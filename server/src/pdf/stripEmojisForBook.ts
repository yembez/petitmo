/**
 * Retire les emoji du texte destiné au livre (PDF).
 * Ne pas utiliser pour persister / fil — rendu livre uniquement.
 * Miroir obligatoire : `utils/stripEmojisForBook.ts`.
 */
export function stripEmojisForBook(input: string): string {
  if (!input) return input;

  let s = input
    // Séquences ZWJ + VS16 optionnel (👨‍👩‍👧, ❤️, etc.)
    .replace(
      /\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/gu,
      '',
    )
    .replace(/\p{Emoji_Presentation}/gu, '')
    // Keycaps : 1️⃣ #️⃣ *️⃣
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
    .replace(/[\uFE0F\u20E3]/g, '')
    .replace(/\p{Emoji_Modifier}/gu, '');

  // Espaces horizontaux laissés par les suppressions (conserver les sauts de ligne)
  s = s.replace(/[^\S\n]{2,}/g, ' ');
  s = s.replace(/(^|\n)[^\S\n]+/g, '$1');
  s = s.replace(/[^\S\n]+(\n|$)/g, '$1');
  return s;
}

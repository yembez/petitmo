/**
 * Normalise une durée média (ImagePicker, trim natif…) en secondes entières.
 *
 * Expo ImagePicker iOS renvoie des **ms** ; d’anciennes API / certains trim
 * renvoient encore des **secondes**. Heuristique : valeur > 1000 ⇒ millisecondes
 * (une vidéo galerie < ~16 min en secondes reste sous ce seuil).
 */
export function mediaDurationToSeconds(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw > 1000) return Math.max(1, Math.round(raw / 1000));
  return Math.max(1, Math.round(raw));
}

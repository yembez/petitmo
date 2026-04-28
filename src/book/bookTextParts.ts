/**
 * Découpe / fusionne titre et corps pour la maquette livre (contenu unique en base).
 */

/**
 * Découpe titre / corps pour la mise en page « page 4 » (photo + annotation > 10 mots).
 * Priorité : blocs séparés par saut de ligne · première ligne · première phrase · premiers mots.
 */
export function splitPhotoNoteTitleBody(raw: string): { title: string; body: string } {
  const t = raw.trim();
  if (!t) return { title: 'Sans titre', body: '' };

  const blocks = t.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    return { title: blocks[0], body: blocks.slice(1).join('\n\n') };
  }

  const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { title: lines[0], body: lines.slice(1).join('\n') };
  }

  const one = lines[0] ?? t;
  const m = one.match(/^(.+?[.!?])(\s+[\s\S]+)$/);
  if (m && m[1] && m[2]) {
    return { title: m[1].trim(), body: m[2].trim() };
  }

  const words = one.split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    const title = words.slice(0, 10).join(' ');
    const body = words.slice(10).join(' ');
    return { title, body };
  }

  return { title: one, body: '' };
}

/** Reconstruit le champ `content` après édition titre + corps (photo-note). */
export function mergePhotoNoteTitleBody(title: string, body: string): string {
  const tt = title.trim();
  const bb = body.trim();
  if (!bb) return tt;
  if (!tt) return bb;
  return `${tt}\n\n${bb}`;
}

/** Vidéo : première ligne = titre, le reste = texte d’accompagnement. */
export function splitVideoTitleBody(raw: string): { title: string; body: string } {
  const t = (raw ?? '').trim();
  if (!t) return { title: '', body: '' };
  const idx = t.indexOf('\n');
  if (idx === -1) return { title: t, body: '' };
  return { title: t.slice(0, idx).trim(), body: t.slice(idx + 1).trim() };
}

export function mergeVideoTitleBody(title: string, body: string): string {
  const tt = title.trim();
  const bb = body.trim();
  if (!tt && !bb) return '';
  if (!bb) return tt;
  return `${tt}\n${bb}`;
}

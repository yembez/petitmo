/** Vidéo : première ligne = titre, le reste = texte d’accompagnement. */
export function splitVideoTitleBody(raw: string): { title: string; body: string } {
  const t = (raw ?? '').trim();
  if (!t) return { title: '', body: '' };
  const idx = t.indexOf('\n');
  if (idx === -1) return { title: t, body: '' };
  return { title: t.slice(0, idx).trim(), body: t.slice(idx + 1).trim() };
}

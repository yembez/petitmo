/** Extrait un message lisible depuis une réponse d’erreur Gelato (souvent `errors[]`). */
export function formatGelatoApiError(
  status: number,
  json: Record<string, unknown>,
  rawText: string,
): string {
  const parts: string[] = [];

  if (typeof json.message === 'string' && json.message.trim()) {
    parts.push(json.message.trim());
  }
  if (typeof json.error === 'string' && json.error.trim()) {
    parts.push(json.error.trim());
  }

  if (typeof json.code === 'string' && json.code.trim()) {
    parts.push(`code=${json.code.trim()}`);
  }

  const errors = json.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (typeof entry === 'string' && entry.trim()) {
        parts.push(entry.trim());
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const o = entry as Record<string, unknown>;
      const field = [o.reference, o.field, o.path, o.property, o.key]
        .find(v => typeof v === 'string' && v.trim()) as string | undefined;
      const code = typeof o.code === 'string' && o.code.trim() ? o.code.trim() : '';
      const msg =
        (typeof o.message === 'string' && o.message.trim()) ||
        (typeof o.error === 'string' && o.error.trim()) ||
        (typeof o.detail === 'string' && o.detail.trim()) ||
        JSON.stringify(o);
      const line = [code, field ? `${field}: ${msg}` : msg].filter(Boolean).join(' ');
      parts.push(line);
    }
  }

  const detailObj = json.detail;
  if (detailObj && typeof detailObj === 'object') {
    parts.push(`detail=${JSON.stringify(detailObj).slice(0, 400)}`);
  }

  if (parts.length === 0 && rawText.trim()) {
    parts.push(rawText.trim().slice(0, 800));
  }

  const detail = parts.length > 0 ? parts.join(' | ') : 'unknown error';
  return `gelato ${status}: ${detail}`.slice(0, 2000);
}

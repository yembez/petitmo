/** UUID v4 (RFC) — requis par Supabase pour `children.id` et `memories.id`. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPetitmoUuid(id: string): boolean {
  return UUID_V4_RE.test(id.trim());
}

function randomUuidV4Fallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Nouvel id entité (enfant, souvenir) — toujours UUID, même si `crypto.randomUUID` absent (Hermes). */
export function newPetitmoEntityId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return randomUuidV4Fallback();
}

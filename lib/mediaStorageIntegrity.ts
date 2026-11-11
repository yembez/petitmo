import { supabase } from '@/lib/supabase';

/**
 * Vérifie qu’un objet existe réellement dans le bucket `media` (list + taille).
 * `createSignedUrl` seul ne prouve rien — il signe un chemin même absent.
 */
export async function assertMediaObjectExists(
  filePath: string,
  opts?: { minBytes?: number },
): Promise<{ size: number }> {
  const path = filePath.replace(/^\/?media\//, '').replace(/^\/+/, '').trim();
  if (!path) throw new Error('Chemin Storage vide');

  const parts = path.split('/');
  const name = parts.pop()?.trim();
  const dir = parts.join('/');
  if (!name) throw new Error(`Chemin Storage invalide: ${path}`);

  const { data, error } = await supabase.storage.from('media').list(dir || undefined, {
    limit: 100,
    search: name,
  });
  if (error) throw error;

  const row = (data ?? []).find(o => (o.name ?? '') === name);
  if (!row) {
    throw new Error(`Objet Storage introuvable après upload: ${path}`);
  }

  const sizeRaw = (row.metadata as { size?: number } | null)?.size;
  const size = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) ? sizeRaw : 0;
  const min = opts?.minBytes ?? 1;
  if (size < min) {
    throw new Error(`Objet Storage trop petit (${size} < ${min}): ${path}`);
  }
  return { size };
}

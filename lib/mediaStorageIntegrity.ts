import { supabase } from '@/lib/supabase';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeStoragePath(filePath: string): string {
  return filePath.replace(/^\/?media\//, '').replace(/^\/+/, '').trim();
}

/**
 * Repli : URL signée + HEAD / Range (jamais télécharger toute la vidéo en RAM).
 */
async function assertViaSignedProbe(
  path: string,
  opts?: { minBytes?: number },
): Promise<{ size: number } | null> {
  const { data, error } = await supabase.storage.from('media').createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  const url = data.signedUrl;
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    }
    if (!(res.ok || res.status === 206)) return null;

    let size = 0;
    const contentRange = res.headers.get('content-range');
    const rangeTotal = contentRange?.match(/\/(\d+)\s*$/)?.[1];
    if (rangeTotal) size = Number(rangeTotal);
    if (!Number.isFinite(size) || size <= 0) {
      const cl = res.headers.get('content-length');
      if (cl) size = Number(cl);
    }
    if (!Number.isFinite(size) || size < 0) size = 0;

    const min = opts?.minBytes ?? 1;
    // HEAD sans Content-Length : existence OK, taille inconnue → accepter si min faible.
    if (size > 0 && size < min) {
      throw new Error(`Objet Storage trop petit (${size} < ${min}): ${path}`);
    }
    return { size: size > 0 ? size : min };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Objet Storage trop petit')) throw e;
    return null;
  }
}

async function assertViaList(
  path: string,
  opts?: { minBytes?: number },
): Promise<{ size: number }> {
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

/**
 * Vérifie qu’un objet existe réellement dans le bucket `media`.
 * Retries : juste après un PUT signé, `list` peut renvoyer vide (lag / index).
 */
export async function assertMediaObjectExists(
  filePath: string,
  opts?: { minBytes?: number; attempts?: number },
): Promise<{ size: number }> {
  const path = normalizeStoragePath(filePath);
  if (!path) throw new Error('Chemin Storage vide');

  const attempts = Math.max(1, Math.min(opts?.attempts ?? 5, 8));
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await assertViaList(path, opts);
    } catch (e) {
      lastErr = e;
      try {
        const viaProbe = await assertViaSignedProbe(path, opts);
        if (viaProbe) return viaProbe;
      } catch (getErr) {
        lastErr = getErr;
      }
      if (i < attempts - 1) {
        await sleep(180 * Math.pow(2, i));
      }
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error(`Objet Storage introuvable après upload: ${path}`);
}

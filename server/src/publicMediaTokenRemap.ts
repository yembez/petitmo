import type { SupabaseClient } from '@supabase/supabase-js';

export type PublicMediaTokenRemapPair = { from: string; to: string };

export type PublicMediaTokenRemapResult = {
  remapped: number;
  dropped: number;
};

/**
 * Met à jour `public_media_tokens.media_id` après remapping local `loc_*` → UUID.
 * Si le nouvel id a déjà un token pour le même `kind`, la ligne legacy est supprimée.
 */
export async function remapPublicMediaTokenMediaIds(
  supabase: SupabaseClient,
  remaps: PublicMediaTokenRemapPair[],
): Promise<PublicMediaTokenRemapResult> {
  let remapped = 0;
  let dropped = 0;

  for (const pair of remaps) {
    const oldId = (pair.from ?? '').trim();
    const newId = (pair.to ?? '').trim();
    if (!oldId || !newId || oldId === newId) continue;

    const { data: rows, error: selErr } = await supabase
      .from('public_media_tokens')
      .select('token, kind')
      .eq('media_id', oldId);
    if (selErr) throw new Error(selErr.message);
    if (!rows?.length) continue;

    for (const row of rows) {
      const token = (row as { token?: string }).token?.trim();
      const kind = (row as { kind?: string }).kind?.trim();
      if (!token || !kind) continue;

      const { data: atNew, error: newErr } = await supabase
        .from('public_media_tokens')
        .select('token')
        .eq('media_id', newId)
        .eq('kind', kind)
        .maybeSingle();
      if (newErr) throw new Error(newErr.message);

      if ((atNew as { token?: string } | null)?.token?.trim()) {
        const { error: delErr } = await supabase.from('public_media_tokens').delete().eq('token', token);
        if (delErr) throw new Error(delErr.message);
        dropped += 1;
        continue;
      }

      const { error: upErr } = await supabase
        .from('public_media_tokens')
        .update({ media_id: newId, updated_at: new Date().toISOString() })
        .eq('token', token);
      if (upErr) throw new Error(upErr.message);
      remapped += 1;
    }
  }

  return { remapped, dropped };
}

import { supabase } from '@/lib/supabase';

/**
 * Fire-and-forget : snapshot JSON (texte + méta + refs Storage) → R2
 * après écriture cloud réussie. Zéro impact UI (local-first).
 */
export function triggerMirrorMemoryMetaToR2(memoryId: string): void {
  const id = (memoryId || '').trim();
  if (!id) return;
  void (async () => {
    try {
      const { error } = await supabase.functions.invoke('mirror-memory-meta-to-r2', {
        body: { memoryId: id },
      });
      if (error) {
        console.warn('[memoryMetaBackup] mirror-memory-meta-to-r2', id, error.message);
      }
    } catch (e) {
      console.warn('[memoryMetaBackup] mirror-memory-meta-to-r2', id, e);
    }
  })();
}

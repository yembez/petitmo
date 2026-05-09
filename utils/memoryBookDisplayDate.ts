import type { Memory } from '@/types/local';

/**
 * ISO utilisé pour le libellé de date dans le **livre** (aperçu maquette + PDF client/serveur) :
 * `created_at` = date de l’événement / de prise (EXIF, fichier, enregistrement…).
 *
 * Ne **jamais** utiliser `inserted_at` pour ce libellé : c’est l’ordre d’ajout au fil, pas la prise réelle.
 *
 * @see supabase/migrations/20260417133000_add_inserted_at_to_memories.sql
 */
export function memoryBookDisplayDateIso(m: Pick<Memory, 'created_at'>): string {
  return m.created_at;
}

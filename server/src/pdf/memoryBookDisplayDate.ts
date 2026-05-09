import type { MemoryRow } from './memoryRow';

/**
 * Même règle que l’app (`utils/memoryBookDisplayDate.ts`) : date d’événement pour livre/PDF,
 * pas `inserted_at` (non chargée dans `MemoryRow` export PDF).
 */
export function memoryBookDisplayDateIso(m: Pick<MemoryRow, 'created_at'>): string {
  return m.created_at;
}

/**
 * Communes françaises pour un code postal — API publique `geo.api.gouv.fr` (gratuite, sans clé).
 * Usage : préremplir / vérifier la ville dans le formulaire de commande (Low Friction : jamais
 * bloquant, jamais d’attente réseau visible — résolution en fond, cache mémoire).
 */

const GEO_API_BASE = 'https://geo.api.gouv.fr/communes';
const FETCH_TIMEOUT_MS = 4000;

const cache = new Map<string, Promise<string[]>>();

export function isFrenchPostalCode(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim());
}

async function fetchCommunes(zip: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${GEO_API_BASE}?codePostal=${encodeURIComponent(zip)}&fields=nom&format=json`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    if (!Array.isArray(json)) return [];
    const names: string[] = [];
    for (const row of json) {
      const nom = row && typeof row === 'object' ? (row as { nom?: unknown }).nom : null;
      if (typeof nom === 'string' && nom.trim()) names.push(nom.trim());
    }
    return names;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Noms des communes du code postal (vide si inconnu, hors France, réseau KO ou timeout).
 * Les échecs ne sont pas mis en cache (retentera plus tard).
 */
export function getFrenchCommunesForPostalCode(zipRaw: string): Promise<string[]> {
  const zip = zipRaw.trim();
  if (!isFrenchPostalCode(zip)) return Promise.resolve([]);
  const hit = cache.get(zip);
  if (hit) return hit;
  const p = fetchCommunes(zip).then(names => {
    if (names.length === 0) cache.delete(zip);
    return names;
  });
  cache.set(zip, p);
  return p;
}

# Fil familial unifié (Phase 1)

> **Règle d'or** : lecture **SQLite locale** (`getAllLocalMemories`). En cloud Petitmo+, sync par enfant puis fusion locale — pas de nouveau fetch Supabase dans les composants UI.

## Produit

- **Un seul fil** et **un seul onglet favoris** pour toute la famille.
- Les souvenirs restent stockés avec `child_id` (technique, capture) — **pas d'attribution affichée**.
- Les âges sur chaque post = `formatFamilyAgesLine` (spec `family-ages-display.md`).
- **Quota gratuit** : `FREE_TIER_LIMIT` souvenirs **famille** (tous enfants confondus).

## Données

| Fonction | Rôle |
|----------|------|
| `getAllLocalMemories()` | Tous les souvenirs SQLite, tri `COALESCE(inserted_at, created_at) DESC` |
| `getFamilyMemories()` | Local → SQLite ; cloud → `pullFamilyMemoriesFromRemoteToLocal()` puis SQLite |
| `pullFamilyMemoriesFromRemoteToLocal()` | Pull chaque enfant local, puis `getAllLocalMemories()` |

## UI

| Zone | Changement |
|------|------------|
| `useFeedData` | `getFamilyMemories()` au lieu de `getMemories(selectedChildId)` |
| `favoris.tsx` | idem |
| `tabScreensHydrate` | hydratation fil depuis `getAllLocalMemories()` |
| `FeedHeader` | 1 enfant : inchangé ; 2+ : avatars chevauchés + prénoms (« A et B ») |

## Hors scope

- Retrait de `child_id` à la capture
- Livres sans prénom enfant sur la couverture

Voir aussi : `capture-family-mosaic.md` (grille Capturer).

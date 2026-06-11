# Mosaïque Capturer — photos profil famille

> **Règle d'or** : enfants et photos lus depuis **SQLite locale** (`listLocalChildren`) + sandbox. Aucun fetch Supabase dans cet écran.

## Produit

| Enfants | Hero Capturer |
|---------|----------------|
| 0 | Parcours création profil |
| 1 | Carte hero actuelle (photo plein cadre, respiration, pilules prénom + âge) |
| 2+ | **Grille** de photos profil (pas de chevauchement) |

- Tap sur une tuile → `edit-child` pour cet enfant.
- Chevauchement d’avatars **uniquement** sur le header fil (pas ici).
- Titre CTAs : 1 enfant → « Quel souvenir pour {prénom} » ; 2+ → « Quel souvenir pour votre famille ».
- Capture (écrire / audio / import) : inchangée — `child_id` technique via `getOrSelectFirstChild()` (Phase 2).

## Grille

Algorithme lignes (`computeCaptureMosaicRows`) :

- 2 → `[2]`
- 3 → `[2, 1]` (deux en haut, un en bas pleine largeur)
- 4 → `[2, 2]`
- 5+ → rangées de 2, dernière ligne 1 si impair

Gap entre tuiles : `scale(6)`. Coins intérieurs arrondis. Même traitement couleur / cover que le hero (`CAPTURE_HERO_COLOR_MATRIX`).

## Fichiers

- `utils/captureMosaicLayout.ts` — découpage lignes
- `components/CaptureFamilyMosaic.tsx` — grille + tuile
- `app/(tabs)/index.tsx` — branchement solo vs famille

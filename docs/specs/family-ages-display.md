# Âges famille sur les souvenirs (Phase 1 — affichage)

> **Règle d'or** : calcul **100 % local** (SQLite → mémoire). Aucun fetch Supabase dans les composants carte. Identique en gratuit et Petitmo+.

## Contexte produit

Petitmo adopte un **flux familial** : un souvenir n'est plus « à » un enfant. On affiche automatiquement **l'âge de chaque enfant de la famille** à la date du souvenir, sans attribution manuelle ni modal.

- Source date souvenir : `memories.created_at` (prise / événement), **pas** `inserted_at`.
- Source naissance : `children.birthdate` (SQLite locale).
- **Hors scope Phase 1** : `child_id` sur les souvenirs, sync cloud, PDF serveur (`htmlBook.ts`), mosaïque Capturer, avatars fil.

## Fonctions (`utils/childrenAge.ts`)

| Fonction | Rôle |
|----------|------|
| `computeChildAge(birthdate, atDate)` | Années + mois entre deux ISO ; `null` si date invalide ou souvenir avant naissance |
| `formatAge(years, months)` | Libellé d'âge selon les règles ci-dessous |
| `formatFamilyAgesLine(children, memoryDate)` | Ligne complète pour une carte / en-tête |
| `sortChildrenByBirthdateAsc(children)` | Tri aîné → cadet (date de naissance croissante) |

## Règles de format d'âge (`formatAge`)

Basé sur `totalMonths = years × 12 + months` :

| Condition | Exemple |
|-----------|---------|
| `totalMonths < 24` | `11 mois`, `12 mois`, `23 mois` |
| `2 ≤ years ≤ 5` et `months = 0` | `3 ans` |
| `2 ≤ years ≤ 5` et `months > 0` | `3 ans 2 mois` |
| `years > 5` (mois ignorés) | `7 ans` |

**Note** : entre 12 et 23 mois, on affiche **toujours en mois** (`12 mois`…`23 mois`), pas `1 an`. À partir de 24 mois (`2 ans`), on bascule sur le format années.

Cas limites :

- Souvenir **antérieur** à la naissance d'un enfant → cet enfant est **exclu** de la ligne.
- `birthdate` vide / invalide → enfant ignoré.
- Aucun enfant éligible → `""` (fallback : date seule, comme aujourd'hui).
- Jour de naissance (`0 mois`) → `0 mois`.

## Règles de ligne famille (`formatFamilyAgesLine`)

**Ordre** : enfants éligibles triés par `birthdate` **croissante** (aîné en premier).

**Séparateurs** : espace entre prénom et âge ; ` - ` entre chaque enfant (fil).

### Un seul enfant éligible

Prénom **complet** (normalisé via `childDisplayGivenName`) + unités complètes (`mois`, `ans`) :

```
Charlotte 3 ans 2 mois
```

Même si la famille compte plusieurs enfants mais qu'un seul a une date de naissance valide à cette date.

### Deux enfants éligibles

Libellé court par enfant + unités complètes :

- Par défaut : **initiale + point** → `C.`, `T.`
- **Collision** d'initiale (même première lettre, insensible à la casse) : **3 premiers caractères** du prénom, **sans point** → `Léa`, `Luc` (pour Lucas)

Exemples :

```
L. 3 ans - T. 11 mois
Léa 3 ans - Luc 11 mois
```

### Trois enfants éligibles ou plus

Même règle de libellé court qu'à 2 enfants, mais unités **abrégées** : `m` (mois), `a` (ans).

```
L. 5 a - T. 3 a - E. 11 m
```

## Points d'intégration UI (Phase 1)

| Zone | Comportement |
|------|----------------|
| `FilMemoryRow` | Pastille jour : date + ligne âges famille |
| `MemoryContextHeaderText` | Date gras · âges léger · lieu |
| `memory-viewer` | Chrome haut : date + âges |
| `memory-view` | Meta sous le souvenir |
| `MaquetteBookPages` | `dateWithAgeCaps` : date capitale · ligne âges |

**Données** : `familyChildren` depuis `listLocalChildren()` / `getChildren()` — liste complète de la famille, pas l'enfant « sélectionné » seul.

## Tests unitaires (`utils/__tests__/childrenAge.test.ts`)

Cas minimaux :

- 0 enfant → `""`
- 1 enfant, 11 mois → `Léa 11 mois`
- 1 enfant, 3 ans 2 mois → `Léa 3 ans 2 mois`
- 1 enfant, 7 ans → `Léa 7 ans`
- 2 enfants sans collision → `L. 3 ans - T. 11 mois`
- 2 enfants collision (Léa + Lucas) → `Léa 3 ans - Luc 11 mois`
- 3 enfants → `L. 5 a - T. 3 a - E. 11 m`
- 1 enfant sans birthdate → `""`
- Souvenir avant naissance du cadet → cadet exclu

## Phase 2 (non couverte ici)

- Retrait fonctionnel de `child_id` / fil unifié tous enfants
- Parité PDF serveur (`server/src/pdf/htmlBook.ts`)
- Quota souvenirs « famille »
- Mosaïque Capturer multi-enfants

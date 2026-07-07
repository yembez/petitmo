# Rapport de bug — Fil : flash plein écran sur une ancienne vidéo

> Rapport **purement descriptif** du symptôme observé. Aucune hypothèse, aucune cause, aucun
> correctif — uniquement ce qui est constaté à l'usage.

## Environnement

- Application Petitmo, plateforme **iOS** (device physique).
- Écran concerné : le **fil** (liste des souvenirs).
- Souvenir concerné : une **vidéo ancienne**, datée du **2026-05-17**
  (id `8b95005e-6029-463f-88bd-fb6a0c0e4ba0`), capturée **avant** le passage à Petitmo+.

## Symptôme

- En **arrivant** sur ce souvenir vidéo pendant le défilement, et surtout **en y revenant**
  (retour dessus après l'avoir dépassé), il apparaît un **flash plein écran** d'une fraction de
  seconde.
- Le contenu du flash est le **poster de la vidéo accompagné d'une icône « play »** (l'aspect d'une
  vignette vidéo non lancée), affiché **en plein écran**.
- Ce n'est **pas** un flash noir.
- Le flash s'accompagne de **saccades / sauts** du défilement du fil à ce moment-là.
- Après le flash, la vidéo se lance normalement en lecture inline.

## Reproduction

1. Ouvrir le fil.
2. Faire défiler jusqu'à l'ancienne vidéo (2026-05-17).
3. S'arrêter brièvement dessus.
4. Continuer de défiler puis **revenir** sur ce même souvenir.
   → Le flash plein écran (poster + icône play) se produit, avec saccade du fil.

## Fréquence

- Reproductible **à chaque** passage / retour sur ce souvenir vidéo ancien.

## Périmètre

- Constaté sur cette **vidéo ancienne** (pré-Petitmo+).
- Les vidéos récentes ne présentent **pas** ce flash plein écran poster+play (elles ont un autre
  comportement, distinct, non couvert par ce rapport).

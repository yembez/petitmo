# Guide — Extraire les paths SVG du logo petitmo

L'animation de tracé fonctionne avec la technique `stroke-dashoffset` :
on trace le contour du logo comme si un stylo le dessinait en temps réel.
Pour ça, il faut que le logo soit en **paths SVG** (pas en texte, pas en image).

---

## Étape 1 — Exporter depuis Figma

1. Ouvre ton fichier Figma avec le logo petitmo
2. Sélectionne le calque du mot "petitmo" (le lettrage manuscrit)
3. Clic droit → **"Flatten selection"** (pour convertir le texte en paths)
4. Clic droit → **"Copy/Paste as" → "Copy as SVG"**
5. Colle dans un fichier `.svg` ou directement dans le code

Le SVG obtenu ressemble à ça :
```svg
<svg viewBox="0 0 200 60">
  <path d="M20 46 C20 46 ..." />  <!-- le "p" -->
  <path d="M40 30 C40 24 ..." />  <!-- le "e" -->
  <!-- ... -->
</svg>
```

---

## Étape 2 — Séparer les paths par lettre

Pour que l'écriture soit progressive (lettre par lettre), il faut que
chaque lettre soit un path séparé dans Figma.

Si ce n'est pas le cas :
1. Sélectionne le lettrage dans Figma
2. **Flatten** → puis **"Use as Mask"** non, plutôt :
3. Clic droit → **"Detach instance"** si c'est un composant
4. Ensuite dans le panneau Layers, vérifie que chaque lettre est bien
   un layer séparé. Si non, dégroupe jusqu'à avoir une couche par lettre.

---

## Étape 3 — Mesurer la longueur de chaque path (pathLength)

La valeur `pathLength` dans `SplashAnimation.tsx` doit correspondre
à la longueur réelle de chaque path. Voici comment la mesurer :

### Méthode A — Dans le navigateur (la plus simple)
```html
<!-- Crée un fichier test.html temporaire -->
<svg id="mysvg" viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg">
  <path id="p" d="COLLE TON PATH ICI" />
</svg>
<script>
  const length = document.getElementById('p').getTotalLength()
  console.log('pathLength =', length)
</script>
```
Ouvre dans Chrome → F12 → Console → tu vois la longueur.

### Méthode B — Script Node.js
```bash
npm install -g svgpath
node -e "
const {parsePath} = require('svgpath');
// ... ou utilise svg-path-properties
"
```

### Méthode C — Figma Plugin
Installe le plugin **"SVG Path Editor"** dans Figma.
Il affiche la longueur totale du path sélectionné.

---

## Étape 4 — Calibrer les delays

Dans `SplashAnimation.tsx`, chaque segment a un `delay` en millisecondes.
Le principe : les delays sont cumulatifs, chaque lettre commence
légèrement avant que la précédente soit terminée (effet écriture fluide).

Exemple de calibration pour "petitmo" (durée totale : 1000ms) :

```
p  → delay: 0ms,   duration: 160ms  (lettre longue, descente + courbe)
e  → delay: 120ms, duration: 140ms
t  → delay: 230ms, duration: 130ms  (barre + accent)
i  → delay: 340ms, duration: 90ms   (court)
t  → delay: 410ms, duration: 130ms
m  → delay: 520ms, duration: 200ms  (lettre large, 2 courbes)
o  → delay: 690ms, duration: 150ms  (fermé, rond)
               ↑
    dernier delay + duration ≤ 1000ms (fin à 840ms)
```

Ajuste selon la longueur visuelle de chaque lettre dans ton logo.

---

## Étape 5 — Mettre à jour SplashAnimation.tsx

Remplace le tableau `LOGO_SEGMENTS` dans `components/SplashAnimation.tsx` :

```tsx
const LOGO_SEGMENTS: PathSegment[] = [
  {
    d: 'COLLE ICI LE PATH DU "p"',
    pathLength: 72,   // valeur mesurée à l'étape 3
    delay: 0,
    duration: 160,
  },
  {
    d: 'COLLE ICI LE PATH DU "e"',
    pathLength: 68,
    delay: 120,
    duration: 140,
  },
  // ... etc pour chaque lettre
]
```

Et remplace aussi `HEART_PATH` avec le path du cœur du logo.

---

## Étape 6 — Ajuster le viewBox

Change `SVG_WIDTH` et `SVG_HEIGHT` dans `SplashAnimation.tsx`
pour correspondre aux dimensions réelles de ton logo exporté depuis Figma.

```tsx
const SVG_WIDTH = 170   // largeur du viewBox de ton SVG exporté
const SVG_HEIGHT = 68   // hauteur du viewBox de ton SVG exporté
```

---

## Dépannage fréquent

| Problème | Cause | Solution |
|---|---|---|
| Le trait commence à la fin | strokeDashoffset dans le mauvais sens | Inverse : `withTiming(pathLength, ...)` → `withTiming(0, ...)` |
| L'animation saute | pathLength incorrecte | Remesure avec getTotalLength() |
| Une lettre disparaît | fill="black" cache le path | Assure-toi que `fill="none"` |
| Trop rapide / trop lent | Ajuste `duration` de chaque segment | Augmente pour ralentir |
| Le cœur ne rebondit pas | Valeurs spring trop élevées | Baisse `damping` (ex: 8) ou `stiffness` (ex: 120) |

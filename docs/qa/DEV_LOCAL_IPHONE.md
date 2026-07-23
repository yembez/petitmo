# Développer vite sur iPhone (sans Xcode)

Objectif : corriger le code et voir le résultat en **quelques secondes**, sans rebuild TestFlight à chaque fois.

> Xcode sur le Mac n’est **pas** obligatoire. On utilise un **dev client** compilé dans le cloud (EAS).

---

## Les 3 modes (à ne pas mélanger)

| Mode | Quand | Vitesse |
|------|--------|---------|
| **Dev** (ce guide) | Tu corriges toi, tous les jours | Secondes (reload) |
| **OTA** (`npm run ota:production`) | Petit correctif JS déjà sur TestFlight (toi + testeurs) | Minutes |
| **TestFlight** (`npm run tf:ios`) | Natif / 1ʳᵉ install OTA / envoi aux mamans | 30–60+ min |

Même icône « Petitmo » : installer le **dev** remplace TestFlight sur ton iPhone (et inversement).

---

## Une seule fois — installer le client de développement

Ouvre un **nouveau** Terminal (tu peux laisser tourner un `tf:ios` ailleurs) :

```bash
cd /Users/yem/SWEETOO_PROJECT/PETITMO_LOCAL_DEV/petitmo_local_dev
npm run dev:ios:build
```

1. Connecte-toi Apple si demandé.
2. Si EAS demande d’**enregistrer ton iPhone** (UDID) : suis les prompts (branche le téléphone ou entre le UDID).
3. Attends le build (~15–40 min) → lien sur [expo.dev](https://expo.dev) → projet **petitmo** → Builds.
4. Sur l’iPhone : ouvre le build → **Install** (profil / confiance « Entreprise » ou développeur si iOS le demande).

Tu as maintenant une app Petitmo **spéciale développement** (pas la même chaîne que TestFlight store, mais même nom).

---

## Tous les jours — corriger et tester

1. iPhone et Mac sur le **même Wi‑Fi**.
2. Sur le Mac :

```bash
cd /Users/yem/SWEETOO_PROJECT/PETITMO_LOCAL_DEV/petitmo_local_dev
npm run dev
```

3. Ouvre **Petitmo** sur l’iPhone.
4. Si l’app demande le serveur : scanne le QR du Terminal, ou tape l’URL affichée (`exp://…`).
5. Tu modifies le code → l’app recharge (parfois : secouer l’iPhone → Reload).

**Le Terminal `npm run dev` doit rester ouvert** pendant que tu testes.

Si le Wi‑Fi bloque : `npm run dev:tunnel` à la place de `npm run dev`.

---

## Trim vidéo gratuit (20 s)

Le coupe-vidéo in-app (`react-native-video-trim`) est **natif** : après `npm install` / ajout du package, il faut **un nouveau build** :

```bash
npm run dev:ios:build
# ou
npm run tf:ios
```

Sans ce rebuild, « Raccourcir la vidéo » affichera « Mise à jour requise ».

---

## Quand refaire un `dev:ios:build` ?

Seulement si tu changes du **natif** (nouveau module, permissions, bump SDK Expo, gros changement `ios/`, **trim vidéo**).  
Pour du JS / UI / fil / Capturer : **non** — juste `npm run dev`.

---

## Repasser sur TestFlight

TestFlight → Petitmo → Installer / Mettre à jour.  
Ça écrase le client dev. Tes souvenirs locaux peuvent être effacés au switch — normal.

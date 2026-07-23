# TestFlight — mode d’emploi (non-développeur)

Objectif : installer **Petitmo** sur ton iPhone (et celui de proches choisis) **sans** publier l’app sur l’App Store public. Tu pourras **corriger** et **renvoyer** une nouvelle version autant de fois que tu veux.

---

## Les 3 apps / sites dont tu auras besoin

| Où | Pour quoi |
|----|-----------|
| [App Store Connect](https://appstoreconnect.apple.com) | Créer l’app, inviter les testeurs |
| [developer.apple.com](https://developer.apple.com/account) | Voir ton **Team ID** |
| Terminal (sur ton Mac) | Lancer 2 commandes de build |

Sur ton iPhone : installer l’app **TestFlight** (gratuite, Apple).

---

## Étape 0 — Vérifier ton compte Apple

1. Tu as un compte **Apple Developer** payant (99 €/an) lié à ton email (souvent `2speek@gmail.com`).
2. Si ce n’est pas le cas : [developer.apple.com/programs](https://developer.apple.com/programs/) → s’inscrire / payer.

Sans ce compte, TestFlight n’est pas possible.

---

## Étape 1 — Créer l’app dans App Store Connect (une seule fois)

1. Va sur [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → connecte-toi.
2. Clique **Apps** (Mes apps).
3. Bouton **+** → **Nouvelle app**.
4. Remplis :
   - **Plateformes** : iOS
   - **Nom** : Petitmo (ou Petitmo Bêta si le nom est pris)
   - **Langue principale** : Français
   - **Identifiant de lot (Bundle ID)** : choisis **`com.petitmo.app`**  
     (s’il n’apparaît pas : va d’abord sur [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → + → App IDs → enregistrer `com.petitmo.app`)
   - **SKU** : `petitmo` (texte interne, libre)
5. Valide / Créer.

### Récupérer 2 numéros importants

**A) App ID App Store Connect**  
Dans ta fiche app → **Informations sur l’app** (App Information) → **Apple ID** (un long numéro, ex. `6754123456`).  
→ Copie-le dans un Note.

**B) Team ID**  
[developer.apple.com/account](https://developer.apple.com/account) → Membership details → **Team ID** (ex. `AB12CD34EF`).  
→ Copie-le aussi.

---

## Étape 2 — Remplir ces 2 numéros dans le projet (une seule fois)

Sur ton Mac, ouvre le fichier :

`petitmo_local_dev/eas.json`

Cherche la partie :

```json
"ascAppId": "REPLACE_ME_APP_STORE_CONNECT_APP_ID",
"appleTeamId": "REPLACE_ME_APPLE_TEAM_ID"
```

Remplace par tes vrais numéros, exemple :

```json
"ascAppId": "6754123456",
"appleTeamId": "AB12CD34EF"
```

Enregistre le fichier.

*(Si tu préfères, envoie les 2 numéros à ton assistant IA pour qu’il les mette à ta place — ne partage pas de mots de passe.)*

---

## Étape 3 — Mettre les clés Supabase sur Expo (une seule fois)

L’app TestFlight a besoin de parler à ton serveur Supabase. Ces clés ne sont **pas** dans le fichier du téléphone automatiquement.

1. Ouvre un **Terminal**.
2. Va dans le dossier du projet :

```bash
cd /Users/yem/SWEETOO_PROJECT/PETITMO_LOCAL_DEV/petitmo_local_dev
```

3. Lance (une par une). Remplace `<CLE_ANON>` par la clé **anon** de Supabase  
   (Dashboard Supabase → Project Settings → API → `anon` `public`) :

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://gswtsnhmwjwhwjdiijbs.supabase.co" --environment production --visibility plaintext
```

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<CLE_ANON>" --environment production --visibility sensitive
```

Si on te demande de te connecter à Expo : utilise le compte **guilhembez** (déjà utilisé sur ce Mac).

---

## Étape 4 — Construire l’app (build)

Toujours dans le Terminal, dans le même dossier :

```bash
cd /Users/yem/SWEETOO_PROJECT/PETITMO_LOCAL_DEV/petitmo_local_dev
eas build --platform ios --profile production
```

### Ce qui va se passer

1. Expo te pose peut‑être des questions (Apple login, certificats) → suis les prompts à l’écran, accepte les valeurs proposées.
2. Le build part **dans le cloud** (15–40 min). Tu peux fermer le Terminal une fois l’URL de suivi affichée, ou laisser tourner.
3. À la fin : statut **finished** / réussi.

Suivi aussi ici : [expo.dev](https://expo.dev) → ton projet **petitmo** → Builds.

---

## Étape 5 — Envoyer vers TestFlight (submit)

Quand le build est **terminé** :

```bash
eas submit --platform ios --profile production --latest
```

Tu te reconnecteras peut‑être à Apple. À la fin, le build apparaît dans **App Store Connect → TestFlight**.

*(Astuce plus tard : `eas build --platform ios --profile production --auto-submit` fait les étapes 4+5 d’un coup.)*

---

## Étape 6 — Attendre le traitement Apple

1. App Store Connect → **TestFlight**.
2. Tu vois la build (ex. 1.0.0 (2)).
3. Statut : **Traitement** → puis **Prête à tester** (souvent 10–40 min, parfois plus).

S’il manque des infos (export compliance, etc.) : réponds aux questions (souvent « Non » pour chiffrement non exempt — l’app a déjà `ITSAppUsesNonExemptEncryption: false`).

---

## Étape 7 — T’ajouter comme testeur + installer

### Toi (interne)

1. App Store Connect → **Utilisateurs et accès** : ton compte est Admin/App Manager.
2. TestFlight → **Testeurs internes** → ajoute-toi / ton groupe.
3. Sur **ton iPhone** : installe **TestFlight** depuis l’App Store.
4. Ouvre le mail d’invitation Apple **ou** ouvre TestFlight : **Petitmo** apparaît → **Installer**.

### Proches choisis (5–15 mamans)

1. TestFlight → **Testeurs externes** → créer un groupe « Bêta FR ».
2. Ajoute leurs **emails Apple** (celui de leur iPhone).
3. Ils reçoivent un mail → Installer TestFlight → accepter → Installer Petitmo.
4. *Première fois avec testeurs externes* : Apple peut faire une petite review (1–2 jours). Les **internes** (toi) n’attendent souvent pas ça.

---

## Étape 8 — Tester (P0.3)

Sur l’iPhone avec TestFlight, parcours :

1. Créer un enfant  
2. Ajouter photo / texte / audio  
3. Favoris → livre (≥ 30 pages si tu commandes)  
4. Commander impression (si prévu en bêta)  
5. Noter tout bug (capture d’écran + message)

---

## Corriger et renvoyer une nouvelle version

### A) Correctif JS / UI seulement (rapide — EAS Update / OTA)

Une fois qu’un build TestFlight **avec OTA** est installé (après la mise en place `expo-updates`) :

1. On corrige le code (toi + assistant).  
2. Tu lances :

```bash
cd /Users/yem/SWEETOO_PROJECT/PETITMO_LOCAL_DEV/petitmo_local_dev
npm run ota:production -- --message "fix: cold start Capturer"
```

3. Sur l’iPhone : **ferme complètement** Petitmo (swipe up) puis rouvre. L’update se télécharge au lancement ; parfois un **2ᵉ redémarrage** est nécessaire pour l’appliquer.  
4. Pas de nouveau build Apple, pas d’attente TestFlight « Mettre à jour » binaire.

**OTA OK** : textes, styles, écrans, logique JS, anim Capturer, etc.  
**OTA KO** → rebuild (section B) : nouveau module natif, bump SDK Expo, permissions, plugins `app.json` natifs.  
**Bare workflow** : `runtimeVersion` est une chaîne fixe dans `app.json` (ex. `"1.0.0"`). À **incrémenter manuellement** (ex. `"1.0.1"`) quand tu changes du natif, sinon un OTA incompatible pourrait cibler d’anciens binaires.

### B) Changement natif ou 1ʳᵉ build avec OTA (lent)

1. On corrige le code (toi + assistant).  
2. Tu relances :

```bash
npm run tf:ios
```

équivalent à :

```bash
eas build --platform ios --profile production --auto-submit
```

3. Quand Apple a traité la nouvelle build → dans TestFlight, les testeurs voient **Mettre à jour**.  
4. Tu n’as **pas** besoin de republier sur l’App Store public.

> **Important** : les builds TestFlight **avant** l’ajout d’OTA ne reçoivent pas les updates. Il faut **un** rebuild (`npm run tf:ios`) pour activer OTA, puis les correctifs JS suivants passent par `npm run ota:production`.

---

## Ce que tu ne fais PAS (pour l’instant)

- Ne clique **pas** sur « Ajouter pour examen » / « Publier » pour l’**App Store** (vitrine publique).  
- Reste uniquement dans l’onglet **TestFlight**.

---

## En cas de blocage fréquent

| Message / symptôme | Que faire |
|--------------------|-----------|
| Bundle ID introuvable | Créer `com.petitmo.app` sur developer.apple.com → Identifiers |
| Login Apple échoue dans le Terminal | Vérifier 2FA ; ou créer une [clé API App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) et suivre le guide EAS |
| Build échoue | Ouvrir le lien « Logs » sur expo.dev → copier l’erreur à ton assistant |
| App s’ouvre mais pas de données / erreurs réseau | Vérifier étape 3 (secrets Supabase) |
| Testeur ne reçoit pas le mail | Vérifier spam ; email = Apple ID de son iPhone |

---

## Résumé ultra-court

1. Créer l’app App Store Connect (`com.petitmo.app`)  
2. Coller App ID + Team ID dans `eas.json`  
3. Secrets Supabase avec `eas env:create`  
4. `npm run tf:ios` (build + submit TestFlight)  
5. TestFlight → installer → tester  
6. Correctifs JS : `npm run ota:production -- --message "…"` (fermer / rouvrir l’app)  
7. Changement natif : refaire `npm run tf:ios`

Quand tu as fait les étapes **1** et **2** (numéros prêts), dis-le : on pourra vérifier `eas.json` et lancer le premier build avec toi.

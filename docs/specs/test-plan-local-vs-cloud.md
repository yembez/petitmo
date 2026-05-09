# Cahier de tests — Petitmo (Local gratuit vs Cloud Petitmo+)

Objectif : un protocole **exhaustif, reproductible**, qui évite les tests “au hasard”.

> Règle d’or (résumé) : gratuit = **local pur** ; payant = **cloud** (sync/restauration).
> Voir [`docs/specs/architecture-locale-cloud.md`](architecture-locale-cloud.md).

---

## 0) Préparation commune

### 0.1 Appareil(s)

- **iPhone** principal (tests réinstall, appareil réel).
- Optionnel : iPad ou 2e iPhone (tests multi-device Petitmo+).

### 0.2 Build / environnement

- Noter : branche/commit, type de build (dev client / TestFlight / prod), date.
- Vérifier que l’app est bien celle du build testé (pas un vieux bundle).

### 0.3 Jeu de données test (médias)

Créer un set de médias stable :
- Photos : 6 photos (2 claires, 2 sombres, 2 très détaillées, 1 HEIC si possible).
- Vidéos : 2 vidéos (1 courte, 1 plus longue).
- Audios : 2 enregistrements (1 < 30s, 1 > limite gratuite).

### 0.4 Grille de reporting (à remplir)

Pour chaque test :
- **ID test** (ex : A3.2)
- **Résultat** : OK / KO
- **Symptôme** (si KO)
- **Log clé** (si utile)
- **Capture** (si utile)

---

## A) Parcours “Gratuit” (Local pur, sans compte)

### A0 — Installation / première ouverture

1. Désinstaller l’app.
2. Réinstaller (même build).
3. Ouvrir l’app.

Attendu :
- Écran onboarding accessible.
- “Commencer” démarre sans login obligatoire.
- Aucune promesse de backup/sync.

### A1 — Création enfant (local)

1. Créer un profil enfant.

Attendu :
- L’enfant apparaît dans le fil/onglets.
- Aucune dépendance cloud.

### A2 — Import photos (local)

1. Importer 3 photos (1 seule, puis un petit lot si option).
2. Ouvrir chaque souvenir dans le fil + détail.

Attendu :
- Affichage immédiat (sources `local_*`).
- Pas de “photo impossible à charger”.

### A3 — Import audio (local)

1. Enregistrer un audio court.
2. Vérifier lecture, cover, affichage.

Attendu :
- Souvenir audio visible et lisible localement.

### A4 — Création livre (gratuit)

1. Créer un livre.
2. Ajouter des photos + un audio.

Attendu :
- Livre OK.
- QR audio OK (si prévu en gratuit dans livre).

### A5 — Vidéo dans livre (gratuit : interdit)

1. Tenter d’ajouter une vidéo au livre.

Attendu :
- Message clair + CTA paywall (`BookUpgradeRequiredError`), pas de crash.

### A6 — Réinstall (gratuit : données perdues)

1. Désinstaller l’app.
2. Réinstaller.

Attendu :
- Les souvenirs précédents **ne reviennent pas**.
- Le produit ne fait pas croire à une restauration possible.

---

## B) Parcours “Petitmo+” (Cloud payant)

Pré-requis : un compte Petitmo+ existe (abonnement actif).

### B0 — Login / restauration (compte payant)

1. Sur l’onboarding : “J’ai déjà un compte”.
2. Se connecter (modal login classique).

Attendu :
- Login réussi.
- Sync/restore des données cloud vers local.

### B0bis — Email connu “commande/CRM” mais PAS abonné Petitmo+

1. Sur l’onboarding : “J’ai déjà un compte”.
2. Saisir un email qui existe en base (commande livre / CRM) mais **sans** `subscriptionTier=paid`.

Attendu :
- Message : **“Cette adresse e-mail n’a pas de compte cloud payant associé”**
- CTA : **“Créer un compte”** qui ouvre le **paywall** (abonnement d’abord), puis création/lien du compte après paiement.

### B1 — Import photos (cloud + local)

1. Importer 3 photos.
2. Vérifier affichage immédiat (local) + persistance.

Attendu :
- Affichage instantané (local) + upload cloud en arrière-plan.
- Après un refresh, les photos restent visibles (pas d’écrasement des `local_*`).

### B2 — Multi-device (optionnel)

1. Se connecter sur un 2e appareil.

Attendu :
- Données récupérées depuis le cloud.

### B3 — Vidéo dans livre (payant : autorisé)

1. Importer une vidéo.
2. Ajouter la vidéo au livre.

Attendu :
- Autorisé + preview OK.

### B4 — Réinstall (payant : restauration)

1. Désinstaller l’app.
2. Réinstaller.
3. Login “J’ai déjà un compte”.

Attendu :
- Tous les souvenirs reviennent.
- Pas de “sandbox fantôme” cassant l’affichage.

---

## C) Cas particuliers Email — Commande vs Compte cloud

### C0 — Email “commande” sans compte cloud (gratuit)

But : valider la distinction “email présent en base ≠ compte cloud payant”.

1. En gratuit, effectuer une commande (flux livre/PDF) en fournissant un email.
2. Désinstaller / réinstaller.
3. Sur onboarding : “J’ai déjà un compte”.
4. Entrer le **même email**.

Attendu :
- Message : **“Cette adresse e-mail n’a pas de compte cloud payant associé”**.
- CTA : **“Créer un compte”**.
- Aucune restauration des souvenirs (gratuit).

### C1 — Email payant (compte cloud) vs email commande

1. Avec un compte Petitmo+, se connecter avec l’email du compte.
2. Vérifier restauration.

Attendu :
- Restauration OK, même si l’email existe aussi côté commande/CRM.

---

## D) Checklist “sanity” (anti-régression)

- D1 : Aucun écran gratuit ne crée un compte cloud.
- D2 : Aucune écriture Supabase hors exceptions en gratuit.
- D3 : Après pull cloud, les `local_*` ne sont jamais écrasés (helpers/merge).
- D4 : Les messages paywall sont clairs et sans crash.


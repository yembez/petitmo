# Architecture Petitmo — Local-first (gratuit) vs Cloud (Petitmo+)

> Référence canonique. À citer dans les commits / PR / décisions produit
> sous la forme : `voir docs/specs/architecture-locale-cloud.md`.
> La forme courte pour les agents IA est dans [`AGENTS.md`](../../AGENTS.md).

---

## 1. Règle d'or

Petitmo a **deux modes**, et **deux modes seulement**.

### 1.1 Mode local — plan gratuit, sans compte

- **Promesse produit** : ultra simple, zéro friction, instantané, sans inscription obligatoire.
- Dès l'install, l'utilisatrice peut **immédiatement** :
  - écrire un souvenir texte ;
  - ajouter des photos (seule ou en album) ;
  - enregistrer un audio ;
  - créer un livre avec couverture + photos + audio (QR audio).
- **Stockage** :
  - SQLite local (`expo-sqlite`) ;
  - sandbox / app storage du téléphone (`petitmo_memories/<id>/...`).
- **Conséquences acceptées** :
  - aucun cloud, aucun backup, aucune sync multi-appareil ;
  - **si perte du téléphone, les données sont perdues** (choix produit assumé pour
    tenir la promesse "zéro friction" et permettre l'usage sans création de compte).

#### Exceptions Supabase autorisées en mode local

Le mode gratuit n'écrit en base distante que dans **ces deux cas exclusifs** :

1. **Achat PDF / commande livre** (paiement à l'acte).
2. **Stockage cloud du souvenir audio** uniquement pour permettre un
   **QR code pérenne** dans un livre commandé.

Hors de ces deux cas, **aucune écriture cloud n'est permise** en gratuit.
Pas de backup automatique, pas de sync silencieuse, pas de "au cas où".

### 1.2 Mode cloud — Petitmo+ (abonnement payant)

**Abonnement = compte** : le paywall vient d'abord, puis la création/lien du compte après paiement réussi — via **Google**, **Apple** ou **email + mot de passe** (dans cet ordre de présentation).
Et active :

- sync cloud bidirectionnelle des souvenirs / enfants ;
- restauration sur nouveau téléphone ;
- multi-device ;
- QR pérennes (audio **et** vidéo) ;
- exports serveur (PDF haute qualité).

---

## 2. Diagramme de flux

```mermaid
flowchart LR
    install[Installation app] --> mode{Plan ?}
    mode -- "gratuit (defaut)" --> local[SQLite + sandbox UNIQUEMENT]
    local --> use1[ecrire / photos / audio / livre sans video]
    mode -- "passe a Petitmo+" --> account[Creation compte cloud]
    account --> cloud[Sync Supabase complete]
    cloud --> use2[restauration + multi-device + QR video]
    local -. "exceptions ciblees" .-> supaFree["Achat PDF/livre + audio QR perenne"]
    local -. "perte telephone" .-> lost[Donnees perdues, accepte]
```

---

## 3. Conséquences UX (à appliquer partout)

| Décision | Pourquoi |
|---|---|
| Bouton "J'ai déjà un compte" (login classique) | Autorisé. Si l'email n'a pas de **compte cloud payant**, afficher un message clair + CTA "Créer un compte". |
| Aucun parcours gratuit ne déclenche email/mot de passe | Sinon ça contredit la promesse "sans inscription obligatoire". |
| Aucun texte "tes souvenirs sont sauvegardés" en gratuit | Faux et trompeur. Le badge actuel "Confidentialité 100% préservée" reste correct. |
| Vidéo dans un livre en gratuit → `BookUpgradeRequiredError` + paywall | Le QR vidéo nécessite un stockage cloud pérenne, donc Petitmo+. |

---

## 3.1 Distinction critique : email de commande vs compte cloud Petitmo+

Un **email peut exister en base** (gratuit) pour :\n
- associer une **commande de livre** et ses **QR codes audio**,\n
- alimenter le **CRM** (suivi de commande + marketing futur).\n
\n
Cela ne signifie **pas** qu'il existe un **compte cloud Petitmo+** pour cet email.\n
\n
Un **compte cloud Petitmo+** = identité (email/Apple/Google) **liée à un abonnement payant**,\n
autorisant **sync**, **restauration** et **multi-device**.\n
\n
Source de vérité : **serveur** (ex. flag `subscriptionTier=paid` sur l'identité auth Supabase),\n
alimenté par webhook **RevenueCat** → Edge Function Supabase (Apple IAP / StoreKit sur iOS, Google Play Billing sur Android à venir). **Stripe n'intervient pas dans les abonnements in-app.**\n
Le tier en AsyncStorage est un **cache UX**, jamais une preuve.\n
\n
Conséquence UX : sur login, si l'email est connu côté commande/CRM mais **sans compte payant**,\n
montrer : **\"Cette adresse e-mail n'a pas de compte cloud payant associé\"** + CTA **\"Créer un compte\"**.\n

## 4. Pointeurs code

| Concept | Fichier |
|---|---|
| Mode `local` vs `cloud` (dérivé du tier) | [`lib/userMode.ts`](../../lib/userMode.ts) |
| Tier `free` vs `paid` | [`lib/userTier.ts`](../../lib/userTier.ts) |
| Limites plan gratuit | [`lib/limits.ts`](../../lib/limits.ts) |
| Capture 100% locale | [`services/localOnlyMemoryCapture.ts`](../../services/localOnlyMemoryCapture.ts) |
| Erreur upgrade livre (vidéo gratuit) | [`services/books.ts`](../../services/books.ts) |
| Device-user Supabase (mécanique interne) | [`app/_layout.tsx`](../../app/_layout.tsx) |
| Écran d'accueil | [`app/onboarding.tsx`](../../app/onboarding.tsx) |
| Modale "Ajouter au livre" + alerte upgrade | [`components/AddToBookModal.tsx`](../../components/AddToBookModal.tsx) |

---

## 5. Cas limites et règles

### 5.1 Réinstall / changement de téléphone — gratuit

- **Souvenirs perdus**, point. C'est assumé produit.
- L'écran d'accueil reproposera "Commencer" → nouveau profil enfant local.
- Ne **jamais** afficher de message du type "voulez-vous restaurer ?" pour un compte gratuit (il n'y a rien à restaurer).

### 5.2 Réinstall / changement de téléphone — Petitmo+

- L'utilisatrice clique **"Restaurer mon compte Petitmo+"**.
- Login via **Google**, **Apple** ou **email + mot de passe**.
- Téléchargement des souvenirs depuis Supabase, écriture en local.
- Pendant le téléchargement, afficher un message doux : **"On restaure tes souvenirs de [prénom enfant], encore quelques instants…"** — obligatoire dès que la restauration dépasse 2 secondes.
- Garde-fou existant (`isProbablyStalePetitmoSandboxPath` dans
  [`utils/localMediaReadable.ts`](../../utils/localMediaReadable.ts))
  pour basculer sur les URLs cloud quand un `file://...petitmo_memories/...`
  pointe vers un fichier qui n'existe plus.

### 5.3 Mécanique du device-user Supabase

L'app crée systématiquement une session Supabase anonyme dans
[`app/_layout.tsx`](../../app/_layout.tsx) (`deviceId@petitmo.local` via la
function `create-device-user`).

- C'est une **mécanique technique** pour rendre possibles les **exceptions
  autorisées** (achat PDF/livre, audio QR pérenne).
- **Elle n'est jamais présentée à l'utilisatrice** comme un compte.
- Quand l'utilisatrice passe à Petitmo+ et crée un vrai compte, on peut lier la
  session existante au compte (à concevoir dans un plan dédié).

### 5.4 Utilisateur payant qui clique "S'abonner" par erreur

Si l'utilisatrice clique sur un CTA "S'abonner" ou "Créer un compte" alors qu'un compte cloud Petitmo+ existe déjà pour son identité (email, Apple ID ou Google) :

- Ne pas relancer un parcours de paiement.
- Afficher : **"Tu as déjà un compte Petitmo+, connecte-toi ici."**
- CTA unique : **"Me connecter"** → redirige vers l'écran de login normal.
- Ce cas doit être détecté **avant** d'ouvrir le paywall si possible (vérification serveur), sinon au moment de l'auth post-paiement.

### 5.5 Paiements et source de vérité du tier

**Stack paiement (règle absolue) :**
- **iOS** : Apple In-App Purchase (StoreKit)
- **Android** *(à venir)* : Google Play Billing
- **Middleware** : RevenueCat — valide les receipts, gère les renouvellements, envoie les webhooks
- **Stripe n'intervient pas** dans les abonnements in-app

**Où vit `subscriptionTier=paid` :**
- Dans `auth.users.app_metadata` sur Supabase (option A — standard RevenueCat + Supabase).
- Mis à jour par une Edge Function déclenchée par webhook RevenueCat à chaque événement (achat, renouvellement, expiration, remboursement).
- `app_metadata` est côté serveur uniquement — jamais modifiable par le client.
- L'app le cache dans AsyncStorage (`petitmo:userTier`) via `lib/userTier.ts` — cache UX uniquement, jamais source de vérité.

### 5.6 Sélection du tier (code)

- `lib/userTier.ts` lit la valeur `petitmo:userTier` dans AsyncStorage
  (`'free'` ou `'paid'`).
- `lib/userMode.ts` en dérive `local` ou `cloud`.
- Tout flux qui veut écrire dans Supabase (hors exceptions) doit d'abord
  vérifier `getCachedUserMode() === 'cloud'`.

---

## 6. Cahier de test rapide

### 6.1 Profil gratuit (local-first strict)

1. Désinstaller / réinstaller, créer enfant.
2. Importer 3 photos, 1 audio, créer un livre.
3. Vérifier qu'**aucune** ligne `memories` n'apparaît côté Supabase.
4. Tenter d'ajouter une vidéo au livre → alerte `BookUpgradeRequiredError`
   + CTA paywall (cf. [`services/books.ts`](../../services/books.ts)).

### 6.2 Profil payant

1. Activer Petitmo+ (créer compte).
2. Importer 3 photos + 1 vidéo.
3. Vérifier sync cloud + dérivés (`print_url`, `display_url`, etc.).
4. Ajouter la vidéo au livre : autorisé, QR vidéo OK.

### 6.3 Payant + réinstall

1. Désinstaller, réinstaller.
2. Cliquer "Restaurer mon compte Petitmo+", login.
3. Vérifier que les souvenirs sont rechargés depuis le cloud, sans casser
   sur des `file://` morts.

---

## 7. Drapeaux rouges (signes d'une violation de la règle d'or)

- Du code écrit dans `memories` sur Supabase **sans** vérifier que le tier est
  `paid` ni qu'on est dans une des deux exceptions autorisées.
- Un parcours qui propose login/inscription en plein milieu d'un import gratuit.
- Un texte UX promettant restauration / sauvegarde sans avoir vérifié le tier.
- Un fallback `setUserTier('paid')` automatique sans paiement.

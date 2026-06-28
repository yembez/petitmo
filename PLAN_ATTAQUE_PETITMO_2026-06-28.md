# Plan d'attaque Petitmo → lancement App Store

> **Stratégie (corrigée le 28/06) : le PAIEMENT est en DERNIER.**
> On construit et on valide d'abord tout le fonctionnel — cloud, QR, médias, impression Gelato — **gratuitement**, puis on branche le paiement réel une fois que tout marche.

Décision de périmètre : on construit tout, l'impression Gelato est séquencée vers la fin et reste **retirable du v1** si elle n'est pas prête.

Principe directeur : **chaque phase a une « porte de test » (Definition of Done).** Une phase n'est finie que quand son test passe.

---

## Peut-on tout tester gratuitement, sans payer ni créer de comptes ? → OUI

| Pour tester… | Comment, gratuitement | Paiement requis ? |
|---|---|---|
| Devenir « Petitmo+ » | Interrupteur de tier local déjà présent (`parent-space.tsx`, `setUserTier('paid')`) | ❌ Aucun |
| Session cloud | Device-user auto-créé au lancement (`_layout.tsx` → `create-device-user`) | ❌ Aucun |
| Backend Supabase | Projet déjà configuré (offre gratuite) | ❌ Aucun |
| Restauration / multi-appareil | Ajouter un **login email/mdp de test** (Supabase auth gratuit), réutilisé sur 2 appareils | ❌ Aucun |
| API Gelato (commande, webhooks) | Compte Gelato gratuit, intégration testable | ❌ pour l'intégration |
| Qualité d'impression réelle | **1 échantillon Gelato** | 💶 quelques € (1 fois, en fin de Phase 4) |
| Build sur iPhone réel + soumission | Compte **Apple Developer** | 💶 99 €/an, **seulement à la Phase 6-7** |

👉 **Tu n'as besoin d'aucun compte de paiement (RevenueCat / Apple IAP) avant la toute dernière phase.** Le stub actuel du paywall = ton levier de test, pas un bug.

---

## Vue d'ensemble (ordre d'exécution corrigé)

```
TRACK A — FONCTIONNEL D'ABORD (gratuit), séquentiel
  Phase 1  Harnais de test gratuit (interrupteur free/paid propre)
  Phase 2  MODE CLOUD : sync, migration local→cloud, restauration, multi-appareil
  Phase 3  Stockage médias + QR codes vocaux de bout en bout
  Phase 4  Impression Gelato (API + 1 échantillon réel) — go/no-go v1
  Phase 5  PDF — consolider (déjà le plus avancé)

  ── tout marche ? alors seulement ──

  Phase 6  PAIEMENT (en dernier) : IAP abonnement + PDF, livre = paiement web,
           compte post-paiement, entitlement serveur
  Phase 7  Durcissement + QA TestFlight + soumission

TRACK B — EN PARALLÈLE, vers la fin (bloque la soumission, pas le dev)
  Légal : confidentialité + CGU + suppression compte in-app + privacy labels
  Store : captures + fiche App Store + landing petitmo.app
```

---

## Phase 1 — Harnais de test gratuit (½ journée)

But : pouvoir basculer free ↔ paid proprement, sans payer, et garder ça isolé pour le retirer en prod.

- [ ] Formaliser un **interrupteur dev** free/paid (tu as déjà la logique dans `parent-space.tsx` + `lib/userTier.ts`). Le rendre visible uniquement en `__DEV__`.
- [ ] Documenter la procédure de test : « passer paid », « repasser free » (`resetUserTierForTesting`).
- [ ] Confirmer que le **device-user** se crée bien et que `getSession()` renvoie une session (logs `_layout.tsx`).

🔑 **Porte :** tu bascules paid/free à volonté, gratuitement, et une session cloud est active.

---

## Phase 2 — MODE CLOUD (jamais testé — priorité n°1)

But : valider la promesse Petitmo+ — sync, restauration, multi-appareil.

- [ ] **Sync mono-appareil** : en tier paid, les souvenirs/enfants remontent dans Supabase (vérifier tables + storage).
- [ ] **Migration local → cloud** au passage paid (`services/migration.ts`) : ordre textes → photos → audios → vidéos, sans bloquer la nav, reprise après coupure réseau (AGENTS.md étape 10).
- [ ] **Login email/mdp de test** (gratuit) pour obtenir une identité persistante au-delà du device-user.
- [ ] **Restauration** : réinstall / 2e appareil avec ce compte test → tout revient.
- [ ] **Multi-appareil** : une modif se propage.
- [ ] Vérifier que le **gratuit n'écrit jamais dans le cloud** hors exceptions (achat livre/PDF, QR audio).

🔑 **Porte :** « capture locale → passage paid → migration → réinstall → restauration » réussi de bout en bout.

---

## Phase 3 — Stockage médias + QR codes (non testés)

But : un QR de livre ouvre le bon média, hébergé et accessible, et expire correctement.

- [ ] Générer un livre avec un souvenir **vocal** → vérifier création `qr_links` + `public_media_tokens` + bucket QR.
- [ ] **Upload du média** ciblé pour QR pérenne (exception autorisée même en gratuit pour un livre commandé).
- [ ] Scanner le QR → résolution via `server/.../routes/publicMedia.ts` (`/m/{id}`) → **lecture du média** sur un téléphone tiers.
- [ ] Tester **expiration** des tokens (`expires_at`) et le cas **vidéo = paid uniquement**.
- [ ] Décider du **domaine public** (`EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL`, aujourd'hui Railway) : garder Railway ou passer à `petitmo.app/m/...`.

🔑 **Porte :** QR d'un livre réel → bon média lu sur un appareil tiers, et expiration vérifiée.

---

## Phase 4 — Impression Gelato (API + échantillon) — décision go/no-go v1

But : brancher la fulfillment réelle. Le flux commande existe (adresse, consentement RGPD, prix, PDF print fond perdu 4 mm) ; **il manque l'appel à l'API Gelato**.

- [ ] Compte **Gelato** gratuit + clés API + SKU livre 21×28 couverture rigide.
- [ ] Brancher la **création de commande** Gelato après génération du PDF print (greffe sur `init-export` / `export_print`).
- [ ] **Webhooks Gelato** (production / expédition) → suivi.
- [ ] **1 échantillon réel** : valider qualité d'impression, fond perdu, couleurs, **QR scannable sur papier**.

🔑 **Porte / décision :** échantillon bon **avant la date de soumission** → impression dans le v1. Sinon → on **masque l'entrée « commander »** (UI seulement, le code est déjà cloisonné) et l'impression sort en v1.1.

> ⚠️ **Important pour la Phase 6** : le **livre imprimé est un bien physique → interdit en achat in-app Apple.** Il devra être payé **hors store** (web / Stripe). Le **PDF**, lui, est numérique → **obligatoirement via l'IAP**. À garder en tête, mais ça ne bloque pas les tests d'intégration Gelato (qui ne dépendent pas du paiement client).

---

## Phase 5 — PDF (déjà fonctionnel → consolider)

- [ ] **Parité aperçu ↔ PDF** (`.cursor/rules/book-maquette-pdf-parity.mdc`) sur 3-4 livres types (texte seul, photo+note, vocal, mixte).
- [ ] **Contrôle qualité DPI** (warning <240, blocage <200).
- [ ] Cas **serveur PDF indisponible** : message propre, pas de génération locale.

🔑 **Porte :** export PDF identique à l'aperçu, erreurs propres.

---

## Phase 6 — PAIEMENT (EN DERNIER, quand tout le reste marche)

But : remplacer le levier de test par de vrais paiements.

**Pré-requis (maintenant seulement) :** Apple Developer, App Store Connect, RevenueCat.

- [ ] Créer les produits : `petitmo_plus_monthly` (5,99 €), `petitmo_plus_yearly` (49,99 €), `petitmo_pdf_export` (4,99 €).
- [ ] `npx expo install react-native-purchases react-native-purchases-ui` ; **init au 1er lancement** (AGENTS.md).
- [ ] Paywall : `handlePurchase` → vrai `Purchases.purchasePackage()` (remplacer le stub) + **restauration d'achat**.
- [ ] **Compte cloud post-paiement** : Sign in with Apple (obligatoire) + Google + email ; `Purchases.logIn(user.id)`.
- [ ] **Edge Function webhook RevenueCat** → `auth.users.app_metadata.subscriptionTier` ; l'app lit ce statut (AsyncStorage = cache).
- [ ] **Livre imprimé = paiement web/Stripe** (bien physique, hors IAP).
- [ ] **Retirer** le harnais de test (interrupteur dev, `resetUserTierForTesting`).

🔑 **Porte :** achat sandbox mensuel/annuel + PDF passent, restauration OK, statut paid vient du serveur ; impossible de devenir paid sans payer.

---

## Phase 7 — Durcissement + soumission

- [ ] `console.*` (126) derrière `__DEV__`.
- [ ] Renommer `package.json` (`"bolt-expo-starter"` → `"petitmo"`).
- [ ] Vérifier que le **build natif EAS passe** avec `expo-face-detector` (déprécié SDK 54).
- [ ] **Tests** sur chemins critiques : limites (`lib/limits.ts`), migration, gating paywall.
- [ ] Profil EAS **production** + bloc **submit**.
- [ ] **QA TestFlight** (checklist ci-dessous) → soumission + notes App Review (compte démo, achats).

---

## Track B — en parallèle (à finaliser avant soumission)

**Légal :**
- [ ] Page **confidentialité** publique → `EXPO_PUBLIC_PRIVACY_POLICY_URL`.
- [ ] **CGU / CGV** (abonnement + livre/PDF).
- [ ] **Suppression de compte/données in-app** (edge `delete-memory-assets` existe → ajouter l'UI).
- [ ] **Privacy labels** + wording **opt-in CRM** RGPD.

**Store & marketing :**
- [ ] **Captures App Store** aux bons formats (skill `petitmo-marketing`).
- [ ] **Fiche App Store** (titre, sous-titre, description, mots-clés).
- [ ] **Landing `petitmo.app`** (email + achat livre).

---

## Checklist QA TestFlight (Phase 7)

- [ ] Sync cloud + migration local→cloud (gros volume, coupure réseau)
- [ ] Restauration sur 2e appareil
- [ ] QR audio (gratuit, livre commandé) + QR vidéo (paid)
- [ ] Média accessible via QR sur appareil tiers + expiration token
- [ ] (si v1) commande imprimée Gelato échantillon
- [ ] Achat mensuel/annuel sandbox + restauration
- [ ] Création de compte Apple/Google/email après paiement
- [ ] Suppression de compte → données effacées
- [ ] Tous les déclencheurs de paywall

---

## Pourquoi cet ordre

1. **Tout le fonctionnel se teste gratuitement** via le levier de tier local + le device-user → inutile de brancher le paiement pour valider le cloud.
2. **Cloud d'abord** : c'est la promesse jamais testée, et tout (QR, livre, restauration) en dépend.
3. **QR + médias** : pipeline livre, indépendant du paiement.
4. **Gelato** : dépendance externe, mais testable sans paiement client ; seul un échantillon coûte un peu — d'où sa place avant le paiement mais après le cœur.
5. **PDF** : déjà mûr, on sécurise.
6. **Paiement en dernier** : quand tout marche, on remplace le levier de test par RevenueCat/IAP (+ web/Stripe pour le livre physique). Le seul moment où des comptes payants deviennent nécessaires.
7. **Légal/store en parallèle** : sans lien avec le code, mais indispensables à la soumission.

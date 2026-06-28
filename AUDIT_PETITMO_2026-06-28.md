# Audit Petitmo — 28 juin 2026

Audit 360° du dépôt `petitmo_local_dev` (branche `next`). Objectif : savoir où en est l'app et ce qu'il reste **avant lancement App Store**.

---

## Verdict en une ligne

L'app est **techniquement très avancée et bien construite**, mais **pas lançable en l'état** : la monétisation n'est pas réellement branchée (le paywall est une maquette qui débloque « payé » gratuitement). C'est le chantier #1, et il commande la majeure partie du travail restant.

## Score de maturité par domaine

| Domaine | Maturité | Commentaire |
|---|---|---|
| Fonctionnel / écrans | 🟢 ~90 % | Tous les écrans clés présents (capture, fil, favoris, livres, paywall, onboarding, book flow…) |
| Architecture & code | 🟢 ~85 % | Local-first propre, bien documenté (AGENTS.md, docs/specs), TODO très peu nombreux |
| Backend & sécurité | 🟢 ~85 % | RLS complète sur 7 tables, service role côté serveur uniquement, .env protégé |
| **Monétisation (IAP)** | 🔴 **~10 %** | **Conçue mais pas implémentée** — bloquant lancement |
| Création de compte (post-paiement) | 🔴 ~15 % | Flux Apple/Google/email à construire |
| Prêt App Store (build/submit) | 🔴 ~20 % | Pas de profil EAS `production`, pas de config `submit` |
| Légal / RGPD | 🟠 ~40 % | RLS + suppression données OK ; manque pages publiques (confidentialité, CGU) + privacy labels |
| Marketing / GTM | 🟠 ~30 % | Personas/copys prêts (skills) ; manque captures App Store, landing, fiche store |

---

## 🔴 Bloquants — à régler avant tout lancement

### 1. Les achats in-app ne sont pas implémentés (le plus important)
- Le paywall (`app/paywall.tsx`, l.205-217) fait un `setTimeout(1200ms)` puis `setUserTier('paid')` **en local** : n'importe qui devient « payé » **gratuitement**.
- Aucune dépendance IAP dans `package.json` : pas de `react-native-purchases` (RevenueCat), pas de StoreKit.
- `lib/userTier.ts` = simple cache AsyncStorage, avec une fonction `resetUserTierForTesting()` marquée « à retirer en prod ».
- Les TODO confirment l'état : *« valider l'achat côté serveur quand l'IAP est branché »* (`lib/digitalExportPurchase.ts`, `types/shared.ts`).

**Conséquences :** aucune recette possible **et** rejet App Store assuré (paywall non fonctionnel / fonctionnalités payantes sans IAP).

**Bonne nouvelle :** toute l'architecture cible est déjà spécifiée noir sur blanc dans `AGENTS.md` (RevenueCat → StoreKit → webhook Edge Function → `auth.users.app_metadata.subscriptionTier`). Il « reste » à l'implémenter, pas à la concevoir.

### 2. Pas de profil de build de production
- `eas.json` ne contient que `preview` (interne/simulateur) et `dev-ios-device`.
- **Manque** : un profil `production` + un bloc `submit` (App Store Connect : Apple ID, ASC App ID, équipe).

### 3. Création de compte cloud (après paiement) à construire
- `app/onboarding.tsx` : *« TODO(plan dédié) : modale login Google / Apple / email pour compte Petitmo+ »*.
- C'est l'étape 5-6 du flux AGENTS.md (compte créé **après** paiement confirmé).
- ⚠️ Si tu proposes Google login, Apple **impose** « Sign in with Apple ». Apple **impose aussi** la suppression de compte in-app dès qu'il y a création de compte.

### 4. Page de confidentialité / CGU non publiées
- `EXPO_PUBLIC_PRIVACY_POLICY_URL` est **absent du `.env`** (le code gère le null proprement, mais l'URL n'existe pas).
- App Store exige une **URL de politique de confidentialité publique** + les **privacy nutrition labels** dans App Store Connect. CGU recommandées (abonnement).

---

## 🟠 Risques techniques à lever avant le build

- **`expo-face-detector`** : package déprécié, hors set supporté par Expo SDK 54. Le code se protège bien (`requireOptionalNativeModule('ExpoFaceDetector')`, pas d'import direct → pas de crash Expo Go), mais **vérifie que le build natif EAS passe**. À terme : retirer ou remplacer (ML Kit / vision-camera).
- **`expo-av` déprécié en SDK 54** (utilisé dans ~7 fichiers). Fonctionne encore, mais voué à disparaître au profit de `expo-audio` + `expo-video`. Pour une app centrée sur le vocal, à planifier comme dette.
- **126 `console.log/warn/error`** en code applicatif : à passer derrière `__DEV__` avant release (bruit + fuite d'info potentielle).
- **Tests automatisés fins** : 4 fichiers de test pour ~250 fichiers source. Couvrir au minimum les chemins critiques (application des limites, migration local→cloud, gating paywall, parité aperçu livre↔PDF) — d'autant que tu vas toucher paywall/auth pour l'IAP.
- **`package.json` `name: "bolt-expo-starter"`** : reliquat du template, à renommer (cosmétique).
- **device-user : mot de passe = `deviceId`** (`app/_layout.tsx`, edge `create-device-user`). Risque faible (lignes limitées aux exceptions export/QR, RLS scoping), mais un secret plus fort serait préférable.

---

## 🟢 Ce qui est déjà solide (à ne pas casser)

- **Sécurité Supabase** : RLS activée sur les 7 tables utilisateur, **17 policies** toutes « own data », **zéro** policy permissive `using(true)`. La clé `service_role` n'est utilisée que côté serveur (edge functions + serveur Railway). `.env` bien gitignoré ; seules des variables `EXPO_PUBLIC_*` (sans secret) sont exposées au client.
- **Architecture local-first** : SQLite source de vérité, exceptions cloud cadrées (achat livre/PDF, QR audio), tout documenté dans `AGENTS.md` + `docs/specs/architecture-locale-cloud.md`.
- **Pipeline livre/PDF** : serveur Node dédié (Playwright/Chromium) déployé sur Railway, parité aperçu↔PDF formalisée, QR codes vocaux. C'est le plus dur, et c'est fait.
- **Permissions iOS** : descriptions présentes et en français (caméra, micro, photos), `ITSAppUsesNonExemptEncryption=false` déjà posé.
- **Hygiène de code** : seulement 8 TODO/FIXME sur tout le dépôt.

---

## Légal / RGPD — checklist

- [ ] Publier **Politique de confidentialité** (URL publique) + renseigner `EXPO_PUBLIC_PRIVACY_POLICY_URL`.
- [ ] Publier **CGU / CGV** (abonnement + livre imprimé/PDF).
- [ ] Remplir les **privacy labels** App Store Connect (caméra, micro, photos, email CRM…).
- [ ] **Suppression de compte/données in-app** (obligation Apple dès qu'il y a compte ; tu as déjà l'edge `delete-memory-assets` — l'exposer côté UI).
- [ ] **Consentement CRM** RGPD explicite (tu as `crm-marketing-opt-in`) : vérifier le wording opt-in.

---

## Marketing / Go-To-Market

- [ ] **Captures App Store** aux formats requis (les assets actuels sont des mockups, pas des screenshots store). Le skill `petitmo-marketing` a déjà la structure des écrans store.
- [ ] **Fiche App Store** : titre, sous-titre, description, mots-clés (dispo dans `petitmo-marketing`).
- [ ] **Landing `petitmo.app`** : capture email + achat livre par la « grand-mère offreuse ».
- [ ] Préparer le **lancement organique** (Instagram reels / TikTok / groupes Facebook mamans) et le petit budget Meta.

---

## Plan d'action priorisé

### Aujourd'hui — débloquer la monétisation (chemin critique)
C'est le plus long pôle ; tout le reste en dépend. Ordre conseillé :
1. Créer le compte **RevenueCat** + créer les produits dans **App Store Connect** : `petitmo_plus_monthly` (5,99 €), `petitmo_plus_yearly` (49,99 €), et le **PDF one-time** (4,99 €).
2. `npx expo install react-native-purchases react-native-purchases-ui`.
3. **Initialiser RevenueCat au 1er lancement** pour toutes (même gratuites), en silence — cf. AGENTS.md §« Initialisation RevenueCat ».
4. Brancher `handlePurchase` du paywall sur un **vrai** `Purchases.purchasePackage()` (remplacer le `setTimeout` + `setUserTier`).

### Cette semaine
5. **Webhook RevenueCat → Edge Function Supabase** qui écrit `app_metadata.subscriptionTier` ; l'app lit ce statut (AsyncStorage = simple cache).
6. **Flux compte post-paiement** : Sign in with Apple (obligatoire) + Google + email, puis `Purchases.logIn(user.id)`.
7. **Suppression de compte in-app** + brancher `EXPO_PUBLIC_PRIVACY_POLICY_URL` (page en ligne).
8. Profil **EAS `production`** + bloc **`submit`** ; premier build TestFlight.

### Avant soumission
9. Pages **confidentialité + CGU** en ligne ; **privacy labels** remplis.
10. **Captures + fiche** App Store.
11. Nettoyage : `console.*` derrière `__DEV__`, renommer le package, retirer `resetUserTierForTesting`, vérifier build natif `expo-face-detector`.
12. **QA TestFlight** : tester achat réel (sandbox), restauration d'achat, migration local→cloud, parité livre↔PDF, perte réseau.

---

## Estimation réaliste

Pour un dev solo, du « presque fini » fonctionnel à une **soumission App Store sereine** : compter **~2 à 4 semaines** de travail concentré, le gros étant l'IAP de bout en bout (achat + webhook + compte + suppression) et la QA TestFlight.

---

### Annexe — preuves (fichier:ligne)
- Paywall maquette : `app/paywall.tsx:205-217`
- Tier local only : `lib/userTier.ts`
- Pas d'IAP : `package.json` (aucun `react-native-purchases`)
- RLS : `supabase/migrations/*` (7 tables, 17 policies, 0 `using(true)`)
- Design IAP cible : `AGENTS.md` §Paiements
- EAS sans production/submit : `eas.json`
- Privacy URL absente : `.env` (pas de `PRIVACY`)
- Face detector gardé : `utils/detectFace.ts:45-49`

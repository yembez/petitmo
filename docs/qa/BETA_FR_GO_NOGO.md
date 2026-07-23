# Go / No-go — Bêta FR V1 (test réel)

> **Décision produit (2026-07)** : prioriser la **sortie bêta FR en prod réelle**.  
> Migration UI anglaise **gelée** jusqu’après retours bêta — voir [`i18n-en-roadmap.md`](../specs/i18n-en-roadmap.md) (backlog uniquement).  
>
> **Règle d’or V2 (2026-07-22)** — voir [`AGENTS.md`](../../AGENTS.md) :  
> **compte gratuit obligatoire** + sync cloud limitée (local-first) ;  
> Petitmo+ = quotas / HD cloud / remise print **−10 %** ;  
> promesse *« privés et sauvegardés »* (pas de partage familial).  
> *Code runtime pas encore aligné — chantiers P0 ci-dessous.*

**Objectif** : 5–15 mamans FR peuvent installer l’app (TestFlight), **créer un compte**, capturer des souvenirs **sauvegardés**, souscrire ou rester gratuit dans les quotas, commander un livre imprimé (−10 % si Petitmo+), et recevoir un livre dont les QR audio/vidéo fonctionnent.

---

## Verdict rapide

| Statut | Signification |
|--------|----------------|
| **NO-GO** | Au moins une case **P0** non cochée |
| **GO bêta interne** (toi + 2–3 proches) | Tous les **P0** sauf éventuellement paiement IAP print (accepter commande « gratuite QA » documentée) |
| **GO bêta ouverte** (5–15 mamans) | **Tous les P0** dont **paiement print** ou politique claire « bêta offerte / pas de carte » |

---

## Semaine 1 — Est-ce que ça marche vraiment ?

### P0.1 Infra (1 demi-journée)

> **Check auto 2026-07-21** (agent) — résultats ci-dessous.

- [x] Railway PDF : `curl …/health` → `ok: true` (`petitmo-production.up.railway.app`)
- [x] Supabase Edge déployées : `init-export` (ACTIVE, maj 2026-07-20 — tarif V1 `priceCents=3900` pour 30p/0 QR), `guest-upload-urls` (ACTIVE)
- [x] `EXPORT_PDF_JWT_SECRET` aligné Edge ↔ Railway (ticket `init-export` accepté par `generate-pdf` → 400 métier pages, **pas** 401)
- [x] App / EAS : `EXPO_PUBLIC_PDF_SERVER_URL` + `PUBLIC_MEDIA_BASE_URL` = prod Railway ; `.env` local + `eas.json` preview/dev-ios alignés ; Supabase URL = `gswtsnhmwjwhwjdiijbs`
- [x] Scripts QA : `scripts/qa/.env.qa` rempli (clés requises OK ; `SUPABASE_SERVICE_ROLE_KEY` optionnel **absent** — utile pour `check-gelato-export` / debug tokens)

**Reste optionnel P0.1** : ajouter `SUPABASE_SERVICE_ROLE_KEY` dans `.env.qa` si tu veux inspecter `export_requests` / tokens depuis les scripts.

### P0.2 Smoke automatisés (1 demi-journée)

Réf. détaillée : [`RELEASE_SMOKE_CHECKLIST.md`](./RELEASE_SMOKE_CHECKLIST.md).

> **Check auto 2026-07-21** — scripts mis à jour pour tarif V1 (`gelato_pages` ≥ 30).

- [x] `./scripts/qa/smoke-print.sh` — OK (ticket V1 `priceCents=3510` paid −10 %, PDF print 33 pages, ~41 Ko)
- [x] `./scripts/qa/smoke-gelato-draft.sh` — OK PDF + pages Gelato ; **à confirmer manuellement** dans dashboard Gelato / SQL `printer_order_id` (`exportRequestId=0a4cf8e0-bd71-47df-aa61-47c140700c88`) — pas de `SUPABASE_SERVICE_ROLE_KEY` dans `.env.qa`
- [x] `./scripts/qa/smoke-qr-audio.sh` — OK (token ready, URL `/m/…` joue)

**Action manuelle restante** : ouvrir le dashboard Gelato (draft) pour l’export ci-dessus, ou ajouter le service role dans `.env.qa` puis `./check-gelato-export.sh 0a4cf8e0-bd71-47df-aa61-47c140700c88`.

### P0.3 Parcours app (toi, 1 journée)

Guide TestFlight : [`TESTFLIGHT.md`](./TESTFLIGHT.md).  
Correctifs JS rapides (OTA) : après **un** rebuild OTA-ready (`npm run tf:ios`), puis `npm run ota:production -- --message "…"`.  
Bugs bêta (Sentry + signalement) : [`OBSERVABILITY_BETA.md`](./OBSERVABILITY_BETA.md).

### À finir avant bêta ouverte (mis de côté 2026-07-21)

- [ ] **Sentry** : créer projet + `EXPO_PUBLIC_SENTRY_DSN` sur EAS (production + development)
- [ ] **Rebuild** natif après DSN (`tf:ios` et/ou `dev:ios:build`) — le code signalement est déjà dans l’app
- [ ] Test : Espace parent → « Signaler un problème » → mail reçu + event Sentry

Sur **build TestFlight** (profil EAS `production` — pas le dev client) :

| # | Parcours | OK ? |
|---|----------|------|
| 1 | Install frais → onboarding → profil enfant → **création compte** | [ ] |
| 2 | Capturer texte + photo + audio (+ 1 vidéo si possible) ; **sync / reinstall restore** smoke | [ ] |
| 3 | Favoris → créer / ouvrir livre → ≥ 30 pages Gelato | [ ] |
| 4 | Livre avec **≥ 1 audio** et idéalement **1 vidéo** | [ ] |
| 5 | Commander impression → PDF généré → Gelato (`printer_order_id` ou draft OK) | [ ] |
| 6 | `book-finalize-media` si proposé → finir upload A/V | [ ] |
| 7 | Scanner QR PDF (4G) → lecture OK | [ ] |
| 8 | Quota gratuit : 50ᵉ souvenir OK, 51ᵉ → paywall `LIMIT_REACHED` | [ ] |
| 9 | Aucun CTA « Livre PDF payant » (hors V1) | [ ] |

### P0.4 Gelato & commande

- [ ] Variables Railway `GELATO_*` présentes (`API_KEY`, `PRODUCT_UID`, shipment, phone…)
- [ ] **Bêta interne** : `GELATO_ORDER_TYPE=draft` accepté (pas d’impression auto)
- [ ] **Bêta ouverte / vrai colis** : bascule `GELATO_ORDER_TYPE=order` + **1 livre physique** reçu + QR OK
- [ ] Pays livrables communiqués : **FR** (évent. BE / CH / LU) — pas « monde entier »
- [ ] Tarif V1 affiché cohérent (39 € / 30 pages, QR 2 inclus + 0,70 €) — Edge recalcule

### P0.5 Compte + sync + Petitmo+ (bloque GO ouverte — orientation V2)

Décision produit (2026-07-22) : la bêta doit exercer le **modèle compte + cloud**, pas le local-only anonyme.

État code actuel (à revalider) :

- Onboarding « J’ai déjà un compte » : **placeholder**
- Paywall : **flux démo / IAP pas branché** (`app/paywall.tsx`)
- Sync cloud : surtout chemin **paid** / upgrade simulé
- Remise print code : **−10 %** paid (`lib/pricingV1.ts`) — **figé**, pas 15 %
- Commande livre : souvent **sans encaissement** en QA

Avant **bêta ouverte** :

- [ ] Auth : Google / Apple / email+mdp + mot de passe oublié ; soft gate dès « Commencer » (compte → enfant)
- [ ] Sync cloud dès le gratuit (quotas 50 / 5×20s vidéo / audio 60 s — retirer cap 5 audios dans `limits.ts`)
- [ ] Photos : thumb + print A5 cloud ; HD local jusqu’à +
- [ ] RevenueCat + IAP abo + webhook `subscriptionTier=paid`
- [ ] Login « J’ai déjà un compte » + restore appareil
- [ ] Suppression de compte in-app (exigence Apple)
- [ ] Décision print : **A)** IAP / achat print branché, **ou** **B)** bêta « livres offerts » écrite aux testeurs
- [ ] Si B print : message in-app ou email (« pas de débit ») — **l’abo reste P0** même si le print est offert

**Petitmo+ n’est plus optionnel** pour une bêta qui annonce le modèle cible : pas de « abo démo OK ».

---

## Semaine 2 — Est-ce que ça survit hors de la maison ?

### P1 Avant d’inviter 5–15 mamans

- [ ] Privacy policy URL prod joignable depuis l’app
- [ ] Compte démo App Review si soumission store (sinon TestFlight externe suffit)
- [ ] Canal feedback (WhatsApp / Typeform / email)
- [ ] Suivi technique : Dashboard Supabase `export_requests` (`status`, `last_error`, `printer_order_id`)
- [ ] Retirer / confirmer inactif : `resetUserTierForTesting` et autres flags TEMP dans `_layout`
- [ ] Build **Release** TestFlight (pas debug) ; version / build number notés

### P1 Panel bêta

- [ ] 5–15 profils (idéalement iPhone récents + 1–2 anciens)
- [ ] Brief 5 lignes : compte gratuit + sauvegarde cloud limitée, Petitmo+ (−10 % livre / quotas), livraison FR, durée test, zéro pub
- [ ] Demander : 1 livre commandé **ou** parcours jusqu’à checkout + capture d’écran tarif

### P1 Critères succès semaine 2

- [ ] ≥ 80 % des testeurs finissent onboarding + 3 souvenirs sans crash
- [ ] ≥ 1 commande print réussie bout-en-bout (Gelato + QR) hors ton téléphone
- [ ] Aucun P0 infra récurrent (JWT, 502, Gelato skip systématique)
- [ ] Bugs bloquants listés et corrigés ou documentés « known »

---

## Explicitement **hors** sprint bêta FR

| Sujet | Statut |
|-------|--------|
| Migration UI EN (phases 1–9) | **Gelé** |
| Liste 250 pays / picker searchable | Plus tard |
| Export PDF numérique monétisé | Hors V1 |
| Partage familial / multi-membres | Hors V1 (positionnement) |
| i18n fondation (`lib/i18n`) | **Garder** ; ne pas élargir |

> Auth + sync gratuit + RevenueCat abo = **dans** le sprint (P0.5), pas hors scope.

---

## Checklist « GO » (cocher avant invite large)

```text
[ ] Health Railway OK
[ ] Edge init-export V1 déployé
[ ] Smoke print + QR audio OK
[ ] TestFlight install frais OK (parcours 1–9)
[ ] Gelato draft OK (interne) OU order + 1 colis OK (ouverte)
[ ] Auth + sync gratuit + restore OK
[ ] RevenueCat / IAP abo + subscriptionTier serveur OK
[ ] Remise print −10 % paid affichée cohérente
[ ] Suppression de compte in-app OK
[ ] Paiement print : branché OU bêta offerte documentée
[ ] Privacy URL OK
[ ] Canal feedback OK
[ ] Aucun TEMP / reset tier actif en build bêta
```

**Si une case manque → NO-GO ouverte.**  
**GO interne** possible avec Gelato draft + paiement offert / non encaissé, **à condition** que les testeurs le sachent.

---

## Plan 10 jours (calendrier type)

| Jour | Focus |
|------|--------|
| J1 | P0.1 infra + secrets |
| J2 | Smoke scripts print + QR + Gelato draft |
| J3–4 | Parcours app TestFlight (toi) + bugs P0 |
| J5 | Décision paiement A/B + message bêta |
| J6 | Build bêta + privacy + brief |
| J7–10 | Panel 5–15 + suivi `export_requests` + hotfixes |

---

## Après la bêta (pas avant)

1. Correctifs issus des retours.  
2. `GELATO_ORDER_TYPE=order` + paiement print réel si pas déjà fait.  
3. **Puis seulement** : reprendre [`i18n-en-roadmap.md`](../specs/i18n-en-roadmap.md) phase 1 si international.

---

## Liens utiles

- Smoke détaillé : [`RELEASE_SMOKE_CHECKLIST.md`](./RELEASE_SMOKE_CHECKLIST.md)  
- Serveur PDF / Gelato : [`server/PROD_CHECKLIST.md`](../../server/PROD_CHECKLIST.md)  
- Tarif V1 : [`../specs/pricing-v1-migration.md`](../specs/pricing-v1-migration.md)  
- QR gratuit : [`../specs/free-tier-book-qr-av.md`](../specs/free-tier-book-qr-av.md)

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

> **Check auto 2026-09-24** — `content_verified_at` + `cgv_version` + `print-payment` bypass ajoutés aux scripts.

- [x] `./scripts/qa/smoke-print.sh` — OK (ticket V1 `priceCents=3510` paid −10 %, PDF print, bypass paiement bêta)
- [x] `./scripts/qa/smoke-gelato-draft.sh` — OK PDF + `printer_order_id` + `sent_to_printer`
- [x] `./scripts/qa/smoke-qr-audio.sh` — OK (token ready, URL `/m/…` joue)

**Action manuelle restante** : ouvrir le dashboard Gelato (draft) pour l’export ci-dessus, ou ajouter le service role dans `.env.qa` puis `./check-gelato-export.sh 0a4cf8e0-bd71-47df-aa61-47c140700c88`.

### P0.3 Parcours app (toi, 1 journée)

Guide TestFlight : [`TESTFLIGHT.md`](./TESTFLIGHT.md).  
Correctifs JS rapides (OTA) : après **un** rebuild OTA-ready (`npm run tf:ios`), puis `npm run ota:production -- --message "…"`.  
Bugs bêta (Sentry + signalement) : [`OBSERVABILITY_BETA.md`](./OBSERVABILITY_BETA.md).  
**Smoke fondateur (parcours app)** : [`BETA_TF_SMOKE_CHECKLIST.md`](./BETA_TF_SMOKE_CHECKLIST.md).  
**Brief proches** : [`BETA_INTERNAL_BRIEF.md`](./BETA_INTERNAL_BRIEF.md).  
**IAP** : [`IAP_PETITMO_PLUS_READINESS.md`](./IAP_PETITMO_PLUS_READINESS.md).  
**GO ouverte** : [`BETA_OPEN_PREP.md`](./BETA_OPEN_PREP.md).

### À finir avant bêta ouverte (observabilité — mis à jour 2026-09-24)

- [x] **Sentry EAS** : `EXPO_PUBLIC_SENTRY_DSN` + `SENTRY_ORG` / `PROJECT` / `AUTH_TOKEN` (production)
- [x] **Code** : anneau diagnostic + Signaler → `user_report` + parcours ; Edge `sentry-issue-notify` (HITL draft à toi)
- [x] **Migration** `bug_outreach_drafts` appliquée (table presente 2026-09-24)
- [x] **Edge** `sentry-issue-notify` redéployée + `SENTRY_WEBHOOK_SECRET` + smoke HITL `{emailed:true}`
- [ ] **Sentry Alert UI** : brancher webhook New issue → Edge — **avant GO ouverte** ; pas bloquant GO interne tant que Signaler TF OK. Prefer **Internal Integration** (pas le plugin WebHooks legacy / « Send Test Event » souvent cassé). Secret path ou header — voir [`OBSERVABILITY_BETA.md`](./OBSERVABILITY_BETA.md)
- [ ] **Smoke TF** : Espace parent → « Signaler un problème » → mail + event Sentry — checklist [`BETA_TF_SMOKE_CHECKLIST.md`](./BETA_TF_SMOKE_CHECKLIST.md)

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

- [x] Variables Railway `GELATO_*` présentes — smoke draft 2026-09-24 → `printer_order_id` OK
- [x] **Bêta interne** : Gelato draft OK (`sent_to_printer`, order `67ff89e6-…`) + `STRIPE_PRINT_BYPASS=1`
- [ ] **Bêta ouverte / vrai colis** : bascule `GELATO_ORDER_TYPE=order` + **1 livre physique** reçu + QR OK
- [x] Pays livrables communiqués : **FR** (brief interne)
- [x] Tarif V1 affiché cohérent (39 € / 30 pages → `priceCents=3510` paid −10 %) — Edge recalcule

### P0.5 Compte + sync + Petitmo+ (bloque GO ouverte — orientation V2)

Décision produit (2026-07-22) : la bêta doit exercer le **modèle compte + cloud**, pas le local-only anonyme.

**État code (2026-09)** — à smoke-tester sur TestFlight :

- [x] Auth Google / Apple / email+mdp + soft gate (compte → enfant) — `app/auth.tsx`, `app/onboarding.tsx`
- [x] Login « J’ai déjà un compte » → `/auth?mode=login` (plus un placeholder)
- [x] Mot de passe oublié bout-en-bout (e-mail + deep link `petitmo://auth` + UI nouveau MDP) — **smoke manuel + Redirect URL Supabase**
- [x] Sync cloud dès le gratuit (local-first) — `activateCloudSyncAfterRealAuth`
- [x] Quotas : 50 souvenirs / 5×20 s vidéo / audio **60 s** (plus de cap **nombre** d’audios)
- [x] Photos : thumb + print A5 cloud ; HD si `paid` — `services/media.ts`
- [x] Remise print **−10 %** paid (`lib/pricingV1.ts`) — figé, pas 15 %
- [x] Suppression de compte in-app (UI + Edge `delete-account` + purge Storage) — **Edge redéployée 2026-09-23** ; **smoke manuel TF encore ouvert**
- [x] Edge `revenuecat-webhook` + lifecycle (`touch-activity`, `inactivity-sweep`) — **redéployées 2026-09-23** ; IAP store + secrets EAS encore ouverts
- [ ] RevenueCat + IAP abo + webhook `subscriptionTier=paid` — **code + Edge prêts** ; checklist [`IAP_PETITMO_PLUS_READINESS.md`](./IAP_PETITMO_PLUS_READINESS.md)
- [ ] Smoke TF : restore même e-mail + parcours 1–9 — [`BETA_TF_SMOKE_CHECKLIST.md`](./BETA_TF_SMOKE_CHECKLIST.md)
- [x] Décision print **B** : bêta interne « livres offerts » (`STRIPE_PRINT_BYPASS=1`) — [`BETA_INTERNAL_BRIEF.md`](./BETA_INTERNAL_BRIEF.md)
- [x] Message testeurs print offert (brief) — **l’abo reste P0 pour GO ouverte**

**Petitmo+ n’est plus optionnel** pour une bêta qui annonce le modèle cible : pas de « abo démo OK » une fois la conformité Apple validée.

---

## Semaine 2 — Est-ce que ça survit hors de la maison ?

### P1 Avant d’inviter 5–15 mamans

- [ ] Privacy policy URL prod joignable depuis l’app
- [ ] Compte démo App Review si soumission store (sinon TestFlight externe suffit)
- [ ] Canal feedback (WhatsApp / Typeform / email)
- [ ] Suivi technique : Dashboard Supabase `export_requests` (`status`, `last_error`, `printer_order_id`)
- [ ] Retirer / confirmer inactif : `resetUserTierForTesting` et autres flags TEMP dans `_layout`
- [ ] Build **Release** TestFlight (pas debug) ; version / build number notés

### Backlog post-bêta (spec écrite, pas code)

Lifecycle abo / inactivité / mails Resend : [`docs/specs/subscription-lifecycle-retention.md`](../specs/subscription-lifecycle-retention.md)  
(grâce 2 mois → free + archive >50 ; inactivité 24 mois J−90/30/7 ; delete volontaire vs QR conservés).

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
[x] Health Railway OK (2026-09-24)
[x] Edge init-export V1 déployé
[x] Smoke print + QR audio OK (scripts QA 2026-09-24)
[ ] TestFlight install frais OK (parcours 1–9) — checklist TF
[x] Gelato draft OK (interne) — printer_order_id présent
[x] Auth + sync gratuit (code) — smoke restore TF encore ouvert
[ ] RevenueCat / IAP abo + subscriptionTier serveur OK (attente conformité Apple + offerings RC)
[x] Remise print −10 % paid affichée cohérente (code + smoke priceCents=3510)
[x] Suppression de compte in-app (code + purge Storage + Edge déployée 2026-09-23) — smoke TF ouvert
[x] Cap nombre audios retiré (durée 60 s conservée)
[x] Mot de passe oublié bout-en-bout (code) — smoke + Redirect URL Supabase
[x] Paiement print : bêta offerte documentée (STRIPE_PRINT_BYPASS + brief)
[x] Privacy URL joignable (https://petitcoeur.app/#/privacy → 200)
[x] Canal feedback OK (Signaler + support@)
[x] Aucun TEMP / reset tier actif (`resetUserTierForTesting` commenté)
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

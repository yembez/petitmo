# Exécution smoke TF — bêta FR (fondateur)

Cocher au fur et à mesure sur **TestFlight build 24** (ou plus récent).  
Infra / scripts déjà verts côté agent : voir `[BETA_FR_GO_NOGO.md](./BETA_FR_GO_NOGO.md)`.

**Règle** : un bug P0 du parcours en cours seulement. Pas de polish UI.

---

## Phase 0 — Observabilité (suite TF)

Infra déjà OK (migration, Edge, HITL mail agent 2026-09-24).

- [x] **Sentry Alert** : webhook `…/functions/v1/sentry-issue-notify` + header `X-Sentry-Webhook-Secret` (secret = celui posé sur Supabase `SENTRY_WEBHOOK_SECRET` — le récupérer via `supabase secrets` / rotation récente ; ne pas committer). Trigger = **New issue**.
- [x] TF → Espace parent → **Signaler un problème** → mail reçu + `Sentry event:` dans le bloc tech + issue `user_report` dans Sentry.



## Phase 2 — Auth

- [x] Install frais → onboarding → création compte (Google **ou** Apple **ou** email)
- [x] Profil enfant → entrée fil
- [x] Déconnexion → « J’ai déjà un compte » → login OK
- [x] Mot de passe oublié (si email) → mail + deep link `petitmo://auth` → nouveau MDP



## Phase 3 — Capture + sync + restore

- [x] Texte + photo + audio (+ 1 vidéo)
- [x] Sync silencieuse (pas de flash fil / Capturer)
- [x] Restore : supprimer l’app **ou** second device → même e-mail → souvenirs revenus



## Phase 4 — Livre + QR (app)

Scripts QA déjà OK (print PDF, QR audio, Gelato draft `printer_order_id`). Sur TF :

- [x] Favoris → livre ≥ 30 pages + ≥ 1 audio
- [x] Commander impression jusqu’à confirmation (**pas de débit** — bypass bêta)
- [x] Scanner QR PDF en 4G → lecture OK
- [ ] **Print fond post-pay** : après bypass, confirmation en quelques secondes (pas d’attente « garde l’app ouverte »)
- [ ] Kill app juste après confirmation → `export_requests` passe `rendering` → `sent_to_printer` (Railway + Gelato draft) sans rouvrir l’app
- [ ] Prérequis deploy : migration `pdf_payload_json`, Railway (stash + `/v1/internal/print-fulfill`), Edge `stripe-webhook` + `print-payment`



## Phase 5 — Quota

- [ ] Approcher 50 souvenirs (ou compte QA dédié) : 50ᵉ OK, 51ᵉ → paywall `LIMIT_REACHED`



## Phase 6 — Delete compte

- [ ] Espace parent → supprimer le compte → confirm
- [ ] Relog impossible / workspace vide
- [ ] (Option) vérifier purge Storage côté dashboard



## Phase 8 — GO interne

- [ ] Privacy `https://petitcoeur.app/#/privacy` ouverte depuis l’app
- [ ] Envoyer `[BETA_INTERNAL_BRIEF.md](./BETA_INTERNAL_BRIEF.md)` à 2–3 proches
- [ ] Noter retours / bugs P0



## Phase 9 — IAP (après GO interne)

- [ ] Apple Agreements / Paid Apps
- [ ] Offerings RevenueCat + produits StoreKit
- [ ] Achat sandbox → `app_metadata.subscriptionTier=paid`
- [ ] Remise −10 % print visible

---



## Preuves agent (2026-09-24)


| Check                      | Résultat                               |
| -------------------------- | -------------------------------------- |
| Railway `/health`          | `ok: true`                             |
| `bug_outreach_drafts`      | table présente                         |
| Edge `sentry-issue-notify` | deploy + smoke `{emailed:true}`        |
| `smoke-qr-audio.sh`        | OK                                     |
| `smoke-print.sh`           | OK (priceCents 3510 paid −10 %)        |
| `smoke-gelato-draft.sh`    | `sent_to_printer` + `printer_order_id` |
| `STRIPE_PRINT_BYPASS`      | `1` (bêta interne)                     |
| TF build                   | `1.0.0 (24)` production                |
| `resetUserTierForTesting`  | commenté dans `_layout`                |



# Observabilité bêta FR — identifier un bug sans embêter la maman

Objectif : quand une maman signale « ça marche pas » (ou qu’un crash arrive sans signalement), tu sais **qui**, **quelle version**, **le parcours récent**, et tu reçois éventuellement un **draft de réponse** à valider — jamais d’e-mail auto à l’utilisatrice.

Règle d’or V2 + local-first : instrumentation **silencieuse** (pas de spinner / flash UI). Pas de PII dans Sentry (pas d’e-mail, pas de contenu souvenir).

---

## Ce qui est en place dans l’app

1. **Sentry** (crashs JS + natifs) — actif si `EXPO_PUBLIC_SENTRY_DSN` au **build**.
2. **Anneau diagnostic** ([`lib/diagnosticTrail.ts`](../../lib/diagnosticTrail.ts)) — ~40 events : nav, actions, erreurs (codes courts type `capture.photo.ok`, `sync.flush`).
3. **Espace parent → « Signaler un problème »** — mail support + bloc technique + **parcours récent** + event Sentry `user_report` (id collé dans le mail).
4. **Identité Sentry** : `user.id` (UUID compte) seulement — via `setPetitmoSentryUser`.
5. **Hotspots** : capture photo/vidéo/voix/texte/album, flush sync, auth login/logout/delete, paywall.
6. **Version** en bas de l’Espace parent : `1.0.0 (N) · ota …`

## Détection interne (HITL)

Edge [`sentry-issue-notify`](../../supabase/functions/sentry-issue-notify/index.ts) :

- Webhook Sentry (nouvelle issue / event) → **mail à toi** (`support@petitcoeur.app`).
- Contient : résumé bug, tags build/tier, lien Sentry, e-mail utilisatrice si résolu via `user.id`, **draft de réponse** prêt à copier.
- **Rien n’est envoyé à la maman** — tu valides, modifies ou ignores.
- Dédup SQL [`bug_outreach_drafts`](../../supabase/migrations/20260924120000_bug_outreach_drafts.sql) : max 1 mail / issue / user / 24 h.
- Ignore les events `app.source=user_report` (déjà couverts par `support-contact`).

---

## Activer Sentry (EAS) — état 2026-09

Sur EAS **production** (déjà posé) :

- [x] `EXPO_PUBLIC_SENTRY_DSN`
- [x] `SENTRY_ORG=petitmo`
- [x] `SENTRY_PROJECT=react-native`
- [x] `SENTRY_AUTH_TOKEN`

Rebuild natif requis si un build TF antérieur n’avait pas le DSN. Les builds `tf:ios` (preview) chargent souvent les env production : vérifier smoke Signaler → Issues.

### Local (optionnel)

```bash
EXPO_PUBLIC_SENTRY_DSN=https://…@….ingest.sentry.io/…
SENTRY_ORG=petitmo
SENTRY_PROJECT=react-native
```

---

## Brancher le webhook fondateur (une fois)

1. Appliquer la migration `20260924120000_bug_outreach_drafts.sql` en prod.
2. Déployer l’Edge :
   ```bash
   supabase functions deploy sentry-issue-notify --no-verify-jwt
   ```
3. Secret Supabase Edge :
   ```bash
   supabase secrets set SENTRY_WEBHOOK_SECRET='…long-random…'
   # RESEND_API_KEY / SUPPORT_TO_EMAIL déjà utilisés par support-contact
   ```
4. Dans Sentry → **Alerts** (ou Internal Integration) → webhook  
   URL :
   ```
   https://<project>.supabase.co/functions/v1/sentry-issue-notify
   ```
   Header : `X-Sentry-Webhook-Secret: <même secret>`  
   (ou `?secret=` en query pour un test rapide)
5. Déclencher sur **New issue** (pas chaque event).

### Smoke

1. TestFlight → Espace parent → **Signaler un problème** → mail + event `user_report` + `Sentry event: …` dans le bloc tech.
2. Forcer une erreur instrumentée (ex. fail sync) → Issue Sentry avec breadcrumbs nav/actions + `user.id`.
3. Nouvelle issue → **un** mail à support@ avec draft ; **zéro** mail à la maman.
4. Relancer la même issue < 24 h → skip `dedup_24h`.

---

## Lire un crash / signalement

| Source | Où regarder |
|--------|-------------|
| Crash natif | Issues → `release:petitmo@…` + tag `app.build` |
| Erreur JS | Stack + breadcrumbs `navigation` / `action` / `error` |
| Signalement manuel | tag `app.source=user_report` + mail support (parcours) |
| Détection auto | mail fondateur + table `bug_outreach_drafts` |

Profil **production** : upload dSYM / source maps si `SENTRY_AUTH_TOKEN` présent.  
Profils **preview** / `tf:ios` : `SENTRY_DISABLE_AUTO_UPLOAD=true` (reporting OK, stacks natives moins propres).

---

## Checklist avant bêta mamans

- [x] DSN + org + project + auth token sur EAS production
- [x] Migration `bug_outreach_drafts` appliquée (2026-09-24)
- [x] Edge `sentry-issue-notify` déployée + secret + smoke HITL mail fondateur (`emailed:true`)
- [ ] Sentry Alert → webhook New issue (header/path secret) — **avant GO ouverte** ; préférer Internal Integration. Legacy WebHooks « Send Test Event » = non fiable.
- [x] Smoke TF : Signaler → event Sentry + parcours dans le mail (2026-09-24, build OTA production)
- [x] Build TestFlight noté : **1.0.0 (24)**

---

## Hors scope (volontairement)

- Envoi auto / one-click à la maman (validation = ta boîte mail)
- PostHog / session replay
- Instrumentation de chaque `console.error` du repo
- Dashboard KPI / Gelato avancé

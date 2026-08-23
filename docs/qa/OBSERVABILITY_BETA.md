# Observabilité bêta FR — identifier un bug en 1 minute

Objectif : quand une maman (ou toi) signale un souci, tu sais **quelle version**, **quel mode**, **quel écran**, et tu retrouves l’event Sentry si dispo.

---

## Ce qui est en place dans l’app

1. **Sentry** (crashs JS + natifs) — actif seulement si `EXPO_PUBLIC_SENTRY_DSN` est défini au **build**.
2. **Espace parent → « Signaler un problème »** — mail prérempli + bloc technique + event Sentry `user_report` (si DSN).
3. **Version** en bas de l’Espace parent : `1.0.0 (17) · ota …`

---

## Activer Sentry (une fois) — checklist

### 1. Projet Sentry

1. [sentry.io](https://sentry.io) → créer un projet **React Native** (ou Expo).
2. Noter :
   - **DSN** (Settings → Client Keys)
   - **Organization slug** (URL : `sentry.io/organizations/<org>/…`)
   - **Project slug** (ex. `petitmo` / `react-native`)

### 2. Variables EAS (production)

```bash
# DSN — embarqué dans le binaire TestFlight (obligatoire)
eas env:create --name EXPO_PUBLIC_SENTRY_DSN \
  --value "https://…@….ingest.sentry.io/…" \
  --environment production \
  --visibility sensitive

# Org + project — upload dSYM / source maps pendant le build
eas env:create --name SENTRY_ORG --value "TON_ORG_SLUG" --environment production --visibility plaintext
eas env:create --name SENTRY_PROJECT --value "TON_PROJECT_SLUG" --environment production --visibility plaintext

# Token auth (Settings → Auth Tokens → Create, scopes: project:releases, org:read)
eas env:create --name SENTRY_AUTH_TOKEN \
  --value "sntrys_…" \
  --environment production \
  --visibility secret
```

Même trio recommandé pour `--environment development` si tu builds des dev clients.

### 3. Local (optionnel)

Dans `.env` (ne pas committer) :

```bash
EXPO_PUBLIC_SENTRY_DSN=https://…@….ingest.sentry.io/…
SENTRY_ORG=…
SENTRY_PROJECT=…
# SENTRY_AUTH_TOKEN=…  # seulement pour builds locaux qui uploadent
```

### 4. Rebuild natif

Le DSN n’arrive **pas** par OTA s’il n’était pas dans le build précédent :

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

### 5. Vérifier

1. TestFlight → build avec Sentry.
2. Espace parent → **Signaler un problème** → dans [Sentry Issues](https://sentry.io) un event `user_report`.
3. Tags utiles : `app.build`, `app.channel`, `app.tier`, `app.userMode`.

Sans DSN : Signaler marche (mail) ; Sentry reste off.

---

## Lire un crash TestFlight dans Sentry

| Source | Où regarder |
|--------|-------------|
| Crash natif (SIGABRT / TurboModule) | Issues → filtre `release:petitmo@1.0.0` + tag `app.build:18` |
| Erreur JS | Même vue, stack Hermes symboliquée si source maps uploadées |
| Signalement manuel | tag `app.source=user_report` |

Si la stack native est illisible (`0x…`) : vérifier que `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` étaient bien présents au build (logs EAS : upload Sentry).

Le profil **production** n’a plus `SENTRY_DISABLE_AUTO_UPLOAD` — l’upload part dès que le token est là. Les profils preview / dev-ios gardent le disable pour ne pas spammer Sentry.

---

## Checklist avant bêta mamans

- [ ] DSN + org + project + auth token sur EAS production  
- [ ] Build TestFlight après ajout du DSN  
- [ ] Test « Signaler un problème » → event visible dans Sentry  
- [ ] Noter le build number TestFlight  

---

## Hors scope (volontairement)

- PostHog / session replay  
- Dashboard KPI automatique  
- Monitoring Stripe (abo = RevenueCat)  
- Alertes Gelato avancées

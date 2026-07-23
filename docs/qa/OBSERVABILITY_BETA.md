# Observabilité bêta FR — identifier un bug en 1 minute

Objectif : quand une maman (ou toi) signale un souci, tu sais **quelle version**, **quel mode**, **quel écran**, et tu retrouves l’event Sentry si dispo.

---

## Ce qui est en place dans l’app

1. **Sentry** (crashs / erreurs JS) — actif seulement si `EXPO_PUBLIC_SENTRY_DSN` est défini.
2. **Espace parent → « Signaler un problème »** — ouvre un mail prérempli + copie le bloc technique + crée un event Sentry `user_report` (si DSN).
3. **Version affichée** en bas de l’Espace parent : `1.0.0 (6) · ota ab12cd34`  
   → build number + id de l’update OTA.

Le bloc mail contient toujours :

- version + build  
- OTA update id + channel  
- modèle iPhone + iOS  
- tier (`free`/`paid`) + mode (`local`/`cloud`)  
- écran courant  
- id event Sentry (si actif)

---

## Activer Sentry (obligatoire pour la bêta ouverte)

1. Crée un compte / projet sur [sentry.io](https://sentry.io) → plateforme **React Native**.
2. Copie le **DSN**.
3. En local (`.env`, ne pas committer) :

```bash
EXPO_PUBLIC_SENTRY_DSN=https://…@….ingest.sentry.io/…
```

4. Sur EAS (production + development) :

```bash
eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "https://…@….ingest.sentry.io/…" --environment production --visibility sensitive
eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "https://…@….ingest.sentry.io/…" --environment development --visibility sensitive
```

5. Pour des **source maps** propres (lire la stack lisible) — plus tard, optionnel pour démarrer :

```bash
eas secret:create --name SENTRY_AUTH_TOKEN --value "…" --type string
```

Et renseigner org/project dans la config plugin Sentry (voir docs Sentry Expo).  
Sans ça, tu as quand même les crashs + messages, parfois moins lisibles.

6. Pousse via **OTA** (si build OTA-ready) ou prochain `tf:ios` / `dev:ios:build`.

Sans DSN : le bouton **Signaler** marche quand même (mail + presse-papiers). Seul Sentry est off.

---

## Comment trier un bug reçu

| Source | Tu regardes | Tu fais |
|--------|-------------|---------|
| Mail « Signaler un problème » | Bloc `Infos techniques` | Note version/build/OTA ; cherche l’event Sentry si id présent |
| Crash silencieux | [Sentry Issues](https://sentry.io) | Filtre `release:petitmo@1.0.0`, tag `app.channel`, `app.tier` |
| « Ça marche pas le livre » sans mail | Demande capture + version en bas d’Espace parent | Compare avec ton build TestFlight |

### Tags Sentry utiles

- `app.tier` — free / paid  
- `app.userMode` — local / cloud  
- `app.channel` — production / development  
- `app.updateId` — id OTA  
- `app.source=user_report` — signalements manuels  

---

## Checklist avant d’ouvrir la bêta aux mamans

- [ ] DSN Sentry sur EAS production  
- [ ] Tu as reçu un **test** : Signaler un problème → mail reçu + event dans Sentry  
- [ ] Version visible en Espace parent sur TestFlight  
- [ ] Tu notes le build number TestFlight dans Notion / go-no-go  

---

## Hors scope (volontairement, pour plus tard)

- PostHog / session replay  
- Dashboard KPI automatique  
- Monitoring Stripe (abo = RevenueCat)  
- Alertes Gelato avancées (garder un suivi manuel des `printer_order_id` pour l’instant)

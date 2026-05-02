# Déploiement du service PDF sur Railway

**Alternative VPS + Docker** (script Hetzner) : voir [**DEPLOY_HETZNER.md**](./DEPLOY_HETZNER.md).  
Vue d’ensemble des options : [**DEPLOY.md**](../DEPLOY.md) à la racine du dépôt.

Ce service correspond au dossier **`server/`** : API Express, génération PDF (Playwright), routes QR et médias publics. Il nécessite **Chromium** : l’image Docker repose sur **`mcr.microsoft.com/playwright`** (voir `Dockerfile`), pas sur un Chromium Debian « à la main ».

## Prérequis

- Compte [Railway](https://railway.app) et accès au dépôt Git (GitHub).
- Projet Supabase avec **URL** et **clé service role** (Settings → API).
- Secret **`EXPORT_PDF_JWT_SECRET`** : identique à celui configuré sur l’Edge Function Supabase **`init-export`** (longueur minimale 32 caractères côté vérif JWT).

## Configuration initiale (une fois)

1. Railway → **New Project** → **Deploy from GitHub** → sélectionner le dépôt Petitmo.
2. Ajouter un service → **Root Directory** : `server` (dossier contenant ce `Dockerfile` et `railway.toml`).
3. Nom suggéré : `petitmo-pdf-service`.
4. **Variables** (Settings → Variables), au minimum :

   | Variable | Remarque |
   |----------|----------|
   | `SUPABASE_URL` | URL du projet |
   | `SUPABASE_SERVICE_ROLE_KEY` | **service_role** (jamais dans l’app mobile) |
   | `EXPORT_PDF_JWT_SECRET` | Aligné sur `init-export` |
   | `TRUST_PROXY` | `1` ou `true` recommandé derrière le proxy Railway |

   **Ne pas** définir `PORT` manuellement : Railway l’injecte.

5. Déployer et attendre la fin du build Docker (plusieurs minutes la première fois).
6. **Domains** → générer un domaine public → noter l’URL (ex. `petitmo-pdf-production.up.railway.app`).

## Vérification

```bash
curl -sS "https://<ton-domaine-railway>/health"
```

Réponse attendue : JSON contenant `"ok":true` et le nom du service.

## Application mobile / front

Mettre à jour l’URL du serveur PDF (ex. `.env` ou secrets EAS) :

```bash
EXPO_PUBLIC_PDF_SERVER_URL=https://<ton-domaine-railway>
```

Puis enchaîner un flux **commande / export PDF** de bout en bout.

## Redéploiements

Les pushes sur la branche connectée au service redéclenchent en général un déploiement automatique (selon les réglages du projet Railway).

## Logs et métriques

- **Logs** : Railway → service → **Logs**.
- **Metrics** : CPU, RAM, réseau (utile lors des pics Playwright).

## Fichiers de référence

- `railway.toml` — build Docker, healthcheck `/health`.
- `.env.example` — liste des variables d’environnement documentées pour ce dépôt `server/`.

## Après migration depuis Hetzner

- Suivre la section « Après migration » du hub [**DEPLOY.md**](../DEPLOY.md).
- Vérifier CORS / pare-feu : l’app appelle le domaine Railway en HTTPS.
- Surveiller la **RAM** : Chromium est gourmand ; augmenter la taille d’instance Railway si des exports volumineux échouent par OOM.

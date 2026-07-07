# Déploiement — service PDF Petitmo

Le **service PDF** (dossier `server/`) est déployé **séparément** de l’app Expo. Côté client, configurer au minimum :

```bash
EXPO_PUBLIC_PDF_SERVER_URL=https://<ton-domaine-pdf>
EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL=https://<ton-domaine-pdf>/m
```

Les QR « souvenirs audio/vidéo » du livre utilisent la base **`/m`** sur le **même** service que l’API PDF (sauf si un domaine public type `petitmo.app` fait le proxy vers ce service).

Variables serveur documentées : [`server/.env.example`](server/.env.example).  
Référence technique du service : [`server/README.md`](server/README.md).

---

## Choisir un hébergement

| Option | Quand l’utiliser | Guide |
|--------|------------------|--------|
| **Railway** | Déploiement Git, healthcheck, peu d’ops sur la machine | PDF : [**server/DEPLOY_RAILWAY.md**](server/DEPLOY_RAILWAY.md) · Médias : [**server/media-worker/DEPLOY_RAILWAY.md**](server/media-worker/DEPLOY_RAILWAY.md) |
| **VPS Hetzner** (ou autre VPS) | Docker maison, script de déploiement existant, forfait serveur fixe | [**server/DEPLOY_HETZNER.md**](server/DEPLOY_HETZNER.md) |

Le **PDF** utilise `server/Dockerfile` (Playwright). Le **media worker** utilise `server/media-worker/Dockerfile` (Node + sharp + ffmpeg). **Production Petitmo+** : deux services Railway + secrets Supabase `MEDIA_WORKER_URL` / `MEDIA_WORKER_SECRET`.

---

## Après migration (ex. Hetzner → Railway)

1. Déployer le nouveau service PDF et vérifier `GET /health`.
2. Déployer le **media worker** (`server/media-worker/`) et vérifier son `GET /health`.
3. Mettre à jour **`EXPO_PUBLIC_PDF_SERVER_URL`** (`.env` local, EAS secrets, etc.).
4. Mettre à jour **Supabase Edge Functions secrets** : `MEDIA_WORKER_URL`, `MEDIA_WORKER_SECRET`.
5. Désactiver l’ancien conteneur / VPS / tunnel ngrok pour éviter confusion.
6. Checklist smoke test : [`server/PROD_CHECKLIST.md`](server/PROD_CHECKLIST.md) (adapter l’URL au fournisseur choisi).

---

## Sécurité (commun)

- Ne jamais committer les clés **`SUPABASE_SERVICE_ROLE_KEY`**, **`EXPORT_PDF_JWT_SECRET`**, ni fichiers `*.env` remplis.
- **`EXPORT_PDF_JWT_SECRET`** doit être **identique** entre l’Edge Function Supabase `init-export` et le serveur PDF.

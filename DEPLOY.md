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
| **Railway** | Déploiement Git, healthcheck, peu d’ops sur la machine | [**server/DEPLOY_RAILWAY.md**](server/DEPLOY_RAILWAY.md) |
| **VPS Hetzner** (ou autre VPS) | Docker maison, script de déploiement existant, forfait serveur fixe | [**server/DEPLOY_HETZNER.md**](server/DEPLOY_HETZNER.md) |

Les deux utilisent le **même** `server/Dockerfile` (image Playwright + Node). Ne pas faire tourner **deux** instances publiques pointées par la même app sans savoir laquelle est canonique.

---

## Après migration (ex. Hetzner → Railway)

1. Déployer le nouveau service et vérifier `GET /health`.
2. Mettre à jour **`EXPO_PUBLIC_PDF_SERVER_URL`** (`.env` local, EAS secrets, etc.).
3. Désactiver l’ancien conteneur / VPS pour éviter confusion et coûts doubles.
4. Checklist smoke test : [`server/PROD_CHECKLIST.md`](server/PROD_CHECKLIST.md) (adapter l’URL au fournisseur choisi).

---

## Sécurité (commun)

- Ne jamais committer les clés **`SUPABASE_SERVICE_ROLE_KEY`**, **`EXPORT_PDF_JWT_SECRET`**, ni fichiers `*.env` remplis.
- **`EXPORT_PDF_JWT_SECRET`** doit être **identique** entre l’Edge Function Supabase `init-export` et le serveur PDF.

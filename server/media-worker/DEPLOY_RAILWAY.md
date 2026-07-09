# Déploiement media worker sur Railway (production)

Le **media worker** (`server/media-worker/`) génère les dérivés cloud des souvenirs (thumb, display, print, poster vidéo, cover audio). Il est **distinct** du service PDF (`server/`).

Sans worker joignable, l’app Petitmo+ tente un repli sur l’appareil — acceptable en secours, **pas** le chemin prod.

---

## Architecture

```
App mobile (Petitmo+)
  → Edge Function Supabase `process-memory`
    → POST https://<media-worker-railway>/process-memory
      (header X-Worker-Secret)
```

Secrets Supabase requis :

| Secret | Valeur |
|--------|--------|
| `MEDIA_WORKER_URL` | `https://<domaine-railway-media-worker>` **sans** slash final |
| `MEDIA_WORKER_SECRET` | Identique à la variable du même nom sur Railway |

Les Edge Functions `process-memory` et `delete-memory-assets` utilisent ces secrets.

---

## 1. Créer le service Railway

1. Railway → projet Petitmo → **New Service** → Deploy from GitHub (même repo que le PDF).
2. **Root Directory** : `server/media-worker` (pas `server/`).
3. Nom suggéré : `petitmo-media-worker`.
4. Railway détecte `railway.toml` + `Dockerfile`.

## 2. Variables d’environnement

| Variable | Obligatoire | Remarque |
|----------|-------------|----------|
| `SUPABASE_URL` | oui | URL projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | **service_role** (jamais dans l’app) |
| `MEDIA_WORKER_SECRET` | oui | ≥ 32 caractères aléatoires |
| `TRUST_PROXY` | recommandé | `1` derrière le proxy Railway |

Générer `MEDIA_WORKER_SECRET` :

```bash
openssl rand -hex 32
```

Copier la **même** valeur dans :

- Railway → service media-worker → Variables
- Supabase → Edge Functions → Secrets → `MEDIA_WORKER_SECRET`

Puis définir `MEDIA_WORKER_URL` côté Supabase (domaine public Railway du worker).

## 3. Déployer

Push sur la branche connectée à Railway, ou **Deploy** manuel.

Vérifier :

```bash
curl -sS https://<domaine-railway-media-worker>/health
```

Réponse attendue : `{"ok":true}` (ou équivalent).

## 4. Tester `process-memory`

Depuis Supabase (ou curl avec secret) :

```bash
curl -sS -X POST "https://<domaine>/process-memory" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: <secret>" \
  -d '{"memoryId":"<uuid>","userId":"<uuid>"}'
```

## 5. Checklist prod

- [ ] Service Railway séparé du PDF (`server/` vs `server/media-worker/`)
- [ ] `MEDIA_WORKER_URL` + `MEDIA_WORKER_SECRET` dans Supabase
- [ ] `/health` OK
- [ ] Test upload Petitmo+ → dérivés visibles (thumb, poster…)
- [ ] **Ne pas** laisser `MEDIA_WORKER_URL` pointer vers ngrok en prod

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| 404 HTML ngrok | `MEDIA_WORKER_URL` = tunnel dev mort |
| 401 / 403 | `MEDIA_WORKER_SECRET` désaligné Supabase ↔ Railway |
| 502 health OK mais process échoue | migration Supabase manquante, clé service role, ou fichier source absent |

Voir aussi `DEPLOY.md` à la racine du dépôt (section media worker).

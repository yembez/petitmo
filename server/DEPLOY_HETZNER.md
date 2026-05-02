# Déploiement Petitmo — PDF serveur (VPS Hetzner)

Guide **Docker sur VPS** (script `scripts/deploy-pdf-server-hetzner.sh`).  
**Alternative managée** : [DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md).

Flux **réel** utilisé sur le VPS : branche **`next`**, dépôt **`/root/petitmo`**, variables **`/root/petitmo-pdf.env`**, conteneur **`petitmo-pdf-server`**, port **`8787`**.

---

## 1. Sur ton Mac (code → GitHub)

```bash
cd /chemin/vers/petitmo   # ou petitmo_local_dev si c’est le même remote

git status
git add -A   # ou fichiers ciblés
git commit -m "Description courte du changement"
git push origin next
```

**Ne pas** lancer `ssh` depuis le serveur vers lui-même. Le `ssh -i ~/.ssh/petitmo_ssh root@178.104.29.182` se fait **uniquement depuis le Mac** pour ouvrir une session sur le VPS.

---

## 2. Première fois sur le VPS (une seule fois)

Connexion depuis le Mac :

```bash
ssh -i ~/.ssh/petitmo_ssh root@178.104.29.182
```

Puis :

```bash
cd /root
git clone https://github.com/yembez/petitmo.git
cd petitmo
git checkout next
```

Vérifie que **`/root/petitmo-pdf.env`** existe et contient au minimum `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPORT_PDF_JWT_SECRET`, `TRUST_PROXY` (comme avant).

Rends le script exécutable (après le premier `git pull` qui contient ce fichier) :

```bash
chmod +x /root/petitmo/scripts/deploy-pdf-server-hetzner.sh
```

---

## 3. À chaque mise à jour du PDF serveur (sur le VPS)

**Tu es déjà en SSH sur le serveur** (`root@ubuntu-4gb-nbg1-1` ou similaire). **Sans** refaire `ssh` :

```bash
/root/petitmo/scripts/deploy-pdf-server-hetzner.sh
```

Le script enchaîne : `git pull origin next` → `docker build` dans `server/` → `docker stop` / `rm` / `run` avec `--env-file /root/petitmo-pdf.env` et `-p 8787:8787` → test `curl /health`.

### Surcharges (optionnel)

Tout est configurable par variables d’environnement si un jour tu changes de chemin :

| Variable | Défaut |
|----------|--------|
| `PETITMO_REPO_ROOT` | `/root/petitmo` |
| `PETITMO_BRANCH` | `next` |
| `PETITMO_PDF_ENV` | `/root/petitmo-pdf.env` |
| `PETITMO_PDF_CONTAINER` | `petitmo-pdf-server` |
| `PETITMO_PDF_IMAGE` | `petitmo-pdf-server` |
| `PETITMO_PDF_PORT` | `8787` |

Exemple :

```bash
PETITMO_REPO_ROOT=/srv/petitmo /srv/petitmo/scripts/deploy-pdf-server-hetzner.sh
```

---

## 4. Si quelque chose échoue

```bash
docker ps -a --filter name=petitmo-pdf-server
docker logs petitmo-pdf-server --tail 80
curl -v http://127.0.0.1:8787/health
```

---

## 5. Rappel sécurité

- Ne commite **jamais** `petitmo-pdf.env` ni de secrets dans le dépôt.
- Garde la **2FA** sur GitHub et des clés SSH dédiées (`petitmo_ssh` sur le Mac pour le VPS).

---

## 6. App Expo / iPhone

Metro ne déploie pas le PDF. Après un déploiement réussi, mets **`EXPO_PUBLIC_PDF_SERVER_URL`** sur l’URL publique du serveur (reverse proxy / domaine) et refais un **export PDF** dans l’app pour valider.

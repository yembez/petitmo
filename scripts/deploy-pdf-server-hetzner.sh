#!/usr/bin/env bash
# Déploiement du service PDF sur Hetzner (Docker).
# À lancer SUR LE VPS, en root, après avoir cloné le repo une première fois.
# Doc : server/DEPLOY_HETZNER.md
set -euo pipefail

REPO_ROOT="${PETITMO_REPO_ROOT:-/root/petitmo}"
BRANCH="${PETITMO_BRANCH:-next}"
ENV_FILE="${PETITMO_PDF_ENV:-/root/petitmo-pdf.env}"
CONTAINER="${PETITMO_PDF_CONTAINER:-petitmo-pdf-server}"
IMAGE="${PETITMO_PDF_IMAGE:-petitmo-pdf-server}"
HOST_PORT="${PETITMO_PDF_PORT:-8787}"

if [[ ! -d "$REPO_ROOT/.git" ]]; then
  echo "Erreur: pas de dépôt git dans $REPO_ROOT"
  echo "Clone d’abord: git clone https://github.com/yembez/petitmo.git $REPO_ROOT && cd $REPO_ROOT && git checkout $BRANCH"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erreur: fichier d’environnement introuvable: $ENV_FILE"
  exit 1
fi

echo "==> Dépôt: $REPO_ROOT (branche $BRANCH)"
cd "$REPO_ROOT"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Build image Docker ($IMAGE)"
cd "$REPO_ROOT/server"
docker build -t "$IMAGE" .

echo "==> Redémarrage conteneur $CONTAINER (port $HOST_PORT)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "${HOST_PORT}:${HOST_PORT}" \
  --env-file "$ENV_FILE" \
  "$IMAGE"

echo "==> Santé (localhost)"
sleep 2
if curl -sS -f "http://127.0.0.1:${HOST_PORT}/health" >/dev/null; then
  echo "OK /health"
  curl -sS "http://127.0.0.1:${HOST_PORT}/health" || true
  echo
else
  echo "Attention: /health non joignable. Voir: docker logs $CONTAINER --tail 50"
  exit 1
fi

echo "==> Terminé."

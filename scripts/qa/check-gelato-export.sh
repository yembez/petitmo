#!/usr/bin/env bash
# Lit le statut Gelato d'une export_requests (nécessite SUPABASE_SERVICE_ROLE_KEY dans .env.qa)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

EXPORT_ID="${1:-}"
[[ -n "$EXPORT_ID" ]] || die "Usage: $0 <export_request_id>"

[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || die "SUPABASE_SERVICE_ROLE_KEY manquant dans scripts/qa/.env.qa (copier depuis Railway → Variables)"

info "Lecture export_requests id=$EXPORT_ID"
ROWS="$(curl -sS "${SUPABASE_URL}/rest/v1/export_requests?id=eq.${EXPORT_ID}&select=id,status,printer_order_id,printer_name,last_error,shipped_at,created_at" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")"

echo "$ROWS" | jq .

STATUS="$(echo "$ROWS" | jq -r '.[0].status // empty')"
ORDER_ID="$(echo "$ROWS" | jq -r '.[0].printer_order_id // empty')"
ERR="$(echo "$ROWS" | jq -r '.[0].last_error // empty')"

if [[ -n "$ORDER_ID" ]]; then
  ok "Commande Gelato enregistrée (printer_order_id=$ORDER_ID, status=$STATUS)"
elif [[ -n "$ERR" ]]; then
  die "Envoi Gelato échoué : $ERR"
else
  die "Pas de printer_order_id ni last_error — vérifier logs Railway ou attendre quelques secondes"
fi

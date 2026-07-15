#!/usr/bin/env bash
# Test webhook Gelato → Railway (sans commande réelle).
# Usage : ./scripts/qa/smoke-gelato-webhook.sh [export_request_id]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
load_env

EXPORT_ID="${1:-}"
if [[ -z "$EXPORT_ID" ]]; then
  die "Usage: $0 <export_request_id>  (uuid d'une ligne export_requests print_order existante)"
fi

SECRET="${GELATO_WEBHOOK_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  die "GELATO_WEBHOOK_SECRET manquant dans scripts/qa/.env.qa (même valeur que Railway + Gelato)"
fi

info "POST ${PUBLIC_PDF_URL}/v1/webhooks/gelato (export_request_id=$EXPORT_ID)"
RESP="$(curl -sS -w "\n%{http_code}" "${PUBLIC_PDF_URL}/v1/webhooks/gelato" \
  -H "content-type: application/json" \
  -H "x-gelato-webhook-secret: ${SECRET}" \
  --data "$(jq -nc \
    --arg ref "$EXPORT_ID" \
    --arg oid "smoke-gelato-order-$(date +%s)" \
    '{
      orderId: $oid,
      orderReferenceId: $ref,
      fulfillmentStatus: "shipped",
      shipment: { trackingCode: "SMOKE-TEST-001", trackingUrl: "https://example.com/track" }
    }')")"

HTTP_CODE="$(echo "$RESP" | tail -n1)"
BODY="$(echo "$RESP" | sed '$d')"

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

[[ "$HTTP_CODE" == "200" ]] || die "HTTP $HTTP_CODE (attendu 200 — vérifier secret ou export_request_id)"
ok "Webhook accepté (HTTP 200)"

echo ""
echo "Vérifier Supabase :"
echo "  SELECT shipped_at, printer_order_json->>'trackingCode' FROM export_requests WHERE id = '${EXPORT_ID}';"

#!/usr/bin/env bash
# Étape 1 — architecture post-paid serveur→serveur
# stash AVANT paid → print-payment (bypass) kick Railway → sent_to_printer
# SANS generate-pdf client, SANS poll app.
#
# Usage : ./scripts/qa/smoke-print-fulfill-background.sh
# Prérequis : .env.qa (SUPABASE_*, PUBLIC_PDF_URL, SUPABASE_SERVICE_ROLE_KEY),
#             STRIPE_PRINT_BYPASS=1 sur Edge print-payment, GELATO_* sur Railway.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || die "SUPABASE_SERVICE_ROLE_KEY requis dans scripts/qa/.env.qa"

QA_TEST_EMAIL="qa+bg-fulfill-$(date +%Y%m%d-%H%M%S)-${RANDOM}@example.com"
GELATO_QA_INNER_PAGES="${GELATO_QA_INNER_PAGES:-30}"
GELATO_QA_MAQUETTE_PAGES=$((GELATO_QA_INNER_PAGES + 2))
POLL_ATTEMPTS="${POLL_ATTEMPTS:-60}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-5}"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-bg-fulfill-${STAMP}"
CHILD_ID="qa-child-${STAMP}"

info "1/5 Healthcheck ${PUBLIC_PDF_URL}/health"
curl -sS "${PUBLIC_PDF_URL}/health" | jq -e '.ok == true' >/dev/null
ok "Service PDF en ligne"

info "2/5 init-export (print_order, gelato_pages=${GELATO_QA_INNER_PAGES})"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
INIT_RESP="$(curl -sS "${SUPABASE_URL}/functions/v1/init-export" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -nc \
    --arg book_id "$BOOK_ID" \
    --arg child_id "$CHILD_ID" \
    --arg email "$QA_TEST_EMAIL" \
    --arg now "$NOW" \
    --argjson pages "$GELATO_QA_INNER_PAGES" \
    '{
      type: "print_order",
      export_mode: "print",
      book_id: $book_id,
      child_local_id: $child_id,
      subscription_tier: "paid",
      audio_video_page_count: 0,
      email: $email,
      gdpr_consent_at: $now,
      shipping_name: "Test Petitmo Background",
      shipping_address_json: {
        line1: "12 rue Example",
        city: "Paris",
        zip: "75001",
        country: "FR"
      },
      gelato_pages: $pages,
      billable_pages: $pages,
      discount_percent: 10,
      printer_name: "gelato",
      content_verified_at: $now,
      cgv_version: "2026-09-17"
    }')")"

TICKET="$(assert_jq_field "$INIT_RESP" '.exportTicket' 'exportTicket absent')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'exportRequestId absent')"
ok "Ticket (exportRequestId=$EXPORT_ID)"

info "3/5 stash-print-payload AVANT paid (simule staging pré-Checkout)"
PAGES_JSON="$(jq -nc --argjson n "$GELATO_QA_MAQUETTE_PAGES" '
  [{ type: "cover" }]
  + (if $n >= 2 then [{ type: "chapter", month: "juillet", chapterNum: 1 }] else [] end)
  + [range(2; ($n - 1)) | { type: "chapter", month: "juillet", chapterNum: . }]
  + (if $n >= 2 then [{ type: "back-cover" }] else [] end)
')"

PAYLOAD="$(jq -nc \
  --arg bookId "$BOOK_ID" \
  --arg childId "$CHILD_ID" \
  --arg qrBaseUrl "$PUBLIC_MEDIA_BASE_URL" \
  --argjson pages "$PAGES_JSON" \
  '{
    bookId: $bookId,
    childId: $childId,
    coverTitle: "Journal background",
    coverYearLabel: "2026",
    chapterTitle: "Smoke fond",
    qrBaseUrl: $qrBaseUrl,
    exportMode: "print",
    subscriptionTier: "premium",
    coverPhotoUrl: null,
    pages: $pages,
    guestChild: { name: "Lina", photo_url: null, birthdate: "2024-01-15" },
    guestMemories: []
  }')"

STASH_RESP="$(curl -sS "${PUBLIC_PDF_URL}/v1/books/stash-print-payload" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${TICKET}" \
  --data "$PAYLOAD")"
echo "$STASH_RESP" | jq -e '.ok == true' >/dev/null || die "stash échoué : $STASH_RESP"
echo "$STASH_RESP" | jq -e '.alreadyPaid == false' >/dev/null || die "alreadyPaid inattendu avant pay"
ok "Payload stashé (unpaid)"

info "4/5 Marquer paid + kick Railway (sans generate-pdf client)"
# Préférer bypass Edge si STRIPE_PRINT_BYPASS=1 ; sinon service role + kick interne
# (prod sans bypass : même chemin Railway que le webhook après paid).
KICK_MODE=""
PAY_RESP="$(mark_print_paid "$TICKET" "$QA_TEST_EMAIL" || true)"
if echo "$PAY_RESP" | jq -e '.paymentStatus == "paid"' >/dev/null 2>&1; then
  KICK_MODE="edge_bypass"
  ok "paid via print-payment bypass (Edge doit avoir kick print-fulfill)"
else
  info "bypass Stripe off → paid SQL + POST /v1/internal/print-fulfill"
  [[ -n "${PRINT_FULFILL_SECRET:-}" ]] || die "PRINT_FULFILL_SECRET manquant (export depuis Railway) pour le kick interne"
  PATCH="$(curl -sS -X PATCH "${SUPABASE_URL}/rest/v1/export_requests?id=eq.${EXPORT_ID}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    --data "$(jq -nc '{ payment_status: "paid", paid_at: (now | todate), last_error: null }')")"
  echo "$PATCH" | jq -e '.[0].payment_status == "paid"' >/dev/null || die "mark paid SQL échoué : $PATCH"
  KICK_HTTP="$(curl -sS -o /tmp/print-fulfill-kick.json -w '%{http_code}' \
    -X POST "${PUBLIC_PDF_URL}/v1/internal/print-fulfill" \
    -H "content-type: application/json" \
    -H "authorization: Bearer ${PRINT_FULFILL_SECRET}" \
    --data "$(jq -nc --arg id "$EXPORT_ID" '{ exportRequestId: $id }')")"
  [[ "$KICK_HTTP" == "202" ]] || die "kick interne HTTP $KICK_HTTP : $(cat /tmp/print-fulfill-kick.json 2>/dev/null || true)"
  KICK_MODE="internal"
  ok "paid SQL + kick interne 202"
fi

info "5/5 Poll Supabase jusqu’à sent_to_printer (max $((POLL_ATTEMPTS * POLL_INTERVAL_S))s, mode=$KICK_MODE)"
STATUS=""
ORDER_ID=""
ERR=""
for i in $(seq 1 "$POLL_ATTEMPTS"); do
  ROWS="$(curl -sS "${SUPABASE_URL}/rest/v1/export_requests?id=eq.${EXPORT_ID}&select=id,status,payment_status,printer_order_id,last_error,pdf_payload_stashed_at" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")"
  STATUS="$(echo "$ROWS" | jq -r '.[0].status // empty')"
  ORDER_ID="$(echo "$ROWS" | jq -r '.[0].printer_order_id // empty')"
  ERR="$(echo "$ROWS" | jq -r '.[0].last_error // empty')"
  PAY="$(echo "$ROWS" | jq -r '.[0].payment_status // empty')"
  info "  attempt $i/$POLL_ATTEMPTS status=$STATUS payment=$PAY order=${ORDER_ID:0:8}…"
  if [[ -n "$ORDER_ID" && "$STATUS" == "sent_to_printer" ]]; then
    ok "Gelato OK sans app (printer_order_id=$ORDER_ID)"
    echo ""
    echo "exportRequestId=$EXPORT_ID"
    echo "CRITÈRE ÉTAPE 1 : PASS — stash→paid→Railway→Gelato sans generate-pdf client (mode=$KICK_MODE)"
    exit 0
  fi
  if [[ "$STATUS" == "failed" ]]; then
    die "fulfill failed (last_error=$ERR) — kick Edge ou PDF/Gelato à investiguer"
  fi
  sleep "$POLL_INTERVAL_S"
done

die "Timeout : status=$STATUS last_error=$ERR — logs Railway print-fulfill / PRINT_FULFILL_SECRET Edge"

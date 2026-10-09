#!/usr/bin/env bash
# Étape 2 + P0.1 — retries fond : failed retryable → sweep → sent_to_printer
# + PAYLOAD_MISSING d’abord retryable, puis escalade permanent (paid_at >45 min) + ops alert.
#
# Usage : SUPABASE_SERVICE_ROLE_KEY=… PRINT_FULFILL_SECRET=… ./scripts/qa/smoke-print-fulfill-retry.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || die "SUPABASE_SERVICE_ROLE_KEY requis"
[[ -n "${PRINT_FULFILL_SECRET:-}" ]] || die "PRINT_FULFILL_SECRET requis"

QA_TEST_EMAIL="qa+retry-$(date +%Y%m%d-%H%M%S)-${RANDOM}@example.com"
GELATO_QA_INNER_PAGES="${GELATO_QA_INNER_PAGES:-30}"
GELATO_QA_MAQUETTE_PAGES=$((GELATO_QA_INNER_PAGES + 2))
POLL_ATTEMPTS="${POLL_ATTEMPTS:-60}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-5}"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-retry-${STAMP}"
CHILD_ID="qa-child-${STAMP}"

rest_get() {
  curl -sS "${SUPABASE_URL}/rest/v1/export_requests?id=eq.${1}&select=${2}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
}

rest_patch() {
  local id="$1"
  local json="$2"
  curl -sS -X PATCH "${SUPABASE_URL}/rest/v1/export_requests?id=eq.${id}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    --data "$json"
}

build_payload() {
  local book="$1" child="$2"
  local pages
  pages="$(jq -nc --argjson n "$GELATO_QA_MAQUETTE_PAGES" '
    [{ type: "cover" }]
    + (if $n >= 2 then [{ type: "chapter", month: "juillet", chapterNum: 1 }] else [] end)
    + [range(2; ($n - 1)) | { type: "chapter", month: "juillet", chapterNum: . }]
    + (if $n >= 2 then [{ type: "back-cover" }] else [] end)
  ')"
  jq -nc \
    --arg bookId "$book" \
    --arg childId "$child" \
    --arg qrBaseUrl "$PUBLIC_MEDIA_BASE_URL" \
    --argjson pages "$pages" \
    '{
      bookId: $bookId,
      childId: $childId,
      coverTitle: "Retry smoke",
      coverYearLabel: "2026",
      chapterTitle: "Retry",
      qrBaseUrl: $qrBaseUrl,
      exportMode: "print",
      subscriptionTier: "premium",
      coverPhotoUrl: null,
      pages: $pages,
      guestChild: { name: "Lina", photo_url: null, birthdate: "2024-01-15" },
      guestMemories: []
    }'
}

info "=== A) Retryable → sweep → Gelato ==="
info "1/6 health + init"
curl -sS "${PUBLIC_PDF_URL}/health" | jq -e '.ok == true' >/dev/null
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
      shipping_name: "Test Retry",
      shipping_address_json: { line1: "12 rue Example", city: "Paris", zip: "75001", country: "FR" },
      gelato_pages: $pages,
      billable_pages: $pages,
      discount_percent: 10,
      printer_name: "gelato",
      content_verified_at: $now,
      cgv_version: "2026-09-17"
    }')")"
TICKET="$(assert_jq_field "$INIT_RESP" '.exportTicket' 'ticket')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'export id')"
ok "export=$EXPORT_ID"

info "2/6 stash unpaid"
PAYLOAD="$(build_payload "$BOOK_ID" "$CHILD_ID")"
STASH="$(curl -sS "${PUBLIC_PDF_URL}/v1/books/stash-print-payload" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${TICKET}" \
  --data "$PAYLOAD")"
echo "$STASH" | jq -e '.ok == true' >/dev/null || die "stash: $STASH"
ok "stashed"

info "3/6 paid SQL (sans kick immédiat)"
rest_patch "$EXPORT_ID" "$(jq -nc '{ payment_status: "paid", paid_at: (now | todate), last_error: null }')" \
  | jq -e '.[0].payment_status == "paid"' >/dev/null
ok "paid"

info "4/6 simuler échec retryable dû (next_retry_at passé)"
PAST="$(date -u -v-2M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
rest_patch "$EXPORT_ID" "$(jq -nc --arg past "$PAST" '{
  status: "failed",
  last_error: "ECONNRESET simulated for retry smoke",
  fulfill_failed_kind: "retryable",
  fulfill_attempt_count: 1,
  fulfill_next_retry_at: $past,
  printer_order_id: null
}')" | jq -e '.[0].fulfill_failed_kind == "retryable"' >/dev/null
ok "failed retryable scheduled"

info "5/6 POST retry-sweep"
SWEEP="$(curl -sS -X POST "${PUBLIC_PDF_URL}/v1/internal/print-fulfill-retry-sweep" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${PRINT_FULFILL_SECRET}" \
  --data '{}')"
echo "$SWEEP" | jq -e '.ok == true' >/dev/null || die "sweep: $SWEEP"
ok "sweep $SWEEP"

info "6/6 poll sent_to_printer"
for i in $(seq 1 "$POLL_ATTEMPTS"); do
  ROW="$(rest_get "$EXPORT_ID" "status,printer_order_id,fulfill_failed_kind,fulfill_attempt_count,last_error")"
  STATUS="$(echo "$ROW" | jq -r '.[0].status // empty')"
  ORDER="$(echo "$ROW" | jq -r '.[0].printer_order_id // empty')"
  info "  $i status=$STATUS order=${ORDER:0:8}…"
  if [[ -n "$ORDER" && "$STATUS" == "sent_to_printer" ]]; then
    ok "A PASS — retry → Gelato ($ORDER)"
    break
  fi
  if [[ "$i" -eq "$POLL_ATTEMPTS" ]]; then
    die "A timeout: $ROW"
  fi
  sleep "$POLL_INTERVAL_S"
done

info "=== B) PAYLOAD_MISSING → retryable, puis escalade permanent ==="
BOOK_B="qa-perm-${STAMP}"
INIT_B="$(curl -sS "${SUPABASE_URL}/functions/v1/init-export" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -nc \
    --arg book_id "$BOOK_B" \
    --arg child_id "$CHILD_ID" \
    --arg email "qa+perm-${STAMP}@example.com" \
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
      shipping_name: "Test Permanent",
      shipping_address_json: { line1: "12 rue Example", city: "Paris", zip: "75001", country: "FR" },
      gelato_pages: $pages,
      billable_pages: $pages,
      discount_percent: 10,
      printer_name: "gelato",
      content_verified_at: $now,
      cgv_version: "2026-09-17"
    }')")"
EXPORT_B="$(assert_jq_field "$INIT_B" '.exportRequestId' 'export B')"
# paid sans stash
rest_patch "$EXPORT_B" "$(jq -nc '{ payment_status: "paid", paid_at: (now | todate), pdf_payload_json: null }')" \
  | jq -e '.[0].payment_status == "paid"' >/dev/null

KICK_HTTP="$(curl -sS -o /tmp/kick-perm.json -w '%{http_code}' \
  -X POST "${PUBLIC_PDF_URL}/v1/internal/print-fulfill" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${PRINT_FULFILL_SECRET}" \
  --data "$(jq -nc --arg id "$EXPORT_B" '{ exportRequestId: $id }')")"
[[ "$KICK_HTTP" == "202" ]] || die "kick B HTTP $KICK_HTTP"

KIND=""
for i in $(seq 1 20); do
  ROW_B="$(rest_get "$EXPORT_B" "status,fulfill_failed_kind,print_ops_alert_sent_at,last_error,fulfill_attempt_count")"
  KIND="$(echo "$ROW_B" | jq -r '.[0].fulfill_failed_kind // empty')"
  info "  B1 $i kind=$KIND…"
  if [[ "$KIND" == "retryable" ]]; then
    ok "B1 PASS — PAYLOAD_MISSING retryable (awaiting stash)"
    break
  fi
  if [[ "$i" -eq 20 ]]; then
    die "B1 timeout kind!=retryable : $ROW_B"
  fi
  sleep 2
done

# Simule course stash trop longue (>45 min depuis paid_at) puis re-kick → permanent + ops.
rest_patch "$EXPORT_B" "$(jq -nc '{
  paid_at: ((now - 50*60) | todate),
  fulfill_next_retry_at: (now | todate)
}')" | jq -e '.[0].id' >/dev/null

KICK2_HTTP="$(curl -sS -o /tmp/kick-perm2.json -w '%{http_code}' \
  -X POST "${PUBLIC_PDF_URL}/v1/internal/print-fulfill" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${PRINT_FULFILL_SECRET}" \
  --data "$(jq -nc --arg id "$EXPORT_B" '{ exportRequestId: $id }')")"
[[ "$KICK2_HTTP" == "202" ]] || die "kick B2 HTTP $KICK2_HTTP"

for i in $(seq 1 20); do
  ROW_B="$(rest_get "$EXPORT_B" "status,fulfill_failed_kind,print_ops_alert_sent_at,last_error,fulfill_attempt_count")"
  KIND="$(echo "$ROW_B" | jq -r '.[0].fulfill_failed_kind // empty')"
  ALERT="$(echo "$ROW_B" | jq -r '.[0].print_ops_alert_sent_at // empty')"
  info "  B2 $i kind=$KIND alert=${ALERT:0:19}…"
  if [[ "$KIND" == "permanent" ]]; then
    ok "B2 PASS — escalade permanent (alert_at=${ALERT:-pending_edge})"
    echo ""
    echo "retry_export=$EXPORT_ID"
    echo "permanent_export=$EXPORT_B"
    echo "CRITÈRE P0.1 + étape 2 : PASS (retry A + awaiting_stash→permanent B). Vérifier mail support@ si Edge déployée."
    exit 0
  fi
  sleep 2
done
die "B2 timeout kind!=permanent : $(rest_get "$EXPORT_B" "status,fulfill_failed_kind,last_error")"

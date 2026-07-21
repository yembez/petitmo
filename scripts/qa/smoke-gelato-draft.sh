#!/usr/bin/env bash
# Test Gelato draft — PDF print ≥30 pages → envoi API Gelato (GELATO_ORDER_TYPE=draft sur Railway).
# Usage : ./scripts/qa/smoke-gelato-draft.sh
# Prérequis : code serveur déployé sur Railway + GELATO_* configurés + GELATO_ORDER_TYPE=draft
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

# Email unique par run (évite RATE_LIMIT_EMAIL sur qa+petitmo-smoke@…)
QA_TEST_EMAIL="qa+gelato-$(date +%Y%m%d-%H%M%S)-${RANDOM}@example.com"
GELATO_QA_INNER_PAGES="${GELATO_QA_INNER_PAGES:-30}"
GELATO_QA_MAQUETTE_PAGES=$((GELATO_QA_INNER_PAGES + 2))

OUT_DIR="${SCRIPT_DIR}/out"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-gelato-${STAMP}"
CHILD_ID="qa-child-${STAMP}"
PDF_OUT="${OUT_DIR}/livre-gelato-draft-${STAMP}.pdf"

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
      shipping_name: "Test Petitmo Gelato",
      shipping_address_json: {
        line1: "12 rue Example",
        city: "Paris",
        zip: "75001",
        country: "FR"
      },
      gelato_pages: $pages,
      billable_pages: $pages,
      discount_percent: 10,
      printer_name: "gelato"
    }')")"

TICKET="$(assert_jq_field "$INIT_RESP" '.exportTicket' 'exportTicket absent')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'exportRequestId absent')"
ok "Ticket obtenu (exportRequestId=$EXPORT_ID)"

info "3/5 generate-pdf print (${GELATO_QA_MAQUETTE_PAGES} pages maquette → ${GELATO_QA_INNER_PAGES} intérieures + format Gelato)"
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
    coverTitle: "Journal de Lina",
    coverYearLabel: "Été 2026",
    chapterTitle: "Nos premiers pas",
    qrBaseUrl: $qrBaseUrl,
    exportMode: "print",
    subscriptionTier: "premium",
    coverPhotoUrl: null,
    pages: $pages,
    guestChild: { name: "Lina", photo_url: null, birthdate: "2024-01-15" },
    guestMemories: []
  }')"

GEN_RESP="$(generate_pdf "$TICKET" "$PAYLOAD")"
PDF_URL="$(assert_jq_field "$GEN_RESP" '.pdfUrlSigned' 'pdfUrlSigned absent')"
ok "PDF print généré"

info "4/5 Téléchargement → $PDF_OUT"
curl -fsSL "$PDF_URL" -o "$PDF_OUT"
ok "PDF téléchargé ($(wc -c <"$PDF_OUT" | tr -d ' ') octets)"

SERVER_DIR="${SCRIPT_DIR}/../../server"
if [[ -f "${SERVER_DIR}/node_modules/pdf-lib/package.json" ]]; then
  ACTUAL_PAGES="$(cd "$SERVER_DIR" && node -e "
    const fs=require('fs');
    const {PDFDocument}=require('pdf-lib');
    (async()=>{const d=await PDFDocument.load(fs.readFileSync(process.argv[1])); console.log(d.getPageCount());})();" "$PDF_OUT")"
  EXPECTED_PDF_PAGES=$((GELATO_QA_INNER_PAGES + 3))
  info "Pages PDF réelles : ${ACTUAL_PAGES} (attendu ${EXPECTED_PDF_PAGES} format Gelato)"
  [[ "$ACTUAL_PAGES" -ge "$EXPECTED_PDF_PAGES" ]] || die "PDF Gelato trop court ($ACTUAL_PAGES pages, attendu ≥ ${EXPECTED_PDF_PAGES})"
fi

info "5/5 Attente envoi Gelato (10s) puis vérif Supabase si service role"
sleep 10

if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  "${SCRIPT_DIR}/check-gelato-export.sh" "$EXPORT_ID"
else
  echo ""
  echo "exportRequestId : $EXPORT_ID"
  echo "Vérifier Supabase :"
  echo "  SELECT status, printer_order_id, last_error FROM export_requests WHERE id = '${EXPORT_ID}';"
  echo "Vérifier dashboard Gelato → Orders (filtres dates larges, fulfillment Draft si besoin)."
fi

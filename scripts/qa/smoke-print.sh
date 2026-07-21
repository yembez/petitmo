#!/usr/bin/env bash
# Test print — health → init-export print_order (V1 gelato_pages≥30) → generate-pdf print → téléchargement.
# Pour vérifier Gelato draft + order id : ./scripts/qa/smoke-gelato-draft.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

# Email unique (évite RATE_LIMIT_EMAIL)
QA_TEST_EMAIL="qa+print-$(date +%Y%m%d-%H%M%S)-${RANDOM}@example.com"
# Tarif V1 + Railway Gelato : catalogue pair ≥ 30
GELATO_QA_INNER_PAGES="${GELATO_QA_INNER_PAGES:-30}"
GELATO_QA_MAQUETTE_PAGES=$((GELATO_QA_INNER_PAGES + 2))

OUT_DIR="${SCRIPT_DIR}/out"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-print-${STAMP}"
CHILD_ID="qa-child-${STAMP}"
PDF_OUT="${OUT_DIR}/livre-print-${STAMP}.pdf"

info "1/4 Healthcheck ${PUBLIC_PDF_URL}/health"
HEALTH="$(curl -sS "${PUBLIC_PDF_URL}/health")"
echo "$HEALTH" | jq -e '.ok == true' >/dev/null
ok "Service PDF en ligne"

info "2/4 init-export (print_order, gelato_pages=${GELATO_QA_INNER_PAGES})"
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
      shipping_name: "Test Petitmo",
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

TICKET="$(assert_jq_field "$INIT_RESP" '.exportTicket' 'exportTicket absent dans init-export')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'exportRequestId absent')"
PRICE_CENTS="$(echo "$INIT_RESP" | jq -r '.priceCents // empty')"
ok "Ticket obtenu (exportRequestId=$EXPORT_ID, priceCents=${PRICE_CENTS:-?})"

info "3/4 generate-pdf (exportMode print, ${GELATO_QA_MAQUETTE_PAGES} pages maquette)"
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
STORAGE_PATH="$(echo "$GEN_RESP" | jq -r '.pdfStoragePath // empty')"
ok "PDF print généré (storage=${STORAGE_PATH:-null})"

info "4/4 Téléchargement → $PDF_OUT"
curl -fsSL "$PDF_URL" -o "$PDF_OUT"
SIZE="$(wc -c <"$PDF_OUT" | tr -d ' ')"
[[ "$SIZE" -gt 1000 ]] || die "Fichier PDF trop petit ($SIZE octets)"
ok "PDF téléchargé ($SIZE octets)"

SERVER_DIR="${SCRIPT_DIR}/../../server"
if [[ -f "${SERVER_DIR}/node_modules/pdf-lib/package.json" ]]; then
  info "Vérification format page (attendu ~218×288 mm)"
  (cd "$SERVER_DIR" && node -e "
    const fs=require('fs');
    const {PDFDocument}=require('pdf-lib');
    (async()=>{
      const doc=await PDFDocument.load(fs.readFileSync(process.argv[1]));
      const p=doc.getPage(0);
      const w=p.getWidth()*0.352778;
      const h=p.getHeight()*0.352778;
      console.log('pages='+doc.getPageCount()+'  format_mm='+w.toFixed(1)+'x'+h.toFixed(1)+'  (Gelato print + bleed 4mm)');
    })();
  " "$PDF_OUT")
fi

echo ""
echo "Fichier : $PDF_OUT"
if command -v open >/dev/null 2>&1; then
  open "$PDF_OUT"
  ok "Ouvert dans Aperçu / Preview"
fi

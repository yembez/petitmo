#!/usr/bin/env bash
# Smoke test commande impression (sans app) — voir server/PROD_CHECKLIST.md §5
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL requis}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY requis}"
: "${PUBLIC_PDF_URL:?PUBLIC_PDF_URL requis}"

BOOK_ID="${BOOK_ID:-smoke-print-book}"
CHILD_ID="${CHILD_ID:-smoke-child}"
EMAIL="${EMAIL:-test@example.com}"
QR_BASE="${PUBLIC_MEDIA_BASE_URL:-${PUBLIC_PDF_URL}/m}"

echo "== init-export print_order =="
curl -sS "${SUPABASE_URL}/functions/v1/init-export" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -nc --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg book "$BOOK_ID" --arg child "$CHILD_ID" --arg email "$EMAIL" '{
    type: "print_order",
    export_mode: "print",
    book_id: $book,
    child_local_id: $child,
    subscription_tier: "paid",
    audio_video_page_count: 0,
    email: $email,
    gdpr_consent_at: $now,
    shipping_name: "Test Petitmo",
    shipping_address_json: {
      line1: "1 rue de Test",
      city: "Paris",
      zip: "75001",
      country: "FR"
    },
    billable_pages: 20,
    discount_percent: 0,
    printer_name: "gelato"
  }')" | tee /tmp/petitmo-print-init.json | jq .

EXPORT_TICKET="$(jq -r .exportTicket /tmp/petitmo-print-init.json)"
if [[ -z "$EXPORT_TICKET" || "$EXPORT_TICKET" == "null" ]]; then
  echo "exportTicket manquant" >&2
  exit 1
fi

if [[ ! -f "${PAYLOAD_JSON:-}" ]]; then
  echo "Définir PAYLOAD_JSON=chemin/vers/payload-print-min.json (guestChild + guestMemories + pages)" >&2
  exit 1
fi

echo "== generate-pdf print =="
curl -sS "${PUBLIC_PDF_URL}/v1/books/generate-pdf" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${EXPORT_TICKET}" \
  --data "$(jq -c --arg qr "$QR_BASE" '. + { qrBaseUrl: $qr, exportMode: "print", subscriptionTier: "premium" }' "$PAYLOAD_JSON")" \
  | tee /tmp/petitmo-print-pdf.json | jq .

PDF_URL="$(jq -r .pdfUrlSigned /tmp/petitmo-print-pdf.json)"
if [[ -n "$PDF_URL" && "$PDF_URL" != "null" ]]; then
  curl -fsSL "$PDF_URL" -o /tmp/petitmo-print-smoke.pdf
  echo "PDF téléchargé : /tmp/petitmo-print-smoke.pdf"
fi

echo "Vérifier export_requests.status (done ou sent_to_printer si GELATO_* configuré sur Railway)."

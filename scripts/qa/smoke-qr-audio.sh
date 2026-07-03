#!/usr/bin/env bash
# Test B — QR audio : init-export → upload audio guest → generate-pdf → /m/{token}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

if ! command -v ffmpeg >/dev/null 2>&1; then
  die "ffmpeg requis pour générer un fichier audio de test (brew install ffmpeg)"
fi

OUT_DIR="${SCRIPT_DIR}/out"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-qr-${STAMP}"
CHILD_ID="qa-child-${STAMP}"
MEMORY_ID="qa-voice-${STAMP}"
AUDIO_FIXTURE="${OUT_DIR}/qa-fixture-${STAMP}.m4a"
PDF_OUT="${OUT_DIR}/qa-qr-${STAMP}.pdf"

info "Fixture audio 1s → $AUDIO_FIXTURE"
ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -c:a aac -b:a 64k "$AUDIO_FIXTURE"

info "1/6 init-export (1 page audio/vidéo)"
INIT_RESP="$(init_export_pdf "$BOOK_ID" "$CHILD_ID" 1)"
PDF_TICKET="$(assert_jq_field "$INIT_RESP" '.pdfTicket' 'pdfTicket absent')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'exportRequestId absent')"
ok "Ticket obtenu (exportRequestId=$EXPORT_ID)"

info "2/6 guest-upload-urls (audio)"
ASSETS="$(jq -nc --arg mid "$MEMORY_ID" '[{ kind: "audio", memoryId: $mid }]')"
UPLOAD_RESP="$(guest_upload_urls "$PDF_TICKET" "$ASSETS")"
SIGNED_URL="$(echo "$UPLOAD_RESP" | jq -r '.uploads[0].signedUrl // empty')"
QR_TOKEN="$(echo "$UPLOAD_RESP" | jq -r '.uploads[0].token // empty')"
[[ -n "$SIGNED_URL" ]] || die "signedUrl audio absent : $(echo "$UPLOAD_RESP" | jq .)"
[[ -n "$QR_TOKEN" ]] || die "token QR absent : $(echo "$UPLOAD_RESP" | jq .)"
ok "Token QR : $QR_TOKEN"

info "3/6 Upload audio raw (PUT Storage)"
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  -H "Content-Type: audio/mp4" \
  --data-binary @"$AUDIO_FIXTURE" \
  "$SIGNED_URL")"
[[ "$HTTP_CODE" =~ ^20 ]] || die "Upload Storage HTTP $HTTP_CODE"
ok "Audio uploadé (HTTP $HTTP_CODE)"

if STATUS_JSON="$(query_token_status "$QR_TOKEN" 2>/dev/null)"; then
  info "Statut token (service role) : $(echo "$STATUS_JSON" | jq -c '.[0] // .')"
fi

info "4/6 generate-pdf (page audio + guestMemories voice)"
PAYLOAD="$(jq -nc \
  --arg bookId "$BOOK_ID" \
  --arg childId "$CHILD_ID" \
  --arg memoryId "$MEMORY_ID" \
  --arg qrBaseUrl "$PUBLIC_MEDIA_BASE_URL" \
  --arg created_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{
    bookId: $bookId,
    childId: $childId,
    coverTitle: "QA Smoke QR",
    coverYearLabel: "Juillet 2026",
    chapterTitle: "Notre histoire",
    qrBaseUrl: $qrBaseUrl,
    exportMode: "digital",
    subscriptionTier: "premium",
    digitalExportPaid: true,
    coverPhotoUrl: null,
    pages: [
      { type: "cover" },
      { type: "chapter", month: "juillet", chapterNum: 1 },
      { type: "audio", memoryId: $memoryId },
      { type: "back-cover" }
    ],
    guestChild: { name: "Lina", photo_url: null },
    guestMemories: [
      {
        id: $memoryId,
        type: "voice",
        content: null,
        duration: 1,
        created_at: $created_at
      }
    ]
  }')"

GEN_RESP="$(generate_pdf "$PDF_TICKET" "$PAYLOAD")"
PDF_URL="$(assert_jq_field "$GEN_RESP" '.pdfUrlSigned' 'pdfUrlSigned absent')"
ok "PDF avec QR généré"

info "5/6 Téléchargement PDF → $PDF_OUT"
curl -fsSL "$PDF_URL" -o "$PDF_OUT"
ok "PDF sauvegardé"

info "6/6 Vérification URL publique QR"
poll_qr_ready "$QR_TOKEN" 30

QR_URL="${PUBLIC_MEDIA_BASE_URL}/${QR_TOKEN}"
echo ""
ok "Test B terminé"
echo "  Token  : $QR_TOKEN"
echo "  URL QR : $QR_URL"
echo "  PDF    : $PDF_OUT"
echo ""
echo "Vérification manuelle : scanner le QR du PDF (doit pointer vers la même URL)."

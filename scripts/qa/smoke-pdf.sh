#!/usr/bin/env bash
# Test A — PDF serveur : health → init-export → generate-pdf → téléchargement
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd curl
require_cmd jq
load_env

OUT_DIR="${SCRIPT_DIR}/out"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BOOK_ID="qa-pdf-${STAMP}"
CHILD_ID="qa-child-${STAMP}"
PDF_OUT="${OUT_DIR}/qa-smoke-${STAMP}.pdf"

info "1/4 Healthcheck ${PUBLIC_PDF_URL}/health"
HEALTH="$(curl -sS "${PUBLIC_PDF_URL}/health")"
echo "$HEALTH" | jq . >/dev/null 2>&1 || die "Réponse /health invalide : $HEALTH"
OK_VAL="$(echo "$HEALTH" | jq -r '.ok')"
[[ "$OK_VAL" == "true" ]] || die "/health ok!=true"
ok "Service PDF en ligne"

info "2/4 init-export (pdf_export digital)"
INIT_RESP="$(init_export_pdf "$BOOK_ID" "$CHILD_ID" 0)"
PDF_TICKET="$(assert_jq_field "$INIT_RESP" '.pdfTicket' 'pdfTicket absent dans init-export')"
EXPORT_ID="$(assert_jq_field "$INIT_RESP" '.exportRequestId' 'exportRequestId absent')"
ok "Ticket obtenu (exportRequestId=$EXPORT_ID)"

info "3/4 generate-pdf"
PAYLOAD="$(jq -nc \
  --arg bookId "$BOOK_ID" \
  --arg childId "$CHILD_ID" \
  --arg qrBaseUrl "$PUBLIC_MEDIA_BASE_URL" \
  '{
    bookId: $bookId,
    childId: $childId,
    coverTitle: "QA Smoke PDF",
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
      { type: "back-cover" }
    ],
    guestChild: { name: "Lina", photo_url: null },
    guestMemories: []
  }')"

GEN_RESP="$(generate_pdf "$PDF_TICKET" "$PAYLOAD")"
PDF_URL="$(assert_jq_field "$GEN_RESP" '.pdfUrlSigned' 'pdfUrlSigned absent')"
STORAGE_PATH="$(echo "$GEN_RESP" | jq -r '.pdfStoragePath // empty')"
ok "PDF généré (storage=${STORAGE_PATH:-null})"

info "4/4 Téléchargement → $PDF_OUT"
curl -fsSL "$PDF_URL" -o "$PDF_OUT"
SIZE="$(wc -c <"$PDF_OUT" | tr -d ' ')"
[[ "$SIZE" -gt 1000 ]] || die "Fichier PDF trop petit ($SIZE octets)"
ok "PDF téléchargé ($SIZE octets) : $PDF_OUT"

echo ""
echo "Prochaine étape manuelle : ouvrir le PDF et vérifier la mise en page."
if [[ -t 0 ]] && command -v open >/dev/null 2>&1; then
  read -r -p "Ouvrir maintenant ? [o/N] " ans
  if [[ "${ans,,}" == "o" || "${ans,,}" == "oui" || "${ans,,}" == "y" ]]; then
    open "$PDF_OUT"
  fi
fi

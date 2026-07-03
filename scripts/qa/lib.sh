#!/usr/bin/env bash
# Helpers partagés — source depuis les scripts qa/*.sh

set -euo pipefail

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${QA_DIR}/.env.qa"

die() {
  echo "❌ $*" >&2
  exit 1
}

info() {
  echo "→ $*"
}

ok() {
  echo "✅ $*"
}

require_cmd() {
  local c="$1"
  command -v "$c" >/dev/null 2>&1 || die "Commande requise introuvable : $c"
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    die "Fichier $ENV_FILE absent. Copie scripts/qa/.env.qa.example → scripts/qa/.env.qa et remplis les valeurs."
  fi
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a

  [[ -n "${PUBLIC_PDF_URL:-}" ]] || die "PUBLIC_PDF_URL manquant dans .env.qa"
  [[ -n "${SUPABASE_URL:-}" ]] || die "SUPABASE_URL manquant dans .env.qa"
  [[ -n "${SUPABASE_ANON_KEY:-}" ]] || die "SUPABASE_ANON_KEY manquant dans .env.qa"

  PUBLIC_PDF_URL="${PUBLIC_PDF_URL%/}"
  if [[ -z "${PUBLIC_MEDIA_BASE_URL:-}" ]]; then
    PUBLIC_MEDIA_BASE_URL="${PUBLIC_PDF_URL}/m"
  fi
  PUBLIC_MEDIA_BASE_URL="${PUBLIC_MEDIA_BASE_URL%/}"
  QA_TEST_EMAIL="${QA_TEST_EMAIL:-qa+petitmo-smoke@example.com}"
}

init_export_pdf() {
  local book_id="$1"
  local child_id="$2"
  local av_count="${3:-0}"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  curl -sS "${SUPABASE_URL}/functions/v1/init-export" \
    -H "content-type: application/json" \
    -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    --data "$(jq -nc \
      --arg book_id "$book_id" \
      --arg child_id "$child_id" \
      --arg email "$QA_TEST_EMAIL" \
      --arg now "$now" \
      --argjson av "$av_count" \
      '{
        type: "pdf_export",
        export_mode: "digital",
        book_id: $book_id,
        child_local_id: $child_id,
        subscription_tier: "paid",
        audio_video_page_count: $av,
        email: $email,
        gdpr_consent_at: $now,
        full_name: "QA Smoke",
        marketing_opt_in: false
      }')"
}

guest_upload_urls() {
  local pdf_ticket="$1"
  shift
  local assets_json="$1"

  curl -sS "${SUPABASE_URL}/functions/v1/guest-upload-urls" \
    -H "content-type: application/json" \
    -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    --data "$(jq -nc \
      --arg ticket "$pdf_ticket" \
      --argjson assets "$assets_json" \
      '{ pdfTicket: $ticket, assets: $assets }')"
}

generate_pdf() {
  local pdf_ticket="$1"
  local payload_json="$2"

  curl -sS "${PUBLIC_PDF_URL}/v1/books/generate-pdf" \
    -H "content-type: application/json" \
    -H "authorization: Bearer ${pdf_ticket}" \
    --data "$payload_json"
}

assert_jq_field() {
  local json="$1"
  local filter="$2"
  local label="$3"
  local val
  val="$(echo "$json" | jq -r "$filter" 2>/dev/null || true)"
  if [[ -z "$val" || "$val" == "null" ]]; then
    echo "$json" | jq . >&2 || echo "$json" >&2
    die "$label"
  fi
  echo "$val"
}

poll_qr_ready() {
  local token="$1"
  local max_attempts="${2:-24}"
  local url="${PUBLIC_MEDIA_BASE_URL}/${token}"
  local i body

  info "Polling QR (max ${max_attempts}×5s) : $url"
  for ((i = 1; i <= max_attempts; i++)); do
    body="$(curl -sS "$url" || true)"
    if echo "$body" | grep -q '<audio class="player"'; then
      ok "QR audio prêt (tentative $i)"
      return 0
    fi
    if echo "$body" | grep -q '<video class="player"'; then
      ok "QR vidéo prêt (tentative $i)"
      return 0
    fi
    if echo "$body" | grep -q "n'a pas pu être préparé"; then
      echo "$body" >&2
      die "QR en échec (status failed côté serveur)"
    fi
    sleep 5
  done
  die "QR non prêt après ${max_attempts} tentatives — ouvrir manuellement : $url"
}

query_token_status() {
  local token="$1"
  [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || return 1
  curl -sS "${SUPABASE_URL}/rest/v1/public_media_tokens?token=eq.${token}&select=status,last_error,ready_path" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
}

#!/usr/bin/env bash
# Smoke durabilité : health + audit/heal médias + sync QR (+ méta textes léger).
# Usage :
#   export MEDIA_WORKER_URL="https://petitmo-media-worker-production.up.railway.app"
#   export MEDIA_WORKER_SECRET="…"   # nouveau secret après rotation
#   ./scripts/qa/smoke-backup-r2.sh
#
# Ne détruit rien. Ne prouve pas un heal « delete puis restore » (manuel).

set -euo pipefail

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
info() { echo "→ $*"; }

[[ -n "${MEDIA_WORKER_URL:-}" ]] || die "MEDIA_WORKER_URL manquant"
[[ -n "${MEDIA_WORKER_SECRET:-}" ]] || die "MEDIA_WORKER_SECRET manquant"

BASE="${MEDIA_WORKER_URL%/}"
HDR=(-H "Content-Type: application/json" -H "X-Worker-Secret: ${MEDIA_WORKER_SECRET}")

info "1/4 health"
HEALTH="$(curl -sS --fail "${BASE}/health")" || die "health KO (URL / réseau)"
echo "$HEALTH" | grep -q '"ok":true' || die "health: ok!=true → $HEALTH"
echo "$HEALTH" | grep -q '"r2Configured":true' || die "R2 non configuré → $HEALTH"
echo "$HEALTH" | grep -q '"healFromR2":true' || die "healFromR2 absent (ancien deploy ?) → $HEALTH"
ok "health OK"

info "2/4 media-integrity-audit (scanAll + heal)"
AUDIT="$(curl -sS --fail -X POST "${BASE}/media-integrity-audit" "${HDR[@]}" \
  -d '{"types":["photo","video","voice"],"healFromR2":true,"scanAll":true,"maxPages":5}')" \
  || die "audit KO — secret désaligné ? (401) ou worker down"
echo "$AUDIT" | grep -q '"ok":true' || die "audit: ok!=true → $AUDIT"
CHECKED="$(echo "$AUDIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('checked',0))" 2>/dev/null || echo "?")"
RESTORED="$(echo "$AUDIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('restoredCount',0))" 2>/dev/null || echo "?")"
MISSING="$(echo "$AUDIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('missingCount',0))" 2>/dev/null || echo "?")"
ok "audit OK (checked=$CHECKED restored=$RESTORED missing=$MISSING)"

info "3/4 backup-qr-sync"
QR="$(curl -sS --fail -X POST "${BASE}/backup-qr-sync" "${HDR[@]}" \
  -d '{"limit":10,"healFromR2":true}')" \
  || die "qr-sync KO"
echo "$QR" | grep -q '"ok":true' || die "qr-sync: ok!=true → $QR"
CRITICAL="$(echo "$QR" | python3 -c "import sys,json; print(json.load(sys.stdin).get('critical',0))" 2>/dev/null || echo "?")"
[[ "$CRITICAL" == "0" ]] || die "qr critical=$CRITICAL → $QR"
ok "qr-sync OK (critical=0)"

info "4/4 backup-memories-meta-sync (échantillon textes)"
META="$(curl -sS --fail -X POST "${BASE}/backup-memories-meta-sync" "${HDR[@]}" \
  -d '{"limit":10,"types":["text"]}')" \
  || die "meta-sync KO"
echo "$META" | grep -q '"ok":true' || die "meta-sync: ok!=true → $META"
ok "meta-sync OK"

echo
ok "Smoke backup R2 passé — secret / worker / R2 alignés."
echo "  (Heal destructif : delete Storage only + relancer audit / qr-sync — manuel.)"

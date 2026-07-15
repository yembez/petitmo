# Checklist smoke tests release — PDF + QR

> **Règle d’or** : gratuit = local uniquement ; ces tests valident les **exceptions cloud** (export PDF / QR livre) et le service Railway — pas la sync Petitmo+.

Date de référence : 2 juillet 2026. Complète [`AUDIT_RELEASE_READINESS_2026-07-02.md`](../../AUDIT_RELEASE_READINESS_2026-07-02.md) et [`server/PROD_CHECKLIST.md`](../../server/PROD_CHECKLIST.md).

---

## Prérequis (une fois)

- [ ] **URLs prod** notées (valeurs `eas.json` si inchangées) :
  - `PUBLIC_PDF_URL` = `https://petitmo-production.up.railway.app`
  - `PUBLIC_MEDIA_BASE_URL` = `https://petitmo-production.up.railway.app/m`
- [ ] **Supabase** : projet prod, clé `anon` (Dashboard → Settings → API)
- [ ] **Edge Functions** déployées : `init-export`, `guest-upload-urls`
- [ ] Secret `EXPORT_PDF_JWT_SECRET` (≥ 32 car.) identique sur Edge Functions **et** Railway
- [ ] Outils locaux : `curl`, `jq`, `ffmpeg` (`brew install jq ffmpeg`)
- [ ] Fichier local : `cp scripts/qa/.env.qa.example scripts/qa/.env.qa` puis remplir les valeurs (**ne pas committer**)

```bash
chmod +x scripts/qa/*.sh
```

---

## Migration prod `text_title` (bloque sync cloud texte)

- [ ] Migration appliquée en prod :

```sql
-- supabase/migrations/20260617120000_add_text_title_to_memories.sql
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS text_title text;
```

Via CLI : `supabase db push` (depuis la branche qui contient la migration)  
Ou SQL Editor Supabase → exécuter le fichier ci-dessus.

- [ ] Vérification :

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'text_title';
```

---

## Test A — PDF serveur (automatisé)

**Objectif** : health → ticket `init-export` → `generate-pdf` → PDF téléchargeable.

- [ ] Lancer :

```bash
./scripts/qa/smoke-pdf.sh
```

- [ ] `/health` → `{ "ok": true, "service": "petitmo-pdf-server" }`
- [ ] `init-export` → `pdfTicket` + `exportRequestId` (pas d’erreur 500 « Server misconfiguration »)
- [ ] `generate-pdf` → `pdfUrlSigned` non vide
- [ ] Fichier `scripts/qa/out/qa-smoke-*.pdf` > 1 Ko
- [ ] **Manuel** : ouvrir le PDF — couverture, chapitre, quatrième OK

### Dépannage rapide Test A

| Symptôme | Piste |
|----------|--------|
| 500 init-export | `EXPORT_PDF_JWT_SECRET` manquant / trop court sur Edge |
| 401 generate-pdf | Ticket expiré (20 min) ou secret JWT différent Railway ↔ Supabase |
| 502 generate-pdf | Migration Supabase manquante (`expires_at` sur `public_media_tokens`, etc.) |
| PDF vide / erreur Playwright | Logs Railway du service PDF |

---

## Test B — QR audio (automatisé + vérif manuelle)

**Objectif** : upload audio guest → PDF avec page audio → token `public_media_tokens` → `/m/{token}` joue l’audio.

- [ ] Lancer :

```bash
./scripts/qa/smoke-qr-audio.sh
```

- [ ] `guest-upload-urls` → `token` + `signedUrl` pour l’audio
- [ ] Upload Storage HTTP 2xx
- [ ] `generate-pdf` OK (worker QR lancé en arrière-plan pendant le rendu)
- [ ] Polling `/m/{token}` → page HTML avec balise `<audio class="player"`
- [ ] **Manuel** : ouvrir le PDF, scanner le QR → même URL, lecture audio OK sur Safari mobile

### Option — statut token (service role)

Si `SUPABASE_SERVICE_ROLE_KEY` est dans `.env.qa`, le script affiche le statut. Sinon :

```bash
# Remplacer TOKEN
curl -sS "$SUPABASE_URL/rest/v1/public_media_tokens?token=eq.TOKEN&select=status,last_error,ready_path" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq .
```

Attendu final : `"status": "ready"`.

### Dépannage rapide Test B

| Symptôme | Piste |
|----------|--------|
| QR « en préparation » longtemps | Worker ffmpeg sur Railway ; logs `publicMediaWorker` |
| `failed` + last_error | Format audio ; ffmpeg absent dans l’image Docker |
| QR pointe vers mauvais domaine | `qrBaseUrl` / `EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL` ≠ URL Railway `/m` |
| Aperçu livre in-app ≠ PDF | Bug connu : aperçu peut utiliser `memory.id` au lieu du token — le PDF serveur est la référence |

---

## Test C — Export depuis l’app (recommandé avant release)

**Objectif** : parcours réel utilisateur (Petitmo+ ou gratuit commande livre).

- [ ] Livre avec **au moins 1 audio** (idéalement 1 vidéo aussi)
- [ ] Export PDF numérique depuis l’app → pas de message « service non configuré »
- [ ] PDF reçu / téléchargé lisible
- [ ] QR scanné → lecture sur téléphone invité (4G, pas le Wi‑Fi dev)
- [ ] **Favoris / couvertures** : smoke visuel rapide après sync (hors scope curl)

---

## Test D — Mode print (optionnel, avant Gelato)

- [ ] Commande `print_order` via `init-export` (`type: print_order`, `export_mode: print`)
- [ ] Ticket `export_print` → `generate-pdf` avec `exportMode: "print"`
- [ ] PDF 218×288 mm, fond perdu 4 mm (voir `server/PROD_CHECKLIST.md` §6)
- [ ] Script : `./scripts/qa/smoke-print.sh`

---

## Test E — Gelato (consolidation pré-prod)

Voir `server/PROD_CHECKLIST.md` §7. Ordre :

- [ ] **E1** PDF print seul (`smoke-print.sh`) — `export_requests.status = done`
- [ ] **E2** Webhook (`smoke-gelato-webhook.sh` ou test notification Gelato) — `200` Railway
- [ ] **E3** Railway `GELATO_ORDER_TYPE=draft` → `./scripts/qa/smoke-gelato-draft.sh` (32 pages) → dashboard Gelato sans impression auto
- [ ] **E4** Parcours app `/book-order` → `sent_to_printer` + `printer_order_id`
- [ ] **E5** Webhook `order_status_updated` → `shipped_at` / tracking dans `printer_order_json`
- [ ] **E6** (prod) `GELATO_ORDER_TYPE=order` + 1 livre physique + QR audio OK

**Pas encore requis pour E1–E5** : paiement IAP livre (bloquant release utilisatrices).

---

## Commandes curl manuelles (si scripts indisponibles)

Remplacer les variables :

```bash
export PUBLIC_PDF_URL="https://petitmo-production.up.railway.app"
export PUBLIC_MEDIA_BASE_URL="${PUBLIC_PDF_URL}/m"
export SUPABASE_URL="https://VOTRE_REF.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."
```

### Health

```bash
curl -sS "${PUBLIC_PDF_URL}/health" | jq .
```

### init-export

```bash
curl -sS "${SUPABASE_URL}/functions/v1/init-export" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  --data "$(jq -nc --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
    type: "pdf_export",
    export_mode: "digital",
    book_id: "manual-test-book",
    child_local_id: "manual-child",
    subscription_tier: "paid",
    audio_video_page_count: 0,
    email: "test@example.com",
    gdpr_consent_at: $now,
    full_name: "Test",
    marketing_opt_in: false
  }')" | tee /tmp/init-export.json | jq .
```

### generate-pdf

```bash
PDF_TICKET="$(jq -r .pdfTicket /tmp/init-export.json)"
curl -sS "${PUBLIC_PDF_URL}/v1/books/generate-pdf" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${PDF_TICKET}" \
  --data "$(jq -nc \
    --arg qr "$PUBLIC_MEDIA_BASE_URL" \
    '{
      bookId: "manual-test-book",
      childId: "manual-child",
      coverTitle: "Test",
      coverYearLabel: "Juillet 2026",
      chapterTitle: "Notre histoire",
      qrBaseUrl: $qr,
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
    }')" | tee /tmp/generate-pdf.json | jq .

curl -fsSL "$(jq -r .pdfUrlSigned /tmp/generate-pdf.json)" -o /tmp/out.pdf
open /tmp/out.pdf
```

---

## Synthèse go / no-go (smoke infra)

| Critère | Test | OK |
|---------|------|-----|
| Service PDF en ligne | A | ☐ |
| Pipeline ticket → PDF | A | ☐ |
| QR audio public `/m/…` | B | ☐ |
| Export app réel | C | ☐ |
| Migration `text_title` prod | SQL | ☐ |
| RevenueCat / IAP | hors scope | ☐ (audit) |
| Gelato API | hors scope | ☐ (audit) |

**Go smoke infra** = A + B + migration cochés. **Go App Store** = tout l’audit release (IAP, Gelato, etc.).

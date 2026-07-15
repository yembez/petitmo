## Checklist prod — petitmo-pdf-server

S’applique à **tout** déploiement du service PDF (Railway, VPS Docker, etc.) : remplacer `<PUBLIC_PDF_URL>` par l’URL HTTPS réelle.

### 1) Variables d’environnement (hébergeur)

Obligatoires (le service refuse de démarrer sinon) :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optionnelles :

- `PORT` (défaut `8787` ; sur Railway laisser la valeur injectée par la plateforme)
- `TRUST_PROXY` (`1` ou `true` si derrière reverse proxy — Railway, Nginx, etc.)

### 2) Vérifier le service

- **Healthcheck** :

```bash
curl -sS "<PUBLIC_PDF_URL>/health"
```

Attendu :

```json
{ "ok": true, "service": "petitmo-pdf-server" }
```

### 3) Pré-requis Supabase (Edge Functions)

Sur Supabase (Edge `init-export`) :

- `verify_jwt = false` (déjà dans `supabase/config.toml`)
- Secret requis dans les variables de la fonction :
  - `EXPORT_PDF_JWT_SECRET` (min 32 caractères)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 4) Smoke test bout-en-bout (init-export → ticket → generate-pdf)

#### 4.1) Créer un ticket PDF export (Edge `init-export`)

```bash
curl -sS "<SUPABASE_URL>/functions/v1/init-export" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <SUPABASE_ANON_KEY>" \\
  -H "apikey: <SUPABASE_ANON_KEY>" \\
  --data '{
    "type":"pdf_export",
    "export_mode":"digital",
    "book_id":"test-book",
    "child_local_id":"child-local",
    "subscription_tier":"paid",
    "audio_video_page_count":0,
    "email":"test@example.com",
    "gdpr_consent_at":"'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
    "full_name":"Test",
    "marketing_opt_in":false
  }'
```

Récupérer :

- `pdfTicket`
- `exportRequestId`

#### 4.2) Générer le PDF via le serveur public (ticket)

```bash
curl -sS "<PUBLIC_PDF_URL>/v1/books/generate-pdf" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <pdfTicket>" \\
  --data '{
    "bookId":"test-book",
    "childId":"child-local",
    "coverTitle":"Test",
    "coverYearLabel":"Avril 2026",
    "chapterTitle":"Notre histoire",
    "qrBaseUrl":"<PUBLIC_PDF_URL>",
    "exportMode":"digital",
    "subscriptionTier":"premium",
    "digitalExportPaid": true,
    "coverPhotoUrl": null,
    "pages":[
      { "type":"cover", "child": { "name":"Lina", "photo_url": null } },
      { "type":"chapter", "month":"avril", "chapterNum":1 },
      { "type":"back-cover" }
    ],
    "guestChild": { "name":"Lina", "photo_url": null },
    "guestMemories":[]
  }'
```

Attendu :

- `pdfUrlSigned` (URL signée Supabase Storage)
- `pdfStoragePath` (peut être `null` si fichier non persistant)

#### 4.2bis) (Optionnel) Signer des URLs d’upload direct Storage (Edge `guest-upload-urls`)

Pré-requis :

- Déployer l’Edge Function `guest-upload-urls`
- Dans Supabase: `verify_jwt = false` (dans `supabase/config.toml`)
- Variables Edge:
  - `EXPORT_PDF_JWT_SECRET`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

```bash
curl -sS "<SUPABASE_URL>/functions/v1/guest-upload-urls" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <SUPABASE_ANON_KEY>" \\
  -H "apikey: <SUPABASE_ANON_KEY>" \\
  --data '{
    "pdfTicket":"<pdfTicket>",
    "assets":[
      { "kind":"cover" },
      { "kind":"photo", "memoryId":"mem-1" },
      { "kind":"audio", "memoryId":"mem-2" },
      { "kind":"video_thumb", "memoryId":"mem-3" },
      { "kind":"video", "memoryId":"mem-3" }
    ]
  }'
```

Attendu :

- `uploads[]` avec `signedUrl` + `bucket` + `path`
- Pour `cover/photo/video_thumb` : `publicUrl` (bucket `media`)
- Pour `audio/video` : `token` (stable pour QR) + `path` raw (bucket `qr-media`)

#### 4.3) Télécharger le PDF et vérifier qu’il s’ouvre

```bash
curl -L "<pdfUrlSigned>" -o out.pdf
open out.pdf
```

### 5.1) Pérennité QR (`/m/{token}`) — critique produit

Voir [`docs/specs/qr-media-permanence.md`](../docs/specs/qr-media-permanence.md).

**Ordre déploiement** (obligatoire) :

1. Appliquer la migration `20260709180000_public_media_token_permanence.sql` (`supabase db push`).
2. Redéployer `guest-upload-urls` (Edge Function).
3. Redéployer `server/` Railway.

**Smoke après deploy** :

```bash
./scripts/qa/smoke-qr-audio.sh
```

Rescanner un QR d’un **PDF exporté avant le deploy** — doit toujours jouer.

**Diagnostic token** :

```sql
SELECT token, status, ready_path, last_error, updated_at FROM public_media_tokens WHERE token = '<TOKEN>';
SELECT created_at, event, detail FROM public_media_token_events WHERE token = '<TOKEN>' ORDER BY created_at DESC LIMIT 20;
```

### 6) Mode print (fond perdu 4 mm Gelato)

- Le **mode print** est supporté **uniquement** via ticket `export_print` (commande `print_order`).
- Page PDF : **218×288 mm** (trim 210×280 + 4 mm de chaque côté).
- Côté HTML, `--bleed` = 4 mm ; les visuels `.bleed-x` débordent sur le fond perdu.

### 7) Gelato — consolidation pré-prod (ordre recommandé)

Variables Railway (service `petitmo`) :

| Variable | Rôle |
|----------|------|
| `GELATO_API_KEY` | Clé API dashboard Gelato |
| `GELATO_PRODUCT_UID` | Livre photo 21×28 couverture rigide |
| `GELATO_SHIPMENT_METHOD_UID` | `standard` (ou UID quote API) |
| `GELATO_CURRENCY` | `EUR` |
| `GELATO_DEFAULT_PHONE` | Téléphone livraison (requis API) |
| `GELATO_PDF_SIGNED_URL_SECONDS` | TTL URL PDF pour Gelato (défaut 7 j) |
| `GELATO_WEBHOOK_SECRET` | = header `x-gelato-webhook-secret` côté Gelato |
| `GELATO_ORDER_TYPE` | **`draft`** en QA · **`order`** en prod |
| `GELATO_MIN_PAGE_COUNT` | Pages intérieures minimum catalogue (défaut **30**) ; le PDF fait intérieures + 3 |

Webhook Gelato : `POST https://<PUBLIC_PDF_URL>/v1/webhooks/gelato` · events `order_status_updated` (+ optionnel `order_item_tracking_code_updated`).

**Phase 1 — PDF print seul** (sans Gelato ou clé absente) :

```bash
./scripts/qa/smoke-print.sh
```

**Phase 2 — Webhook** :

```bash
./scripts/qa/smoke-gelato-webhook.sh <export_request_id>
```

**Phase 3 — Commande Gelato QA** : `GELATO_ORDER_TYPE=draft` sur Railway → **redéployer le serveur** → :

```bash
./scripts/qa/smoke-gelato-draft.sh
```

Dashboard Gelato : commande visible (draft), **pas** en production. Le script génère **30 pages intérieures** → PDF **33 pages** (spread couverture + 2 gardes blanches + contenu), format template Gelato.

**Phase 4 — Parcours app** : livre réel → `/book-order` → vérifier Supabase :

```sql
SELECT id, status, printer_order_id, last_error, shipped_at, delivered_at,
       printer_order_json->>'trackingCode' AS tracking
FROM export_requests
WHERE type = 'print_order'
ORDER BY created_at DESC
LIMIT 5;
```

Attendu après generate-pdf : `status = sent_to_printer`, `printer_order_id` non null, logs Railway `[gelato] order placed`.

**Phase 5 — Prod Gelato** : repasser `GELATO_ORDER_TYPE=order` · **1** livre physique test · QR audio scanné sur PDF imprimé.

**Hors scope Gelato (bloquant App Store impression)** : paiement IAP / achat à l’acte livre côté app (aujourd’hui commande possible sans encaissement).
